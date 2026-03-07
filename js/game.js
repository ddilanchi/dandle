import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getRandomWord, isVerb, getWordTypes, isValidWord, initWordNet, getLoadProgress, isLoadDone } from './wordlist.js';
import { AudioManager } from './audio.js';

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
const verbLegend = document.getElementById('verb-legend');
const levelCompleteEl = document.getElementById('level-complete');
const introScreen = document.getElementById('intro-screen');
const pauseScreen = document.getElementById('pause-screen');
const levelSelectEl = document.getElementById('level-select');
const levelGridEl = document.getElementById('level-grid');
const typeSpinner = document.getElementById('type-spinner');
const spinnerWord = document.getElementById('spinner-word');
const spinnerType = document.getElementById('spinner-type');
let gameStarted = false;
let paused = false;

const TOTAL_LEVELS = 5;

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

// ── Audio ──
const audio = new AudioManager();

// ── Checkerboard floor ──
function createFloor() {
  const size = 40;
  const geo = new THREE.PlaneGeometry(size, size);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  const tiles = 40;
  const tileSize = 512 / tiles;
  const green = '#4a7c59';
  const beige = '#d4c5a0';
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? green : beige;
      ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({ map: tex });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  scene.add(mesh);
}
createFloor();

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
const words = [];       // { text, dir, isVerb, arrowHelper }
const velocity = new THREE.Vector3();
const angularVelocity = new THREE.Vector3();
const FRICTION = 0.97;
const ANG_FRICTION = 0.95;
const VERB_FORCE = 2.5;
const VERB_DELAY = 3; // seconds before verb activates
const GRAVITY = 15;

let endZone = null;
let endZoneBox = null;
let endZoneY = 0; // y position of end zone (for elevated goals)
let directionArrow = null; // blue arrow showing word placement direction
let currentLevel = 1;
const levelObstacles = []; // meshes added per level (walls, pits, platforms)
const letterZones = [];    // { x, z, size, type: '+'/'-', letter, mesh }

// ── Animation queue ──
const animations = [];  // { mesh, startTime, duration }
const BLOCK_ANIM_DURATION = 0.25; // seconds per block scale-in
const BLOCK_ANIM_STAGGER = 0.08; // delay between each block

// ── Rigid body helpers ──
function computeCOM() {
  if (cubes.length === 0) return new THREE.Vector3(0, 0.5, 0);
  let cx = 0, cy = 0, cz = 0;
  for (const c of cubes) {
    cx += c.gx;
    cy += 0.5 + (c.gy || 0);
    cz += c.gz;
  }
  return new THREE.Vector3(cx / cubes.length, cy / cubes.length, cz / cubes.length);
}

function computeInertia() {
  const com = computeCOM();
  let inertia = 0;
  for (const c of cubes) {
    const dx = c.gx - com.x;
    const dy = 0.5 + (c.gy || 0) - com.y;
    const dz = c.gz - com.z;
    inertia += dx * dx + dy * dy + dz * dz + 1 / 6;
  }
  return Math.max(inertia, 0.5);
}

// Get the lowest world-space Y of any cube corner (accounting for rotation)
function getLowestPoint() {
  let minY = Infinity;
  const halfSize = 0.47;
  const corners = [
    new THREE.Vector3(-halfSize, -halfSize, -halfSize),
    new THREE.Vector3(halfSize, -halfSize, -halfSize),
    new THREE.Vector3(-halfSize, -halfSize, halfSize),
    new THREE.Vector3(halfSize, -halfSize, halfSize),
  ];
  for (const c of cubes) {
    const localPos = new THREE.Vector3(c.gx, 0.5 + (c.gy || 0), c.gz);
    for (const corner of corners) {
      const wp = localPos.clone().add(corner);
      wp.applyQuaternion(structureGroup.quaternion);
      wp.add(structureGroup.position);
      if (wp.y < minY) minY = wp.y;
    }
  }
  return minY;
}

// ── Create letter cube mesh ──
function makeLetterMesh(letter, isVerbCube) {
  const mats = [];
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = isVerbCube ? '#ffe0d0' : '#f5ecd7';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = isVerbCube ? '#cc4444' : '#999';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 124, 124);
    ctx.fillStyle = isVerbCube ? '#aa2222' : '#222';
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

