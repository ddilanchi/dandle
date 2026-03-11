import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { getRandomWord, isValidWord, initWordNet, getLoadProgress, isLoadDone, loadFailed } from './wordlist.js';
import { AudioManager } from './audio.js';
import { Physics } from './physics.js';

await RAPIER.init();

const VERSION = 'v4.0.0';

// ── DOM ──
const canvas = document.getElementById('game-canvas');
const restartBtn = document.getElementById('restart-btn');
const levelInfoEl = document.getElementById('level-info');
const hintEl = document.getElementById('hint');
const selectedInfoEl = document.getElementById('selected-info');
const inputContainer = document.getElementById('word-input-container');
const wordInput = document.getElementById('word-input');
const submitBtn = document.getElementById('submit-word');
const messageEl = document.getElementById('message');
const levelCompleteEl = document.getElementById('level-complete');

// Set version in both places from single source
document.getElementById('version').textContent = VERSION;
document.getElementById('intro-version').textContent = VERSION;
const introScreen = document.getElementById('intro-screen');
const pauseScreen = document.getElementById('pause-screen');
const levelSelectEl = document.getElementById('level-select');
const levelGridEl = document.getElementById('level-grid');
let gameStarted = false;
let paused = false;

// ── Settings ──
const DEFAULT_SETTINGS = { resolution: '1', shadows: true, fog: true, tonemapping: true, pixelate: 0 };
function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('dandle_settings') || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) { localStorage.setItem('dandle_settings', JSON.stringify(s)); }
let currentSettings = loadSettings();

const TOTAL_LEVELS = 6;

// Progression stored in localStorage
function getUnlockedLevels() {
  return parseInt(localStorage.getItem('dandle_unlocked') || '1', 10);
}
function unlockNextLevel(level) {
  const current = getUnlockedLevels();
  if (level >= current) {
    localStorage.setItem('dandle_unlocked', String(Math.min(level + 1, TOTAL_LEVELS)));
  }
}

function showLevelSelect() {
  const unlocked = getUnlockedLevels();
  levelGridEl.innerHTML = '';
  for (let i = 1; i <= TOTAL_LEVELS; i++) {
    const btn = document.createElement('button');
    btn.className = 'level-btn';
    const isLocked = i > unlocked;
    const isCompleted = i < unlocked;
    if (isLocked) btn.classList.add('locked');
    else if (isCompleted) btn.classList.add('completed');
    else btn.classList.add('unlocked');

    if (isLocked) {
      btn.innerHTML = `<span class="lock-icon">&#128274;</span><span class="level-label">Locked</span>`;
    } else {
      btn.innerHTML = `<span class="level-num">${i}</span><span class="level-label">${isCompleted ? '&#10003; Done' : 'Play'}</span>`;
      btn.addEventListener('click', () => {
        currentLevel = i;
        levelSelectEl.classList.add('hidden');
        startLevel();
      });
    }
    levelGridEl.appendChild(btn);
  }
  levelSelectEl.classList.remove('hidden');
}

// ── Three.js setup ──
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 30, 60);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(6, 8, 10);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.minDistance = 4;
controls.maxDistance = 30;
controls.enablePan = false;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

// ── Lights ──
const ambient = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xfff5e0, 1.2);
sun.position.set(8, 15, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -20;
sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20;
sun.shadow.camera.bottom = -20;
scene.add(sun);

// ── Pixelation blit pass ──
const _blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const _blitScene = new THREE.Scene();
const _blitGeo = new THREE.PlaneGeometry(2, 2);
const _blitMat = new THREE.MeshBasicMaterial();
_blitScene.add(new THREE.Mesh(_blitGeo, _blitMat));
let _pixelRT = null;

function _getPixelDivisor(s) {
  // 0 = off, 4 = low, 8 = high
  return s.pixelate || 0;
}

function _ensurePixelRT(divisor) {
  const w = Math.max(1, Math.floor(window.innerWidth / divisor));
  const h = Math.max(1, Math.floor(window.innerHeight / divisor));
  if (!_pixelRT || _pixelRT.width !== w || _pixelRT.height !== h) {
    if (_pixelRT) _pixelRT.dispose();
    _pixelRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
  }
  return _pixelRT;
}

function applySettings(s) {
  const dpr = s.resolution === 'native' ? window.devicePixelRatio : parseFloat(s.resolution);
  renderer.setPixelRatio(Math.min(dpr, window.devicePixelRatio));
  renderer.shadowMap.enabled = s.shadows;
  sun.castShadow = s.shadows;
  scene.fog = s.fog ? new THREE.Fog(0x87ceeb, 30, 60) : null;
  renderer.toneMapping = s.tonemapping ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  if (!s.pixelate && _pixelRT) { _pixelRT.dispose(); _pixelRT = null; }
}
applySettings(currentSettings);

// ── Audio ──
const audio = new AudioManager();

// ── Physics engine ──
const physics = new Physics(RAPIER);
console.log('[DANDLE] Physics engine v4.0.0 initialized, gravity:', 10, 'solver iters:', 8);

// ── Tiled cube floor (visual only — physics handled by Physics module) ──
let floorMesh = null;
const TILE_H = 1;

// Build floor from an array of tile positions: [{ x, z }, ...]
// If no tiles provided, builds a default 40x40 flat floor.
function buildFloor(tiles) {
  // Clean up old floor visual
  if (floorMesh) { scene.remove(floorMesh); floorMesh = null; }

  // Default: flat 40x40 grid
  if (!tiles) {
    tiles = [];
    for (let xi = -20; xi < 20; xi++) {
      for (let zi = -20; zi < 20; zi++) {
        tiles.push({ x: xi, z: zi, y: 0 });
      }
    }
  }

  if (tiles.length === 0) return;

  const green = new THREE.Color(0x6aad7a);
  const beige = new THREE.Color(0xece0c0);

  // Visual: InstancedMesh
  const geo = new THREE.BoxGeometry(1, TILE_H, 1);
  const mat = new THREE.MeshStandardMaterial();
  floorMesh = new THREE.InstancedMesh(geo, mat, tiles.length);
  floorMesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  tiles.forEach((t, i) => {
    const ty = (t.y || 0);
    dummy.position.set(t.x + 0.5, ty - TILE_H / 2, t.z + 0.5);
    dummy.updateMatrix();
    floorMesh.setMatrixAt(i, dummy.matrix);
    floorMesh.setColorAt(i, (t.x + t.z) % 2 === 0 ? green : beige);
  });
  floorMesh.instanceMatrix.needsUpdate = true;
  if (floorMesh.instanceColor) floorMesh.instanceColor.needsUpdate = true;
  scene.add(floorMesh);

  // Physics
  physics.createFloor(tiles);
}


// ── Raycaster ──
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const lastMouseWorld = new THREE.Vector3(); // mouse position on ground plane

// ── Game state ──
let selectedCube = null;
let selectedHighlight = null;
let levelComplete = false;
let levelFalling = false;
let structureGroup = new THREE.Group();
scene.add(structureGroup);

const cubes = [];       // { letter, gx, gy, gz, mesh, wordIdx }
const words = [];       // { text, dir, positions }

const TRANSLATE_SPEED = 1; // units per second — how fast new cubes slide in

let endZone = null;
let endZoneBox = null;
let directionArrow = null; // blue arrow showing word placement direction
let currentDir = 'x+'; // current build direction (controlled by Shift+IJKL)
let currentLevel = 1;
const levelObstacles = []; // meshes added per level (walls, platforms, zones)
const letterZones = [];    // { x, z, size, type: '+'/'-', letter, mesh }
const debrisPieces = [];   // { group, physicsId, cubes } — detached grey fragments

// ── Animation queue ──
const animations = [];  // { mesh, startTime, duration }
const BLOCK_ANIM_DURATION = 0.35; // seconds per block slide-out

// ── Sequential letter placement queue ──
let _placementQueue = null;

// ── Growth system ──
// Kinematic body slides from parent position to target. Purely cosmetic
// collision with ground only — no CG_PARENT hack needed.
let _growingCube = null; // { cube, growId, fromX/Y/Z, toX/Y/Z, progress, distance }

function updateCubeGrowth(dt) {
  if (!_growingCube) return;
  const gc = _growingCube;

  // Advance at constant speed
  const step = (TRANSLATE_SPEED * dt) / Math.max(gc.distance, 0.01);
  gc.progress = Math.min(gc.progress + step, 1);
  const t = gc.progress;

  // Interpolate local position (group-local space)
  const px = gc.fromX + (gc.toX - gc.fromX) * t;
  const py = gc.fromY + (gc.toY - gc.fromY) * t;
  const pz = gc.fromZ + (gc.toZ - gc.fromZ) * t;

  gc.cube.mesh.position.set(px, py, pz);

  // Move kinematic body in world space
  const worldPos = new THREE.Vector3(px, py, pz)
    .applyQuaternion(structureGroup.quaternion)
    .add(structureGroup.position);
  const rot = structureGroup.quaternion;
  physics.moveGrowingBody(gc.growId,
    { x: worldPos.x, y: worldPos.y, z: worldPos.z },
    { x: rot.x, y: rot.y, z: rot.z, w: rot.w }
  );

  if (t >= 1) {
    gc.cube.mesh.position.set(gc.toX, gc.toY, gc.toZ);
    physics.removeGrowingBody(gc.growId);

    _growingCube = null;
    // Advance to next letter in queue
    if (_placementQueue) {
      _placementQueue.index++;
      _placeNextLetter();
    }
  }
}

// ── Sync Three.js group from physics body ──
function syncGroupFromBody() {
  const t = physics.getStructureTransform();
  if (!t) return;
  const q = new THREE.Quaternion(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
  const anchorOffset = new THREE.Vector3(t.anchor.x, t.anchor.y, t.anchor.z).applyQuaternion(q);
  structureGroup.position.set(t.position.x - anchorOffset.x, t.position.y - anchorOffset.y, t.position.z - anchorOffset.z);
  structureGroup.quaternion.copy(q);
}

// ── Create letter cube mesh ──
function makeLetterMesh(letter) {
  const mats = [];
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f5ecd7';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 124, 124);
    ctx.fillStyle = '#222';
    ctx.font = 'bold 78px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 64, 68);
    const tex = new THREE.CanvasTexture(c);
    mats.push(new THREE.MeshStandardMaterial({ map: tex }));
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.94, 0.94), mats);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ── Ghost preview cubes ──
let _ghostMeshes = [];

function makeGhostMesh(letter) {
  const mats = [];
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(200, 220, 255, 0.3)';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(100, 150, 255, 0.5)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 124, 124);
    ctx.fillStyle = 'rgba(50, 80, 200, 0.6)';
    ctx.font = 'bold 78px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 64, 68);
    const tex = new THREE.CanvasTexture(c);
    mats.push(new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.4 }));
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.94, 0.94), mats);
  mesh.renderOrder = 1;
  return mesh;
}