// ── Place a word in the structure ──
function placeWord(text, startGx, startGz, dir, wordIdx, animated = false, startGy = 0, forceVerb = null) {
  const verb = forceVerb !== null ? forceVerb : isVerb(text);
  const placed = [];
  const dirVec = dirToVec(dir);
  const now = performance.now() / 1000;
  let newBlockIndex = 0;

  for (let i = 0; i < text.length; i++) {
    const gx = startGx + dirVec.x * i;
    const gy = startGy + (dirVec.y || 0) * i;
    const gz = startGz + dirVec.z * i;
    const existing = cubes.find(c => c.gx === gx && c.gy === gy && c.gz === gz);
    if (existing) {
      placed.push(existing);
      continue;
    }
    const mesh = makeLetterMesh(text[i], verb);
    mesh.position.set(gx, 0.5 + gy, gz);
    structureGroup.add(mesh);
    const cube = { letter: text[i], gx, gy, gz, mesh, wordIdx };
    mesh.userData.cube = cube;
    cubes.push(cube);
    placed.push(cube);

    if (animated) {
      // Start at scale 0, animate to 1
      mesh.scale.set(0, 0, 0);
      const delay = newBlockIndex * BLOCK_ANIM_STAGGER;
      animations.push({
        mesh,
        startTime: now + delay,
        duration: BLOCK_ANIM_DURATION,
        soundIndex: newBlockIndex,
        soundPlayed: false,
      });
    }
    newBlockIndex++;
  }

  const wordEntry = {
    text, dir, isVerb: verb, length: text.length, arrowHelper: null,
    active: !verb, // non-verbs are always "active" (they don't apply force anyway)
    activateAt: verb ? performance.now() / 1000 + VERB_DELAY : 0,
    timerSprite: null,
  };

  // Verb force arrow (delayed until animation finishes if animated)
  if (verb) {
    const arrowDir = new THREE.Vector3(dirVec.x, 0, dirVec.z).normalize();
    const midIdx = Math.floor(text.length / 2);
    const midCube = placed[midIdx];
    const origin = new THREE.Vector3(midCube.gx, 1.2 + (midCube.gy || 0), midCube.gz);
    const arrow = new THREE.ArrowHelper(arrowDir, origin, 1.5, 0xff2222, 0.4, 0.25);
    // Hide arrow until verb timer activates it
    arrow.visible = false;
    structureGroup.add(arrow);
    wordEntry.arrowHelper = arrow;
    verbLegend.classList.remove('hidden');
  }

  words.push(wordEntry);
  return { placed, verb };
}

// ── Tick animations ──
function updateAnimations() {
  const now = performance.now() / 1000;
  for (let i = animations.length - 1; i >= 0; i--) {
    const a = animations[i];

    // Arrow reveal entries
    if (a.isArrowReveal) {
      if (now >= a.revealTime) {
        a.arrow.visible = true;
        if (!a.soundPlayed) {
          audio.verb();
          a.soundPlayed = true;
        }
        animations.splice(i, 1);
      }
      continue;
    }

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
    } else {
      // Overshoot easing for a bouncy pop feel
      const overshoot = 1.4;
      t = t < 1
        ? 1 - Math.pow(1 - t, 3) * (1 + overshoot * (1 - t))
        : 1;

      a.mesh.scale.set(t, t, t);

      if (elapsed >= a.duration) {
        a.mesh.scale.set(1, 1, 1);
        animations.splice(i, 1);
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
  const wx = cubeGx + structureGroup.position.x;
  const wy = 0.5 + (cubeGy || 0) + structureGroup.position.y;
  const wz = cubeGz + structureGroup.position.z;

  // Cast ray from mouse and find the closest point on the ray to the cube center
  raycaster.setFromCamera(mouse, camera);
  const cubeWorld = new THREE.Vector3(wx, wy, wz);
  const closestPoint = new THREE.Vector3();
  raycaster.ray.closestPointToPoint(cubeWorld, closestPoint);

  const dx = closestPoint.x - wx;
  const dy = closestPoint.y - wy;
  const dz = closestPoint.z - wz;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);

  // Pick the dominant axis
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
  endZoneY = y;
  const geo = new THREE.PlaneGeometry(w, d);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xcc2222,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });
  endZone = new THREE.Mesh(geo, mat);
  endZone.rotation.x = -Math.PI / 2;
  endZone.position.set(x, y + 0.01, z);
  scene.add(endZone);

  // pulsing border
  const edges = new THREE.EdgesGeometry(geo);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xff4444 }));
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
      color: 0xcc2222, transparent: true, opacity: 0.15,
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
  return wall;
}