function clearGhosts() {
  for (const g of _ghostMeshes) structureGroup.remove(g);
  _ghostMeshes = [];
}

function updateGhostPreview() {
  clearGhosts();
  if (!selectedCube || levelComplete || _placementQueue) return;

  const text = wordInput.value.toUpperCase().trim();
  if (text.length < 1) return;

  const letter = selectedCube.letter;
  const dir = currentDir;
  const dv = dirToVec(dir);

  // Find anchor index (same logic as submitWord)
  const allIdx = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === letter) allIdx.push(i);
  }
  if (allIdx.length === 0) return;

  let bestIdx = -1;
  for (const idx of allIdx) {
    const sx = selectedCube.gx - dv.x * idx;
    const sy = (selectedCube.gy || 0) - (dv.y || 0) * idx;
    const sz = selectedCube.gz - dv.z * idx;
    let conflict = false;
    for (let i = 0; i < text.length; i++) {
      const gx = sx + dv.x * i;
      const gy = sy + (dv.y || 0) * i;
      const gz = sz + dv.z * i;
      const existing = cubes.find(c => c.gx === gx && (c.gy || 0) === gy && c.gz === gz);
      if (existing && existing.letter !== text[i]) { conflict = true; break; }
    }
    if (!conflict) { bestIdx = idx; break; }
  }
  if (bestIdx === -1) return;

  const startGx = selectedCube.gx - dv.x * bestIdx;
  const startGy = (selectedCube.gy || 0) - (dv.y || 0) * bestIdx;
  const startGz = selectedCube.gz - dv.z * bestIdx;

  for (let i = 0; i < text.length; i++) {
    const gx = startGx + dv.x * i;
    const gy = startGy + (dv.y || 0) * i;
    const gz = startGz + dv.z * i;
    // Skip positions that already have a real cube
    const existing = cubes.find(c => c.gx === gx && (c.gy || 0) === gy && c.gz === gz);
    if (existing) continue;

    const ghost = makeGhostMesh(text[i]);
    ghost.position.set(gx, 0.5 + gy, gz);
    structureGroup.add(ghost);
    _ghostMeshes.push(ghost);
  }
}

// ── Place a word in the structure ──
// When animated=true, cubes are queued and placed one at a time.
// When animated=false, all cubes placed instantly (used for starter word).
function placeWord(text, startGx, startGz, dir, wordIdx, animated = false, startGy = 0) {
  const dirVec = dirToVec(dir);

  // Compute ALL positions this word covers (including overlaps)
  const allPositions = [];
  for (let i = 0; i < text.length; i++) {
    allPositions.push({
      gx: startGx + dirVec.x * i,
      gy: startGy + (dirVec.y || 0) * i,
      gz: startGz + dirVec.z * i,
    });
  }

  const wordEntry = { text, dir, positions: allPositions, _deleted: false };
  words.push(wordEntry);

  // Build list of letters to place (skip existing)
  const letters = [];
  for (let i = 0; i < text.length; i++) {
    const gx = startGx + dirVec.x * i;
    const gy = startGy + (dirVec.y || 0) * i;
    const gz = startGz + dirVec.z * i;
    const existing = cubes.find(c => c.gx === gx && c.gy === gy && c.gz === gz);
    if (existing) continue; // already placed, skip
    letters.push({ letter: text[i], gx, gy, gz, wordIdx });
  }

  if (!animated) {
    // Instant placement (starter word)
    for (const l of letters) {
      const mesh = makeLetterMesh(l.letter);
      mesh.position.set(l.gx, 0.5 + l.gy, l.gz);
      structureGroup.add(mesh);
      const cube = { letter: l.letter, gx: l.gx, gy: l.gy, gz: l.gz, mesh, wordIdx };
      mesh.userData.cube = cube;
      cubes.push(cube);
    }
    return;
  }

  // Animated: queue letters for sequential placement
  _placementQueue = {
    letters,
    index: 0,
    dirVec,
    text,
    wordIdx,
    startGx,
    startGy,
    startGz,
  };
  _placeNextLetter(); // start first one immediately
}