function addPit(x, z, w, d) {
  // Dark hole in the floor
  const geo = new THREE.PlaneGeometry(w, d);
  const mat = new THREE.MeshStandardMaterial({ color: 0x111118, side: THREE.DoubleSide });
  const pit = new THREE.Mesh(geo, mat);
  pit.rotation.x = -Math.PI / 2;
  pit.position.set(x, 0.005, z);
  scene.add(pit);
  levelObstacles.push(pit);
  pit.userData.isPit = true;
  pit.userData.bounds = { x, z, hw: w / 2, hd: d / 2 };

  // Edges
  const edgesGeo = new THREE.EdgesGeometry(geo);
  const line = new THREE.LineSegments(edgesGeo, new THREE.LineBasicMaterial({ color: 0x333344 }));
  line.rotation.x = -Math.PI / 2;
  line.position.set(x, 0.006, z);
  scene.add(line);
  levelObstacles.push(line);
  return pit;
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

function deleteWord(wordIdx) {
  const w = words[wordIdx];
  if (!w || w._deleted) return;
  w._deleted = true;

  // Remove arrow
  if (w.arrowHelper) {
    structureGroup.remove(w.arrowHelper);
  }
  // Remove timer sprite
  if (w.timerSprite) {
    structureGroup.remove(w.timerSprite);
  }

  // Shrink-remove cubes that belong only to this word
  const now = performance.now() / 1000;
  for (let i = cubes.length - 1; i >= 0; i--) {
    const c = cubes[i];
    if (c.wordIdx !== wordIdx) continue;

    // Check if another word also uses this position
    const shared = cubes.some(
      (other, oi) => oi !== i && other.gx === c.gx && other.gz === c.gz
    );
    if (shared) continue;

    // Shrink animation then remove
    animations.push({
      mesh: c.mesh,
      startTime: now,
      duration: 0.2,
      soundIndex: 0,
      soundPlayed: true, // don't play pop
      isShrink: true,
      cubeIndex: i,
    });
  }
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
function createTimerSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1, 1, 1);
  sprite.userData.canvas = canvas;
  sprite.userData.texture = tex;
  return sprite;
}

function updateTimerSprite(sprite, remaining, total) {
  const canvas = sprite.userData.canvas;
  const ctx = canvas.getContext('2d');
  const cx = 64, cy = 64, r = 50;
  ctx.clearRect(0, 0, 128, 128);

  // Background circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fill();

  // Progress arc (fills up as timer counts down)
  const progress = 1 - remaining / total;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r - 2, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = remaining > 1 ? '#ff4444' : '#ff8844';
  ctx.fill();

  // Center text
  const sec = Math.ceil(remaining);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 40px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sec > 0 ? String(sec) : '!', cx, cy);

  sprite.userData.texture.needsUpdate = true;
}

function updateVerbTimers() {
  const now = performance.now() / 1000;
  for (const w of words) {
    if (!w.isVerb || w.active) continue;
    const remaining = w.activateAt - now;

    if (remaining <= 0) {
      // Activate!
      w.active = true;
      if (w.timerSprite) {
        structureGroup.remove(w.timerSprite);
        w.timerSprite = null;
      }
      if (w.arrowHelper) w.arrowHelper.visible = true;
      audio.verb();
      showMessage(`"${w.text}" activated!`, '#44ff44');
    } else {
      // Create or update timer sprite
      if (!w.timerSprite) {
        w.timerSprite = createTimerSprite();
        structureGroup.add(w.timerSprite);
      }
      // Position above the middle of the word
      const dv = dirToVec(w.dir);
      const midIdx = Math.floor(w.length / 2);
      const midGx = (w.arrowHelper ? w.arrowHelper.position.x : 0);
      const midGz = (w.arrowHelper ? w.arrowHelper.position.z : 0);
      w.timerSprite.position.set(midGx, 2.2, midGz);
      updateTimerSprite(w.timerSprite, remaining, VERB_DELAY);
    }
  }
}