function _placeNextLetter() {
  if (!_placementQueue) return;
  const q = _placementQueue;

  if (q.index >= q.letters.length) {
    // Word complete — add colliders incrementally (no body rebuild!)
    console.log('[GAME] Word complete:', q.text, '| new letters:', q.letters.length, '| total cubes:', cubes.length);
    const gp = structureGroup.position;
    const gr = structureGroup.quaternion;
    const groupPos = { x: gp.x, y: gp.y, z: gp.z };
    const groupRot = { x: gr.x, y: gr.y, z: gr.z, w: gr.w };
    console.log('[GAME] structureGroup pos=', groupPos, 'rot=', groupRot);

    let added = 0, skipped = 0;
    for (const c of q.letters) {
      const cube = cubes.find(cb => cb.gx === c.gx && (cb.gy || 0) === c.gy && cb.gz === c.gz);
      if (!cube || cube.colliderKey) { skipped++; continue; }
      cube.colliderKey = physics.addCubeCollider(cube, groupPos, groupRot);
      added++;
    }
    console.log('[GAME] Added', added, 'colliders, skipped', skipped);

    // Apply push impulse in build direction
    const pushStrength = 3.0 * q.letters.length;
    const dv = q.dirVec;
    const pushDir = new THREE.Vector3(dv.x, dv.y || 0, dv.z)
      .applyQuaternion(structureGroup.quaternion);
    physics.applyImpulse({
      x: pushDir.x * pushStrength,
      y: pushDir.y * pushStrength,
      z: pushDir.z * pushStrength
    });

    _placementQueue = null;
    clearGhosts();
    // Select the last letter of the word
    const lastIdx = q.text.length - 1;
    const lastGx = q.startGx + dv.x * lastIdx;
    const lastGy = q.startGy + (dv.y || 0) * lastIdx;
    const lastGz = q.startGz + dv.z * lastIdx;
    const lastCube = cubes.find(c => c.gx === lastGx && (c.gy || 0) === lastGy && c.gz === lastGz);
    if (lastCube) {
      selectedCube = lastCube;
      highlightCube(lastCube);
      updateDirectionArrow();
      selectedInfoEl.textContent = `Selected: "${lastCube.letter}" at (${lastCube.gx}, ${lastCube.gz})`;
      inputContainer.classList.remove('hidden');
      wordInput.value = '';
      wordInput.focus();
    }
    return;
  }

  const l = q.letters[q.index];
  const mesh = makeLetterMesh(l.letter);

  // Spawn INSIDE the parent cube, then slide to target
  const prev = q.index > 0 ? q.letters[q.index - 1] : null;
  const fromX = prev ? prev.gx : (l.gx - q.dirVec.x);
  const fromY = prev ? (0.5 + prev.gy) : (0.5 + l.gy - (q.dirVec.y || 0));
  const fromZ = prev ? prev.gz : (l.gz - q.dirVec.z);
  const toX = l.gx, toY = 0.5 + l.gy, toZ = l.gz;

  // Start at full size inside parent position
  mesh.position.set(fromX, fromY, fromZ);

  structureGroup.add(mesh);

  const cube = { letter: l.letter, gx: l.gx, gy: l.gy, gz: l.gz, mesh, wordIdx: l.wordIdx };
  mesh.userData.cube = cube;
  cubes.push(cube);

  // Clear all ghosts on first letter
  if (q.index === 0) clearGhosts();

  audio.pop(q.index);

  console.log('[GAME] Growing letter', l.letter, 'from', `(${fromX},${fromY},${fromZ})`, 'to', `(${toX},${toY},${toZ})`);

  // Create kinematic body at parent position for slide animation
  const worldFrom = new THREE.Vector3(fromX, fromY, fromZ)
    .applyQuaternion(structureGroup.quaternion)
    .add(structureGroup.position);
  const rot = structureGroup.quaternion;
  const growId = physics.createGrowingBody(
    { x: worldFrom.x, y: worldFrom.y, z: worldFrom.z },
    { x: rot.x, y: rot.y, z: rot.z, w: rot.w }
  );

  const dx = toX - fromX, dy = toY - fromY, dz = toZ - fromZ;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  _growingCube = {
    cube,
    growId,
    fromX, fromY, fromZ,
    toX, toY, toZ,
    progress: 0,
    distance: dist,
  };
}

function _arrowAlwaysOnTop(arrow) {
  arrow.renderOrder = 999;
  arrow.traverse(child => {
    if (child.material) {
      child.material.depthTest = false;
      child.material.depthWrite = false;
      child.material.transparent = true;
      child.material.opacity = 0.9;
    }
  });
}

// ── Tick animations ──
function updateAnimations() {
  const now = performance.now() / 1000;
  for (let i = animations.length - 1; i >= 0; i--) {
    const a = animations[i];

    // Block scale-in or shrink-out
    if (now < a.startTime) continue;
    const elapsed = now - a.startTime;
    let t = Math.min(elapsed / a.duration, 1);

    // Play pop sound when this block starts appearing
    if (!a.soundPlayed) {
      audio.pop(a.soundIndex);
      a.soundPlayed = true;
    }

    if (a.isShrink) {
      // Shrink out
      const s = 1 - t;
      a.mesh.scale.set(s, s, s);
      if (t >= 1) {
        structureGroup.remove(a.mesh);
        // Remove from cubes array
        const ci = cubes.findIndex(c => c.mesh === a.mesh);
        if (ci !== -1) cubes.splice(ci, 1);
        animations.splice(i, 1);
      }
    } else if (a.isFadeOut) {
      // Fade out ghost mesh
      const mats = Array.isArray(a.mesh.material) ? a.mesh.material : [a.mesh.material];
      for (const m of mats) m.opacity = 0.4 * (1 - t);
      if (t >= 1) {
        animations.splice(i, 1);
        if (a.onComplete) a.onComplete();
      }
    } else {
      // Scale-in (legacy)
      a.mesh.scale.set(t, t, t);
      if (t >= 1) {
        a.mesh.scale.set(1, 1, 1);
        animations.splice(i, 1);
        if (a.onComplete) a.onComplete();
      }
    }
  }
}

function dirToVec(dir) {
  switch (dir) {
    case 'x+': return { x: 1, y: 0, z: 0 };
    case 'x-': return { x: -1, y: 0, z: 0 };
    case 'z+': return { x: 0, y: 0, z: 1 };
    case 'z-': return { x: 0, y: 0, z: -1 };
    case 'y+': return { x: 0, y: 1, z: 0 };
    case 'y-': return { x: 0, y: -1, z: 0 };
  }
}

// ── Get 3D direction from selected cube toward mouse ──
function dirFromMouse(cubeGx, cubeGy, cubeGz) {
  // Get cube world position
  const local = new THREE.Vector3(cubeGx, 0.5 + (cubeGy || 0), cubeGz);
  local.applyQuaternion(structureGroup.quaternion);
  local.add(structureGroup.position);

  // Cast ray from mouse and find the closest point on the ray to the cube center
  raycaster.setFromCamera(mouse, camera);
  const closestPoint = new THREE.Vector3();
  raycaster.ray.closestPointToPoint(local, closestPoint);

  // Get world-space delta
  const worldDelta = closestPoint.clone().sub(local);

  // Transform delta back into the structure's local space
  const invQ = structureGroup.quaternion.clone().invert();
  worldDelta.applyQuaternion(invQ);

  const dx = worldDelta.x;
  const dy = worldDelta.y;
  const dz = worldDelta.z;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);

  // Pick the dominant local axis
  if (ay >= ax && ay >= az) {
    return dy >= 0 ? 'y+' : 'y-';
  }
  if (ax >= az) {
    return dx >= 0 ? 'x+' : 'x-';
  }
  return dz >= 0 ? 'z+' : 'z-';
}

// ── End zone ──
function createEndZone(x, z, w, d, y = 0) {
  const geo = new THREE.PlaneGeometry(w, d);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xff3333,
    emissive: 0xff2222,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
  });
  endZone = new THREE.Mesh(geo, mat);
  endZone.rotation.x = -Math.PI / 2;
  endZone.position.set(x, y + 0.01, z);
  scene.add(endZone);

  // pulsing border
  const edges = new THREE.EdgesGeometry(geo);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xff6666, linewidth: 2 }));
  line.rotation.x = -Math.PI / 2;
  line.position.copy(endZone.position);
  line.position.y += 0.01;
  scene.add(line);
  endZone.userData.line = line;

  endZoneBox = new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(x, y + 0.5, z),
    new THREE.Vector3(w, 2, d)
  );

  // If elevated, add a glowing pillar beneath
  if (y > 0) {
    const pillarGeo = new THREE.BoxGeometry(w, y, d);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0xff3333, emissive: 0xff2222, emissiveIntensity: 0.4, transparent: true, opacity: 0.25,
    });
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(x, y / 2, z);
    scene.add(pillar);
    levelObstacles.push(pillar);
  }
}

// ── Level obstacles ──
function addWall(x, z, w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({ color: 0x666680 });
  const wall = new THREE.Mesh(geo, mat);
  wall.position.set(x, h / 2, z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);
  levelObstacles.push(wall);
  wall.userData.isWall = true;

  physics.addWall(x, z, w, h, d);
  return wall;
}

// ── Zip line pole ──
function addZipLine(x1, y1, z1, x2, y2, z2, radius = 0.3) {
  // Visual: cylinder between two points
  const start = new THREE.Vector3(x1, y1, z1);
  const end = new THREE.Vector3(x2, y2, z2);
  const length = start.distanceTo(end);
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const dir = end.clone().sub(start).normalize();

  const geo = new THREE.CylinderGeometry(radius, radius, length, 12);
  const mat = new THREE.MeshStandardMaterial({ color: 0x888899, metalness: 0.8, roughness: 0.2 });
  const pole = new THREE.Mesh(geo, mat);
  pole.position.copy(mid);
  // Align cylinder (default Y-axis) to the direction vector
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
  pole.quaternion.copy(quat);
  pole.castShadow = true;
  pole.receiveShadow = true;
  scene.add(pole);
  levelObstacles.push(pole);

  // Physics: approximate with a series of box shapes along the line
  const segments = Math.ceil(length / 2);
  const segLen = length / segments;
  for (let i = 0; i < segments; i++) {
    const t = (i + 0.5) / segments;
    const pos = start.clone().lerp(end, t);
    physics.addZipSegment(
      { x: pos.x, y: pos.y, z: pos.z },
      { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
      radius, segLen / 2, radius
    );
  }

  return pole;
}

// ── Letter zones ──
function addLetterZone(cx, cz, size, type, letter) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');

  // Background
  if (type === '-') {
    ctx.fillStyle = 'rgba(180, 60, 60, 0.55)';
  } else {
    ctx.fillStyle = 'rgba(50, 120, 180, 0.55)';
  }
  ctx.fillRect(0, 0, 256, 256);

  // Border
  ctx.strokeStyle = type === '-' ? '#aa3333' : '#3366aa';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 250, 250);

  // Symbol and letter
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 120px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${type}${letter}`, 128, 128);

  const tex = new THREE.CanvasTexture(c);
  const geo = new THREE.PlaneGeometry(size, size);
  const mat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, 0.02, cz);
  mesh.receiveShadow = true;
  scene.add(mesh);
  levelObstacles.push(mesh);

  const zone = { x: cx, z: cz, size, type, letter, mesh };
  letterZones.push(zone);
  return zone;
}

function getZoneAt(wx, wz) {
  for (const z of letterZones) {
    const half = z.size / 2;
    if (Math.abs(wx - z.x) < half && Math.abs(wz - z.z) < half) {
      return z;
    }
  }
  return null;
}

function makeGreyMesh(letter) {
  const mats = [];
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#777';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 124, 124);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 78px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 64, 68);
    const tex = new THREE.CanvasTexture(c);
    mats.push(new THREE.MeshStandardMaterial({ map: tex }));
  }
  return new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.94, 0.94), mats);
}

// Find connected components among cubes using adjacency (6-connected)
function _findComponents(cubeList) {
  const visited = new Set();
  const components = [];
  const key = c => `${c.gx},${c.gy || 0},${c.gz}`;
  const cubeMap = new Map();
  for (const c of cubeList) cubeMap.set(key(c), c);

  for (const c of cubeList) {
    const k = key(c);
    if (visited.has(k)) continue;
    const component = [];
    const stack = [c];
    while (stack.length) {
      const cur = stack.pop();
      const ck = key(cur);
      if (visited.has(ck)) continue;
      visited.add(ck);
      component.push(cur);
      // Check 6 neighbors
      for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const nk = `${cur.gx + dx},${(cur.gy || 0) + dy},${cur.gz + dz}`;
        if (cubeMap.has(nk) && !visited.has(nk)) stack.push(cubeMap.get(nk));
      }
    }
    components.push(component);
  }
  return components;
}

function _spawnDebris(debrisCubes) {
  // Create a new Three.js group for this chunk
  const group = new THREE.Group();
  scene.add(group);

  const q = structureGroup.quaternion;
  const gp = structureGroup.position;

  // Compute local COM for debris
  let cx = 0, cy = 0, cz = 0;
  for (const c of debrisCubes) { cx += c.gx; cy += 0.5 + (c.gy || 0); cz += c.gz; }
  cx /= debrisCubes.length; cy /= debrisCubes.length; cz /= debrisCubes.length;

  // World position of COM
  const comLocal = new THREE.Vector3(cx, cy, cz);
  comLocal.applyQuaternion(q);
  const worldPos = comLocal.add(gp);

  for (const c of debrisCubes) {
    // Remove collider from structure body
    physics.removeCubeCollider(c);

    // Remove from main structure visuals
    structureGroup.remove(c.mesh);
    const idx = cubes.indexOf(c);
    if (idx !== -1) cubes.splice(idx, 1);

    // Create grey replacement at local offset from debris COM
    const grey = makeGreyMesh(c.letter);
    grey.position.set(c.gx - cx, 0.5 + (c.gy || 0) - cy, c.gz - cz);
    grey.castShadow = true;
    group.add(grey);
  }

  // Position and rotate group to match structure
  group.position.copy(worldPos);
  group.quaternion.copy(q);

  // Physics — delegate to physics engine
  const linvel = physics.getLinvel();
  const angvel = physics.getAngvel();
  const { id } = physics.spawnDebris(
    debrisCubes,
    { x: worldPos.x, y: worldPos.y, z: worldPos.z },
    { x: q.x, y: q.y, z: q.z, w: q.w },
    linvel,
    angvel
  );

  debrisPieces.push({ group, physicsId: id, cubes: debrisCubes });
}

function deleteWord(wordIdx) {
  const w = words[wordIdx];
  if (!w || w._deleted) return;
  w._deleted = true;

  // Build set of positions covered by ALL OTHER active words (using stored positions)
  const protectedPositions = new Set();
  for (let wi = 0; wi < words.length; wi++) {
    if (wi === wordIdx || words[wi]._deleted) continue;
    const ow = words[wi];
    if (!ow.positions) continue;
    for (const p of ow.positions) {
      protectedPositions.add(`${p.gx},${p.gy},${p.gz}`);
    }
  }

  // Find cubes at positions this word covers that are NOT protected by another word
  const thisWordPositions = new Set();
  if (w.positions) {
    for (const p of w.positions) thisWordPositions.add(`${p.gx},${p.gy},${p.gz}`);
  }

  const toDetach = [];
  for (const c of cubes) {
    const key = `${c.gx},${c.gy || 0},${c.gz}`;
    if (thisWordPositions.has(key) && !protectedPositions.has(key)) {
      toDetach.push(c);
    }
  }

  // Turn deleted cubes into debris immediately
  if (toDetach.length > 0) {
    if (selectedCube && toDetach.includes(selectedCube)) {
      selectedCube = null;
      clearHighlight();
      removeDirectionArrow();
      selectedInfoEl.textContent = '';
      inputContainer.classList.add('hidden');
    }
    _spawnDebris(toDetach);
  }

  // Check remaining cubes for disconnected components
  if (cubes.length === 0) return;
  const components = _findComponents(cubes);
  if (components.length <= 1) {
    // Rebuild structure body (topology changed, but still one piece)
    const gp = structureGroup.position;
    const gr = structureGroup.quaternion;
    physics.createStructureBody(cubes,
      { x: gp.x, y: gp.y, z: gp.z },
      { x: gr.x, y: gr.y, z: gr.z, w: gr.w }
    );
    return;
  }

  // Keep the largest component as main structure, detach the rest
  components.sort((a, b) => b.length - a.length);
  for (let i = 1; i < components.length; i++) {
    _spawnDebris(components[i]);
  }
  const gp = structureGroup.position;
  const gr = structureGroup.quaternion;
  physics.createStructureBody(cubes,
    { x: gp.x, y: gp.y, z: gp.z },
    { x: gr.x, y: gr.y, z: gr.z, w: gr.w }
  );
}

function updateLetterZones() {
  if (letterZones.length === 0 || levelComplete) return;
  const sp = structureGroup.position;

  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi];
    if (w._deleted) continue;

    // Get the word's cubes and check which zones they overlap
    const wordCubes = cubes.filter(c => c.wordIdx === wi);
    for (const c of wordCubes) {
      const wx = c.gx + sp.x;
      const wz = c.gz + sp.z;
      const zone = getZoneAt(wx, wz);
      if (!zone) continue;

      const wordHasLetter = w.text.includes(zone.letter);

      if (zone.type === '-' && wordHasLetter) {
        // Minus zone: delete words containing this letter
        deleteWord(wi);
        audio.collision();
        showMessage(`"${w.text}" dissolved! Contains [${zone.letter}] in a -${zone.letter} zone`, '#ff6b6b');
        break;
      }
      if (zone.type === '+' && !wordHasLetter) {
        // Plus zone: delete words NOT containing this letter
        deleteWord(wi);
        audio.collision();
        showMessage(`"${w.text}" dissolved! Missing [${zone.letter}] in a +${zone.letter} zone`, '#ff6b6b');
        break;
      }
    }
  }
}

// ── Selection highlight ──
function highlightCube(cube) {
  clearHighlight();
  const geo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.3 });
  selectedHighlight = new THREE.Mesh(geo, mat);
  selectedHighlight.position.copy(cube.mesh.position);
  structureGroup.add(selectedHighlight);
}

function clearHighlight() {
  if (selectedHighlight) {
    structureGroup.remove(selectedHighlight);
    selectedHighlight.geometry.dispose();
    selectedHighlight.material.dispose();
    selectedHighlight = null;
  }
}

// ── Verb countdown timer sprite ──
// ── Direction indicator arrow ──
function updateDirectionArrow() {
  if (!selectedCube) { removeDirectionArrow(); return; }
  const dv = dirToVec(currentDir);
  const arrowDir = new THREE.Vector3(dv.x, dv.y || 0, dv.z).normalize();
  // Transform arrow direction from local to world space
  arrowDir.applyQuaternion(structureGroup.quaternion);
  const origin = cubeWorldPos(selectedCube);

  if (directionArrow) {
    directionArrow.position.copy(origin);
    directionArrow.setDirection(arrowDir);
  } else {
    directionArrow = new THREE.ArrowHelper(arrowDir, origin, 2, 0x4488ff, 0.35, 0.2);
    _arrowAlwaysOnTop(directionArrow);
    scene.add(directionArrow);
  }

  // Update transparency mask around the arrow
  _updateArrowMask(origin, arrowDir);
}

function removeDirectionArrow() {
  if (directionArrow) {
    scene.remove(directionArrow);
    directionArrow = null;
  }
  _removeArrowMask();
}

// ── Transparency mask: makes cubes near the arrow semi-transparent ──
let _maskedMeshes = []; // { mesh, originalOpacity, originalTransparent }

function _updateArrowMask(origin, arrowDir) {
  // Restore previously masked meshes
  _removeArrowMask();

  if (!selectedCube) return;

  // Make cubes that are near the arrow line semi-transparent
  const arrowEnd = origin.clone().add(arrowDir.clone().multiplyScalar(2.5));
  const arrowLine = new THREE.Line3(origin, arrowEnd);
  const tmpPoint = new THREE.Vector3();

  for (const c of cubes) {
    if (c === selectedCube) continue;
    const wp = cubeWorldPos(c);
    arrowLine.closestPointToPoint(wp, true, tmpPoint);
    const dist = wp.distanceTo(tmpPoint);
    if (dist < 0.8) {
      // This cube is near the arrow — make it transparent
      const mats = Array.isArray(c.mesh.material) ? c.mesh.material : [c.mesh.material];
      for (const mat of mats) {
        _maskedMeshes.push({
          mat,
          origTransparent: mat.transparent,
          origOpacity: mat.opacity,
        });
        mat.transparent = true;
        mat.opacity = 0.2;
      }
    }
  }
}

function _removeArrowMask() {
  for (const entry of _maskedMeshes) {
    entry.mat.transparent = entry.origTransparent;
    entry.mat.opacity = entry.origOpacity;
  }
  _maskedMeshes = [];
}

// ── Keyboard navigation (Shift+WASD / Shift+Space) ──
const ALL_DIRS = ['x+', 'x-', 'z+', 'z-', 'y+', 'y-'];

function _getOpenFaces(cube) {
  // Return directions where there's no adjacent cube
  const gx = cube.gx, gy = cube.gy || 0, gz = cube.gz;
  return ALL_DIRS.filter(dir => {
    const dv = dirToVec(dir);
    const nx = gx + dv.x, ny = gy + (dv.y || 0), nz = gz + dv.z;
    return !cubes.some(c => c.gx === nx && (c.gy || 0) === ny && c.gz === nz);
  });
}

function _handleNavKey(key) {
  if (!selectedCube) return false;

  // Shift+WASD/QE: move selection to adjacent cube
  const moveMap = {
    'W': { x: 0, y: 0, z: -1 }, 'S': { x: 0, y: 0, z: 1 },
    'A': { x: -1, y: 0, z: 0 }, 'D': { x: 1, y: 0, z: 0 },
    'Q': { x: 0, y: 1, z: 0 }, 'E': { x: 0, y: -1, z: 0 },
  };
  if (moveMap[key]) {
    const m = moveMap[key];
    const neighbor = cubes.find(c =>
      c.gx === selectedCube.gx + m.x &&
      (c.gy || 0) === (selectedCube.gy || 0) + m.y &&
      c.gz === selectedCube.gz + m.z
    );
    if (neighbor) {
      selectedCube = neighbor;
      highlightCube(neighbor);
      selectedInfoEl.textContent = `Selected: [${neighbor.letter}] at (${neighbor.gx}, ${neighbor.gz})`;
      audio.select();
      updateGhostPreview();
    }
    return true;
  }

  // Shift+Space: cycle through open faces
  if (key === ' ') {
    const openFaces = _getOpenFaces(selectedCube);
    if (openFaces.length === 0) return true;
    const curIdx = openFaces.indexOf(currentDir);
    currentDir = openFaces[(curIdx + 1) % openFaces.length];
    audio.select();
    updateGhostPreview();
    return true;
  }

  return false;
}

// ── Message flash ──
let msgTimeout = null;
function showMessage(text, color = '#ff6b6b') {
  messageEl.textContent = text;
  messageEl.style.color = color;
  messageEl.style.opacity = '1';
  clearTimeout(msgTimeout);
  msgTimeout = setTimeout(() => { messageEl.style.opacity = '0'; }, 2000);
}

// ── Score tracking ──
let lettersUsed = 0;

// ── Init level ──
function startLevel() {
  // Clear previous
  while (structureGroup.children.length) {
    structureGroup.remove(structureGroup.children[0]);
  }
  cubes.length = 0;
  words.length = 0;
  animations.length = 0;
  structureGroup.position.set(0, 0, 0);
  structureGroup.quaternion.identity();
  selectedCube = null;
  _ghostMeshes = [];
  clearHighlight();
  removeDirectionArrow();
  levelComplete = false;
  levelFalling = false;
  lettersUsed = 0;
  levelCompleteEl.classList.add('hidden');
  inputContainer.classList.add('hidden');
  selectedInfoEl.textContent = '';

  // Remove old end zone
  if (endZone) {
    scene.remove(endZone);
    if (endZone.userData.line) scene.remove(endZone.userData.line);
    endZone = null;
  }

  // Remove old obstacles and zones
  for (const o of levelObstacles) scene.remove(o);
  levelObstacles.length = 0;
  letterZones.length = 0;

  // Reset physics engine (clean slate)
  physics.reset();

  // Remove debris visuals
  for (const d of debrisPieces) {
    scene.remove(d.group);
  }
  debrisPieces.length = 0;

  // Build floor for this level
  if (currentLevel === 4) {
    // Two islands with a gap
    const tiles = [];
    for (let x = -8; x < 5; x++)
      for (let z = -5; z < 5; z++)
        tiles.push({ x, z, y: 0 });
    for (let x = 9; x < 18; x++)
      for (let z = -5; z < 5; z++)
        tiles.push({ x, z, y: 0 });
    buildFloor(tiles);
  } else if (currentLevel === 5) {
    // Narrow corridor forcing you through letter zones
    const tiles = [];
    for (let x = -8; x < 22; x++)
      for (let z = -2; z < 2; z++)
        tiles.push({ x, z, y: 0 });
    buildFloor(tiles);
  } else if (currentLevel === 6) {
    // Zip line: elevated start island, lower end island
    const tiles = [];
    for (let x = -6; x < 4; x++)
      for (let z = -4; z < 4; z++)
        tiles.push({ x, z, y: 10 });
    for (let x = 20; x < 30; x++)
      for (let z = -4; z < 4; z++)
        tiles.push({ x, z, y: 0 });
    buildFloor(tiles);
  } else {
    buildFloor();
  }

  // Starting word
  const word = getRandomWord();
  const startX = -Math.floor(word.length / 2);
  const startY = currentLevel === 6 ? 10 : 0;
  placeWord(word, startX, 0, 'x+', 0, false, startY);
  lettersUsed = word.length;
  console.log('[GAME] startLevel: placing word', word, '| cubes:', cubes.length, '| startX:', startX, '| startY:', startY);
  const initTransform = physics.createStructureBody(cubes);
  console.log('[GAME] startLevel: structure body created, transform=', initTransform);

  // Camera target
  const camTargetY = startY;
  controls.target.set(0, camTargetY, 0);
  camera.position.set(6, camTargetY + 8, 10);

  const LEVEL_HINTS = {
    1: 'Build words to push your structure into the red zone!',
    2: 'A wall blocks the way. Find a path around it!',
    3: 'The goal is in the air! Build upward momentum!',
    4: 'Two islands! Bridge the gap or launch across!',
    5: 'Letter zones! -X deletes words with X. +X deletes words WITHOUT X. Choose your words carefully!',
    6: 'Zip line! Build a hook shape to slide down the pole to the end zone!',
  };

  // ── Level configs ──
  switch (currentLevel) {
    case 1:
      createEndZone(10, 0, 4, 4);
      break;

    case 2:
      createEndZone(12, 0, 4, 4);
      addWall(6, 0, 1, 3, 10);
      break;

    case 3:
      createEndZone(10, 0, 4, 4, 4);
      break;

    case 4:
      createEndZone(14, 0, 4, 4);
      break;

    case 5: {
      // Letter zone level - narrow corridor, end zone high in the air
      createEndZone(18, 0, 4, 4, 8);

      // Letter zones span the narrow corridor between start and end
      const zoneLetters = 'AEIORSTLN';
      const zoneSize = 3;
      for (let col = 0; col < 5; col++) {
        const zx = 2 + col * zoneSize;
        const type = col % 2 === 0 ? '-' : '+';
        const letter = zoneLetters[Math.floor(Math.random() * zoneLetters.length)];
        addLetterZone(zx, 0, zoneSize, type, letter);
      }
      break;
    }

    case 6: {
      // Zip line: angled pole from high start island to low end island
      createEndZone(25, 0, 4, 4);
      // Pole from start island edge to end island edge
      addZipLine(3, 12, 0, 21, 2, 0, 0.3);
      break;
    }

    default:
      createEndZone(10, 0, 4, 4);
      break;
  }

  levelInfoEl.textContent = `Level ${currentLevel}`;
  hintEl.textContent = LEVEL_HINTS[currentLevel] || 'Reach the red zone!';
  // Start music for this level
  audio.startMusic(currentLevel);
}

// ── Click handling ──
let mouseDownPos = new THREE.Vector2();
let isDrag = false;

canvas.addEventListener('pointerdown', (e) => {
  mouseDownPos.set(e.clientX, e.clientY);
  isDrag = false;
  audio.init();
});

canvas.addEventListener('pointermove', (e) => {
  const dx = e.clientX - mouseDownPos.x;
  const dy = e.clientY - mouseDownPos.y;
  if (Math.sqrt(dx * dx + dy * dy) > 5) isDrag = true;

  // Track mouse on ground plane
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  raycaster.ray.intersectPlane(groundPlane, lastMouseWorld);
});

canvas.addEventListener('pointerup', (e) => {
  if (isDrag || levelComplete) return;

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const meshes = cubes.map(c => c.mesh);
  const hits = raycaster.intersectObjects(meshes);

  if (hits.length > 0) {
    const cube = hits[0].object.userData.cube;
    if (!cube || cube._debris) { return; }
    selectedCube = cube;
    highlightCube(cube);
    selectedInfoEl.textContent = `Selected: [${cube.letter}] at (${cube.gx}, ${cube.gz})`;
    inputContainer.classList.remove('hidden');
    wordInput.value = '';
    wordInput.focus();
    audio.select();
  } else {
    selectedCube = null;
    clearHighlight();
    removeDirectionArrow();
    selectedInfoEl.textContent = '';
    inputContainer.classList.add('hidden');
  }
});

// ── Crossword adjacency validation ──
// Ensures no new cube is placed adjacent to existing cubes unless it's
// a proper intersection (shared position with matching letter).
// Prevents parallel stacking and random letter adjacencies.
function validatePlacement(text, startGx, startGy, startGz, dv) {
  // Determine the perpendicular axes based on word direction
  const perpAxes = [];
  if (dv.x === 0) perpAxes.push({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 });
  if (dv.z === 0) perpAxes.push({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 });
  if ((dv.y || 0) === 0) perpAxes.push({ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 });

  // Also check along the word direction beyond the word ends
  const beforeGx = startGx - dv.x;
  const beforeGy = startGy - (dv.y || 0);
  const beforeGz = startGz - dv.z;
  const afterGx = startGx + dv.x * text.length;
  const afterGy = startGy + (dv.y || 0) * text.length;
  const afterGz = startGz + dv.z * text.length;

  // Check if there's an existing cube just before or after the word
  const cubeBefore = cubes.find(c => c.gx === beforeGx && (c.gy || 0) === beforeGy && c.gz === beforeGz);
  const cubeAfter = cubes.find(c => c.gx === afterGx && (c.gy || 0) === afterGy && c.gz === afterGz);
  if (cubeBefore) return `Word would extend from an existing [${cubeBefore.letter}] — invalid adjacency`;
  if (cubeAfter) return `Word would extend into an existing [${cubeAfter.letter}] — invalid adjacency`;

  for (let i = 0; i < text.length; i++) {
    const gx = startGx + dv.x * i;
    const gy = startGy + (dv.y || 0) * i;
    const gz = startGz + dv.z * i;

    // Skip positions where a cube already exists (intersection)
    const existing = cubes.find(c => c.gx === gx && (c.gy || 0) === gy && c.gz === gz);
    if (existing) continue;

    // For each new cube, check perpendicular neighbors
    for (const perp of perpAxes) {
      const nx = gx + perp.x;
      const ny = gy + perp.y;
      const nz = gz + perp.z;
      const neighbor = cubes.find(c => c.gx === nx && (c.gy || 0) === ny && c.gz === nz);
      if (neighbor) {
        return `[${text[i]}] would be adjacent to [${neighbor.letter}] — no valid cross-word`;
      }
    }
  }
  return null; // valid
}

// ── Word type spinner ──
// ── Word submission ──
function submitWord() {
  if (!selectedCube || levelComplete || _placementQueue) return;
  const text = wordInput.value.toUpperCase().trim();
  if (text.length < 2) {
    showMessage('Word must be at least 2 letters');
    audio.error();
    return;
  }
  if (!/^[A-Z]+$/.test(text)) {
    showMessage('Letters only!');
    audio.error();
    return;
  }
  if (!isValidWord(text)) {
    showMessage(`"${text}" is not a real word`);
    audio.error();
    return;
  }
  const letter = selectedCube.letter;

  // Find ALL positions of the selected letter in the word
  const allIdx = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === letter) allIdx.push(i);
  }
  if (allIdx.length === 0) {
    showMessage(`Word must contain the letter [${letter}]`);
    audio.error();
    return;
  }

  const dir = currentDir;
  const dv = dirToVec(dir);

  // Try each possible anchor position — use the first one that works
  let bestIdx = -1;
  let bestError = null;

  for (const idx of allIdx) {
    const sx = selectedCube.gx - dv.x * idx;
    const sy = (selectedCube.gy || 0) - (dv.y || 0) * idx;
    const sz = selectedCube.gz - dv.z * idx;

    // Check letter conflicts
    let conflict = false;
    for (let i = 0; i < text.length; i++) {
      const gx = sx + dv.x * i;
      const gy = sy + (dv.y || 0) * i;
      const gz = sz + dv.z * i;
      const existing = cubes.find(c => c.gx === gx && (c.gy || 0) === gy && c.gz === gz);
      if (existing && existing.letter !== text[i]) { conflict = true; break; }
    }
    if (conflict) continue;

    // Check adjacency
    const err = validatePlacement(text, sx, sy, sz, dv);
    if (!err) { bestIdx = idx; break; }
    if (!bestError) bestError = err;
  }

  if (bestIdx === -1) {
    showMessage(bestError || `Cannot place "${text}" in this direction`);
    audio.error();
    return;
  }

  const idx = bestIdx;
  const startGx = selectedCube.gx - dv.x * idx;
  const startGy = (selectedCube.gy || 0) - (dv.y || 0) * idx;
  const startGz = selectedCube.gz - dv.z * idx;

  // Final conflict check (for error message — should pass since we validated above)
  for (let i = 0; i < text.length; i++) {
    const gx = startGx + dv.x * i;
    const gy = startGy + (dv.y || 0) * i;
    const gz = startGz + dv.z * i;
    const existing = cubes.find(c => c.gx === gx && (c.gy || 0) === gy && c.gz === gz);
    if (existing && existing.letter !== text[i]) {
      showMessage(`Conflict: [${text[i]}] overlaps [${existing.letter}]`);
      audio.error();
      return;
    }
  }

  // Easter egg: DAN makes everything explode
  if (text === 'DAN') {
    wordInput.value = '';
    inputContainer.classList.add('hidden');
    explodeStructure();
    return;
  }

  inputContainer.classList.add('hidden');
  wordInput.value = '';

  if (levelComplete) return;
  const wordIdx = words.length;
  placeWord(text, startGx, startGz, dir, wordIdx, true, startGy);
  lettersUsed += text.length;
  showMessage(`"${text}" placed (${lettersUsed} letters used)`, '#aaddff');
}

submitBtn.addEventListener('click', submitWord);
// Keep input focused whenever a cube is selected
wordInput.addEventListener('blur', () => {
  if (selectedCube && !levelComplete && !paused && !_placementQueue) {
    setTimeout(() => wordInput.focus(), 0);
  }
});

wordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { submitWord(); return; }

  // Arrow keys: let them bubble to window for camera control
  if (e.key.startsWith('Arrow')) return;

  // Shift+WASD/QE/Space: navigation
  if (e.shiftKey && _handleNavKey(e.key.toUpperCase())) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  e.stopPropagation();
});

// Update ghost preview as user types
wordInput.addEventListener('input', updateGhostPreview);

// ── Explosion (DAN easter egg) ──
function explodeStructure() {
  audio.explode();
  showMessage('DAN?! BOOM!', '#ff2222');

  // Fling every cube outward with random velocity
  const now = performance.now() / 1000;
  for (const c of cubes) {
    const mesh = c.mesh;
    // Detach from structure group into scene so they fly independently
    const worldPos = new THREE.Vector3();
    mesh.getWorldPosition(worldPos);
    structureGroup.remove(mesh);
    scene.add(mesh);
    mesh.position.copy(worldPos);

    // Random explosion velocity
    const vx = (Math.random() - 0.5) * 30;
    const vy = 8 + Math.random() * 15;
    const vz = (Math.random() - 0.5) * 30;
    const spin = {
      x: (Math.random() - 0.5) * 15,
      y: (Math.random() - 0.5) * 15,
      z: (Math.random() - 0.5) * 15,
    };

    // Animate each piece as a physics projectile
    const startTime = now;
    const piece = { mesh, vx, vy, vz, spin, startTime };
    explosionPieces.push(piece);
  }

  // Remove arrows, sprites, highlights
  while (structureGroup.children.length) {
    structureGroup.remove(structureGroup.children[0]);
  }
  cubes.length = 0;
  words.length = 0;
  animations.length = 0;
  selectedCube = null;
  clearHighlight();
  removeDirectionArrow();
  inputContainer.classList.add('hidden');

  // Restart after the explosion settles
  levelComplete = true;
  setTimeout(() => {
    // Clean up explosion pieces
    for (const p of explosionPieces) scene.remove(p.mesh);
    explosionPieces.length = 0;
    startLevel();
  }, 3000);
}

const explosionPieces = [];

function updateExplosion(dt) {
  for (const p of explosionPieces) {
    p.vy -= 20 * dt; // gravity
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.mesh.rotation.x += p.spin.x * dt;
    p.mesh.rotation.y += p.spin.y * dt;
    p.mesh.rotation.z += p.spin.z * dt;
  }
}

// ── Restart button ──
restartBtn.addEventListener('click', () => {
  audio.stopMusic();
  startLevel();
});

// ── Level select button ──
const levelSelectBtn = document.getElementById('level-select-btn');
levelSelectBtn.addEventListener('click', () => {
  audio.stopMusic();
  showLevelSelect();
});

// ── Settings panel ──
const settingsScreen = document.getElementById('settings-screen');
const settingsBtn = document.getElementById('settings-btn');
const settingsClose = document.getElementById('settings-close');

function syncSettingsUI() {
  document.getElementById('setting-shadows').checked = currentSettings.shadows;
  document.getElementById('setting-fog').checked = currentSettings.fog;
  document.getElementById('setting-tonemapping').checked = currentSettings.tonemapping;
  settingsScreen.querySelectorAll('[data-setting="resolution"] button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === String(currentSettings.resolution));
  });
  settingsScreen.querySelectorAll('[data-setting="pixelate"] button').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.value) === (currentSettings.pixelate || 0));
  });
}

settingsBtn.addEventListener('click', () => {
  syncSettingsUI();
  settingsScreen.classList.remove('hidden');
});
settingsClose.addEventListener('click', () => settingsScreen.classList.add('hidden'));

settingsScreen.querySelectorAll('[data-setting="resolution"] button').forEach(btn => {
  btn.addEventListener('click', () => {
    currentSettings.resolution = btn.dataset.value;
    applySettings(currentSettings);
    saveSettings(currentSettings);
    syncSettingsUI();
  });
});

settingsScreen.querySelectorAll('[data-setting="pixelate"] button').forEach(btn => {
  btn.addEventListener('click', () => {
    currentSettings.pixelate = parseInt(btn.dataset.value);
    applySettings(currentSettings);
    saveSettings(currentSettings);
    syncSettingsUI();
  });
});

['shadows', 'fog', 'tonemapping'].forEach(key => {
  document.getElementById(`setting-${key}`).addEventListener('change', (e) => {
    currentSettings[key] = e.target.checked;
    applySettings(currentSettings);
    saveSettings(currentSettings);
  });
});

// ── Level complete: press Space to advance ──
function advanceLevel() {
  if (levelFalling) return;
  levelCompleteEl.classList.add('hidden');
  audio.stopMusic();
  if (currentLevel < TOTAL_LEVELS) {
    currentLevel++;
    startLevel();
  } else {
    currentLevel = 1;
    startLevel();
  }
}
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' && levelComplete && !levelCompleteEl.classList.contains('hidden')) {
    e.preventDefault();
    advanceLevel();
  }
});
levelCompleteEl.addEventListener('click', advanceLevel);

// ── Arrow keys: orbit camera ──
const _cameraKeys = new Set();
const CAMERA_ORBIT_SPEED = 0.03;
const CAMERA_ZOOM_SPEED = 0.5;

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    _cameraKeys.add(e.key);
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  _cameraKeys.delete(e.key);
});

function updateCameraKeys() {
  if (_cameraKeys.size === 0) return;
  // Get spherical coords relative to target
  const offset = camera.position.clone().sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);

  if (_cameraKeys.has('ArrowLeft')) spherical.theta -= CAMERA_ORBIT_SPEED;
  if (_cameraKeys.has('ArrowRight')) spherical.theta += CAMERA_ORBIT_SPEED;
  if (_cameraKeys.has('ArrowUp')) spherical.phi = Math.max(0.1, spherical.phi - CAMERA_ORBIT_SPEED);
  if (_cameraKeys.has('ArrowDown')) spherical.phi = Math.min(controls.maxPolarAngle, spherical.phi + CAMERA_ORBIT_SPEED);

  offset.setFromSpherical(spherical);
  camera.position.copy(controls.target).add(offset);
  camera.lookAt(controls.target);
}

// ── Pause handler ──
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !settingsScreen.classList.contains('hidden')) {
    settingsScreen.classList.add('hidden');
    return;
  }
  if (e.key === 'Escape' && gameStarted) {
    paused = !paused;
    pauseScreen.classList.toggle('hidden', !paused);
    if (paused) {
      audio.stopMusic();
    } else {
      audio.startMusic(currentLevel);
    }
  }
});

// ── Global Shift+WASD/QE/Space handler (works even without input focus) ──
window.addEventListener('keydown', (e) => {
  if (!e.shiftKey || levelComplete || paused || _placementQueue) return;
  const key = e.key.toUpperCase();
  if ('WASDEQ '.includes(key) || key === ' ') {
    if (_handleNavKey(key === ' ' ? ' ' : key)) {
      e.preventDefault();
    }
  }
});

// ── Helper: get world position of a cube (accounting for group transform) ──
function cubeWorldPos(c) {
  const local = new THREE.Vector3(c.gx, 0.5 + (c.gy || 0), c.gz);
  local.applyQuaternion(structureGroup.quaternion);
  local.add(structureGroup.position);
  return local;
}


// ── Physics update ──
let _physFrameCount = 0;
function updatePhysics(dt) {
  if (levelComplete || !physics.hasStructureBody()) return;

  physics.step(dt);
  syncGroupFromBody();
  _physFrameCount++;

  // Log structure group position every 2 seconds
  if (_physFrameCount % 120 === 1) {
    const sp = structureGroup.position;
    console.log('[GAME] frame', _physFrameCount, '| structureGroup pos=', `(${sp.x.toFixed(2)}, ${sp.y.toFixed(2)}, ${sp.z.toFixed(2)})`, '| cubes=', cubes.length, '| growing=', !!_growingCube, '| queue=', !!_placementQueue);
  }

  // Sync debris pieces
  for (const d of debrisPieces) {
    const dt = physics.getDebrisTransform(d.physicsId);
    if (!dt) continue;
    d.group.position.set(dt.position.x, dt.position.y, dt.position.z);
    d.group.quaternion.set(dt.rotation.x, dt.rotation.y, dt.rotation.z, dt.rotation.w);
  }

  // ── Fell off edge ──
  const floorEdge = 20;
  let onPlatform = false;
  for (const c of cubes) {
    const wp = cubeWorldPos(c);
    if (Math.abs(wp.x) < floorEdge && Math.abs(wp.z) < floorEdge) { onPlatform = true; break; }
  }
  if (!onPlatform) {
    levelFalling = true;
    const sPos = physics.getStructurePosition();
    if (sPos.y < -5) {
      showMessage('Fell off! Restarting...', '#ff6b6b');
      levelComplete = true;
      setTimeout(() => startLevel(), 1000);
      return;
    }
    return;
  }

  // Clean up debris that fell too far
  for (let i = debrisPieces.length - 1; i >= 0; i--) {
    const dt = physics.getDebrisTransform(debrisPieces[i].physicsId);
    if (!dt || dt.position.y < -20) {
      scene.remove(debrisPieces[i].group);
      physics.removeDebris(debrisPieces[i].physicsId);
      debrisPieces.splice(i, 1);
    }
  }

  // ── Win check ──
  if (endZoneBox) {
    for (const c of cubes) {
      const wp = cubeWorldPos(c);
      if (endZoneBox.containsPoint(wp)) {
        levelComplete = true;
        unlockNextLevel(currentLevel);
        levelCompleteEl.querySelector('h1').textContent = 'Level Complete!';
        const isLast = currentLevel >= TOTAL_LEVELS;
        levelCompleteEl.querySelector('p').textContent = isLast
          ? `All ${TOTAL_LEVELS} levels done! Letters used: ${lettersUsed}`
          : `Letters used: ${lettersUsed} — press SPACE to continue`;
        levelCompleteEl.classList.remove('hidden');
        audio.levelComplete();
        return;
      }
    }
  }
}

// ── Animate end zone pulse ──
function animateEndZone(time) {
  if (endZone) {
    const pulse = 0.45 + Math.sin(time * 3) * 0.15;
    endZone.material.opacity = pulse;
  }
}

// ── Camera follows selected cube or structure center ──
function updateCamera() {
  let target;
  if (selectedCube) {
    target = cubeWorldPos(selectedCube);
  } else {
    target = structureGroup.position.clone();
  }
  controls.target.lerp(target, 0.06);
}

// ── Main loop ──
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const rawDt = clock.getDelta();
  const dt = paused ? 0 : Math.min(rawDt, 0.05);
  const time = clock.elapsedTime;

  if (!paused) {
    updateAnimations();
    updateCubeGrowth(dt);
    updateLetterZones();
    updateDirectionArrow();
    audio.setMusicIntensity(cubes.length);
    updateExplosion(dt);
    updatePhysics(dt);
    updateCamera();
    updateCameraKeys();
    animateEndZone(time);
  }
  controls.update();
  const _pixDiv = _getPixelDivisor(currentSettings);
  if (_pixDiv > 0) {
    const rt = _ensurePixelRT(_pixDiv);
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    _blitMat.map = rt.texture;
    renderer.render(_blitScene, _blitCam);
  } else {
    renderer.render(scene, camera);
  }
}

// ── Resize ──
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (_pixelRT) { _pixelRT.dispose(); _pixelRT = null; }
});

// ── Intro screen loading progress ──
const startPromptEl = document.getElementById('intro-start');
const introLoaderBar = document.getElementById('intro-loader-bar');
const introLoaderText = document.getElementById('intro-loader-text');
const introLoader = document.getElementById('intro-loader');

// Animate a fake progress bar that fills up over ~3s, then snaps to done
let _fakeProgress = 0;
(function pollProgress() {
  if (isLoadDone()) {
    introLoaderBar.style.setProperty('--progress', '100%');
    introLoaderText.textContent = loadFailed()
      ? 'Playing without dictionary'
      : 'Dictionary ready!';
    setTimeout(() => {
      introLoader.style.opacity = '0.4';
      startPromptEl.classList.remove('hidden');
    }, 300);
    return;
  }
  // Ease toward 90% while waiting, never quite reaching it
  _fakeProgress += (0.9 - _fakeProgress) * 0.04;
  introLoaderBar.style.setProperty('--progress', Math.round(_fakeProgress * 100) + '%');
  introLoaderText.textContent = `Loading dictionary...`;
  setTimeout(pollProgress, 80);
})();

let audioStarted = false;
function tryStartTitleMusic() {
  if (audioStarted) return;
  audioStarted = true;
  audio.init();
  audio.startMusic(0); // level 0 = title screen key
}

async function beginGame() {
  if (gameStarted) return;
  tryStartTitleMusic();
  if (!isLoadDone()) return;
  gameStarted = true;
  introScreen.classList.add('hidden');
  currentLevel = 1;
  startLevel();
}

introScreen.addEventListener('click', beginGame);
window.addEventListener('keydown', () => {
  if (!gameStarted) beginGame();
});

// ── Start ──
animate();