// ── Direction indicator arrow ──
function updateDirectionArrow() {
  if (!selectedCube) {
    removeDirectionArrow();
    return;
  }
  const dir = dirFromMouse(selectedCube.gx, selectedCube.gy, selectedCube.gz);
  const dv = dirToVec(dir);
  const arrowDir = new THREE.Vector3(dv.x, dv.y || 0, dv.z).normalize();
  // Origin from center of the selected block
  const origin = new THREE.Vector3(
    selectedCube.gx,
    0.5 + (selectedCube.gy || 0),
    selectedCube.gz
  );

  if (directionArrow) {
    directionArrow.position.copy(origin);
    directionArrow.setDirection(arrowDir);
  } else {
    directionArrow = new THREE.ArrowHelper(arrowDir, origin, 2, 0x4488ff, 0.35, 0.2);
    structureGroup.add(directionArrow);
  }
}

function removeDirectionArrow() {
  if (directionArrow) {
    structureGroup.remove(directionArrow);
    directionArrow.dispose();
    directionArrow = null;
  }
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
  velocity.set(0, 0, 0);
  angularVelocity.set(0, 0, 0);
  structureGroup.position.set(0, 0, 0);
  structureGroup.quaternion.identity();
  selectedCube = null;
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

  // Starting word
  const word = getRandomWord();
  const startX = -Math.floor(word.length / 2);
  placeWord(word, startX, 0, 'x+', 0);
  lettersUsed = word.length; // starter word counts

  // Camera target
  controls.target.set(0, 0, 0);
  camera.position.set(6, 8, 10);

  const LEVEL_HINTS = {
    1: 'Push your structure into the red zone using VERBS!',
    2: 'A wall blocks the way. Find a path around it!',
    3: 'The goal is in the air! Build upward momentum!',
    4: 'A pit separates you from the goal. Gain enough speed to cross!',
    5: 'Letter zones! -X deletes words with X. +X deletes words WITHOUT X. Choose your words carefully!',
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
      addPit(7, 0, 4, 8);
      break;

    case 5: {
      // Letter zone level - goal is nearby but zones make it tricky
      createEndZone(12, 4, 4, 4);

      // Generate a grid of letter zones (8-unit blocks)
      const zoneLetters = 'AEIORSTLN';
      const zoneSize = 8;
      // 3x3 grid of zones offset from center
      for (let row = -1; row <= 1; row++) {
        for (let col = 0; col <= 2; col++) {
          const zx = 4 + col * zoneSize;
          const zz = row * zoneSize;
          // Alternate + and - in a checker pattern
          const type = (row + col) % 2 === 0 ? '-' : '+';
          const letter = zoneLetters[Math.floor(Math.random() * zoneLetters.length)];
          addLetterZone(zx, zz, zoneSize, type, letter);
        }
      }
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
function spinWordType(word, types) {
  return new Promise((resolve) => {
    if (types.length === 1) {
      resolve(types[0]);
      return;
    }
    spinnerWord.textContent = word;
    typeSpinner.classList.remove('hidden');
    const finalType = types[Math.floor(Math.random() * types.length)];
    let spins = 0;
    const totalSpins = 12 + Math.floor(Math.random() * 6);
    const tick = () => {
      const t = types[spins % types.length];
      spinnerType.textContent = t;
      spinnerType.className = t.toLowerCase();
      spins++;
      if (spins >= totalSpins) {
        spinnerType.textContent = finalType;
        spinnerType.className = finalType.toLowerCase();
        setTimeout(() => {
          typeSpinner.classList.add('hidden');
          resolve(finalType);
        }, 600);
      } else {
        setTimeout(tick, 80 + spins * 8); // decelerates
      }
    };
    tick();
  });
}

// ── Word submission ──
function submitWord() {
  if (!selectedCube || levelComplete) return;
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
    showMessage(`"${text}" is not a valid word`);
    audio.error();
    return;
  }

  const letter = selectedCube.letter;
  const idx = text.indexOf(letter);
  if (idx === -1) {
    showMessage(`Word must contain the letter [${letter}]`);
    audio.error();
    return;
  }

  // Direction based on mouse position relative to selected cube (3D)
  const dir = dirFromMouse(selectedCube.gx, selectedCube.gy, selectedCube.gz);
  const dv = dirToVec(dir);

  // Calculate starting position so that text[idx] aligns with selectedCube
  const startGx = selectedCube.gx - dv.x * idx;
  const startGy = (selectedCube.gy || 0) - (dv.y || 0) * idx;
  const startGz = selectedCube.gz - dv.z * idx;

  // Check for conflicts - letters at occupied positions must match
  for (let i = 0; i < text.length; i++) {
    const gx = startGx + dv.x * i;
    const gy = startGy + (dv.y || 0) * i;
    const gz = startGz + dv.z * i;
    const existing = cubes.find(c => c.gx === gx && c.gy === gy && c.gz === gz);
    if (existing && existing.letter !== text[i]) {
      showMessage(`Conflict: [${text[i]}] overlaps [${existing.letter}]`);
      audio.error();
      return;
    }
  }

  // Validate crossword adjacency rules
  const adjError = validatePlacement(text, startGx, startGy, startGz, dv);
  if (adjError) {
    showMessage(adjError);
    audio.error();
    return;
  }

  // Easter egg: DAN makes everything explode
  if (text === 'DAN') {
    wordInput.value = '';
    inputContainer.classList.add('hidden');
    explodeStructure();
    return;
  }

  // Check word types and spin if multiple
  const types = getWordTypes(text);
  inputContainer.classList.add('hidden');
  wordInput.value = '';

  const doPlace = (chosenType) => {
    const treatAsVerb = chosenType === 'VERB';
    const wordIdx = words.length;
    const { placed } = placeWord(text, startGx, startGz, dir, wordIdx, true, startGy, treatAsVerb);

    const newLetters = placed.filter(c => c.wordIdx === wordIdx).length;
    lettersUsed += newLetters;

    const typeColors = { VERB: '#ff4444', NOUN: '#4488ff', ADJ: '#44dd88' };
    if (treatAsVerb) {
      showMessage(`VERB: "${text}" applies force! (${lettersUsed} letters used)`, typeColors.VERB);
    } else {
      showMessage(`${chosenType}: "${text}" placed (${lettersUsed} letters used)`, typeColors[chosenType] || '#aaddff');
    }

    selectedCube = null;
    clearHighlight();
    removeDirectionArrow();
    selectedInfoEl.textContent = '';
  };

  if (types.length > 1) {
    spinWordType(text, types).then(doPlace);
  } else {
    doPlace(types[0]);
  }
}

submitBtn.addEventListener('click', submitWord);
wordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitWord();
  e.stopPropagation();
});

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
  showLevelSelect();
});

// ── Level complete & pause handler ──
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && levelComplete && !levelFalling) {
    levelCompleteEl.classList.add('hidden');
    audio.stopMusic();
    showLevelSelect();
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

// ── Helper: get world position of a cube (accounting for group transform) ──
function cubeWorldPos(c) {
  const local = new THREE.Vector3(c.gx, 0.5 + (c.gy || 0), c.gz);
  local.applyQuaternion(structureGroup.quaternion);
  local.add(structureGroup.position);
  return local;
}

let lastCollisionTime = 0; // throttle collision sounds

// ── Physics update ──
function updatePhysics(dt) {
  if (levelComplete) return;
  if (cubes.length === 0) return;

  const com = computeCOM();
  const inertia = computeInertia();

  // ── Apply verb forces at their position (creates torque) ──
  for (const w of words) {
    if (!w.isVerb || !w.active || w._deleted) continue;
    const dv = dirToVec(w.dir);
    const forceMag = VERB_FORCE * w.length;
    const forceVec = new THREE.Vector3(dv.x * forceMag, (dv.y || 0) * forceMag, dv.z * forceMag);

    // Apply at the middle cube of the verb word
    const wordCubes = cubes.filter(c => c.wordIdx === words.indexOf(w));
    if (wordCubes.length === 0) continue;
    const midCube = wordCubes[Math.floor(wordCubes.length / 2)];
    const forcePoint = new THREE.Vector3(midCube.gx, 0.5 + (midCube.gy || 0), midCube.gz);

    // Linear force (applied to COM)
    velocity.add(forceVec.clone().multiplyScalar(dt));

    // Torque = r x F (r = force point - COM)
    const r = forcePoint.clone().sub(com);
    const torque = new THREE.Vector3().crossVectors(r, forceVec);
    angularVelocity.add(torque.multiplyScalar(dt / inertia));
  }

  // ── Gravity ──
  velocity.y -= GRAVITY * dt;

  // ── Linear friction ──
  velocity.x *= FRICTION;
  velocity.z *= FRICTION;

  // ── Angular damping ──
  angularVelocity.multiplyScalar(ANG_FRICTION);

  // ── Move structure ──
  structureGroup.position.x += velocity.x * dt;
  structureGroup.position.y += velocity.y * dt;
  structureGroup.position.z += velocity.z * dt;

  // ── Apply angular velocity to quaternion ──
  const angMag = angularVelocity.length();
  if (angMag > 0.001) {
    const axis = angularVelocity.clone().normalize();
    const dq = new THREE.Quaternion().setFromAxisAngle(axis, angMag * dt);
    structureGroup.quaternion.premultiply(dq);
    structureGroup.quaternion.normalize();
  }

  // ── Ground contact ──
  const lowestY = getLowestPoint();
  if (lowestY < 0) {
    // Push up so lowest point sits at y=0
    structureGroup.position.y -= lowestY;

    // Ground friction on bounce
    if (velocity.y < -0.5) {
      const now = performance.now() / 1000;
      if (now - lastCollisionTime > 0.15) {
        audio.collision();
        lastCollisionTime = now;
      }
    }
    velocity.y *= -0.2; // bounce damping
    if (Math.abs(velocity.y) < 0.3) velocity.y = 0;

    // Ground contact friction for angular velocity (resists rolling)
    angularVelocity.multiplyScalar(0.92);

    // ── Gravitational tipping ──
    // When COM projects outside the ground support base, gravity creates torque
    const halfSz = 0.47;
    const tipCorners = [
      new THREE.Vector3(-halfSz, -halfSz, -halfSz),
      new THREE.Vector3(halfSz, -halfSz, -halfSz),
      new THREE.Vector3(-halfSz, -halfSz, halfSz),
      new THREE.Vector3(halfSz, -halfSz, halfSz),
    ];
    let sMinX = Infinity, sMaxX = -Infinity;
    let sMinZ = Infinity, sMaxZ = -Infinity;
    let hasSupport = false;
    for (const c of cubes) {
      const lp = new THREE.Vector3(c.gx, 0.5 + (c.gy || 0), c.gz);
      for (const corner of tipCorners) {
        const wp = lp.clone().add(corner);
        wp.applyQuaternion(structureGroup.quaternion);
        wp.add(structureGroup.position);
        if (wp.y < 0.1) {
          sMinX = Math.min(sMinX, wp.x);
          sMaxX = Math.max(sMaxX, wp.x);
          sMinZ = Math.min(sMinZ, wp.z);
          sMaxZ = Math.max(sMaxZ, wp.z);
          hasSupport = true;
        }
      }
    }
    if (hasSupport) {
      const comWorld = com.clone().applyQuaternion(structureGroup.quaternion)
        .add(structureGroup.position);
      const clampedX = Math.max(sMinX, Math.min(sMaxX, comWorld.x));
      const clampedZ = Math.max(sMinZ, Math.min(sMaxZ, comWorld.z));
      const overhangX = comWorld.x - clampedX;
      const overhangZ = comWorld.z - clampedZ;
      if (Math.abs(overhangX) > 0.02 || Math.abs(overhangZ) > 0.02) {
        const mass = cubes.length;
        // τ = r × F: overhang in X → torque around Z, overhang in Z → torque around X
        angularVelocity.x += overhangZ * mass * GRAVITY * dt / inertia;
        angularVelocity.z += -overhangX * mass * GRAVITY * dt / inertia;
      }
    }
  }

  // ── Wall collisions (with pushout so it doesn't get stuck) ──
  const sp = structureGroup.position;
  for (const obs of levelObstacles) {
    if (!obs.userData.isWall) continue;
    const wallBox = new THREE.Box3().setFromObject(obs);
    let hitWall = false;
    for (const c of cubes) {
      const wp = cubeWorldPos(c);
      const cubeBox = new THREE.Box3().setFromCenterAndSize(wp, new THREE.Vector3(0.94, 0.94, 0.94));
      if (cubeBox.intersectsBox(wallBox)) {
        // Compute push direction: from wall center to cube
        const wallCenter = new THREE.Vector3();
        wallBox.getCenter(wallCenter);
        const pushDir = wp.clone().sub(wallCenter);
        pushDir.y = 0;
        pushDir.normalize();

        // Push structure out
        structureGroup.position.add(pushDir.clone().multiplyScalar(0.15));

        // Reflect velocity off wall normal
        const velDot = velocity.dot(pushDir);
        if (velDot < 0) {
          velocity.add(pushDir.clone().multiplyScalar(-velDot * 1.3));
        }

        // Add spin from wall hit
        const hitR = wp.clone().sub(structureGroup.position);
        const hitTorque = new THREE.Vector3().crossVectors(hitR, pushDir);
        angularVelocity.add(hitTorque.multiplyScalar(0.3));

        hitWall = true;
        break;
      }
    }
    if (hitWall) {
      const now = performance.now() / 1000;
      if (now - lastCollisionTime > 0.15) {
        audio.collision();
        lastCollisionTime = now;
      }
    }
  }

  // ── Pit detection ──
  for (const obs of levelObstacles) {
    if (!obs.userData.isPit) continue;
    const b = obs.userData.bounds;
    for (const c of cubes) {
      const wp = cubeWorldPos(c);
      if (Math.abs(wp.x - b.x) < b.hw && Math.abs(wp.z - b.z) < b.hd) {
        levelFalling = true;
        velocity.y -= 10 * dt;
        if (structureGroup.position.y < -5) {
          audio.collision();
          showMessage('Fell in the pit! Restarting...', '#ff6b6b');
          levelComplete = true;
          setTimeout(() => startLevel(), 1000);
          return;
        }
        return;
      }
    }
  }

  // ── Check if structure has fallen off the platform edge ──
  const floorEdge = 20;
  let onPlatform = false;
  for (const c of cubes) {
    const wp = cubeWorldPos(c);
    if (Math.abs(wp.x) < floorEdge && Math.abs(wp.z) < floorEdge) {
      onPlatform = true;
      break;
    }
  }
  if (!onPlatform) {
    levelFalling = true;
    velocity.y -= 10 * dt;
    if (structureGroup.position.y < -5) {
      audio.collision();
      showMessage('Fell off! Restarting...', '#ff6b6b');
      levelComplete = true;
      setTimeout(() => startLevel(), 1000);
      return;
    }
    return;
  }

  // ── Check win - any cube in end zone? ──
  if (endZoneBox) {
    for (const c of cubes) {
      const wp = cubeWorldPos(c);
      if (endZoneBox.containsPoint(wp)) {
        levelComplete = true;
        unlockNextLevel(currentLevel);
        levelCompleteEl.querySelector('h1').textContent = 'Level Complete!';
        const isLast = currentLevel >= TOTAL_LEVELS;
        levelCompleteEl.querySelector('p').textContent = isLast
          ? `All levels done! Letters used: ${lettersUsed}`
          : `Letters used: ${lettersUsed} | Press ENTER to continue`;
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
    const pulse = 0.25 + Math.sin(time * 3) * 0.1;
    endZone.material.opacity = pulse;
  }
}

// ── Camera follows structure ──
function updateCamera() {
  controls.target.lerp(structureGroup.position, 0.05);
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
    updateVerbTimers();
    updateLetterZones();
    updateDirectionArrow();
    audio.setMusicIntensity(cubes.length);
    updateExplosion(dt);
    updatePhysics(dt);
    updateCamera();
    animateEndZone(time);
  }
  controls.update();
  renderer.render(scene, camera);
}

// ── Resize ──
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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
    introLoaderText.textContent = getLoadError()
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

async function beginGame() {
  if (gameStarted) return;
  if (!isLoadDone()) return; // don't start until loaded
  gameStarted = true;
  audio.init();
  introScreen.classList.add('hidden');
  showLevelSelect();
}

introScreen.addEventListener('click', beginGame);
window.addEventListener('keydown', (e) => {
  if (!gameStarted && isLoadDone()) beginGame();
});

// ── Start ──
animate();
