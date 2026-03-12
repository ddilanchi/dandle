import { getRandomWord, isValidWord, getWordTypes, isVerb, initWordNet, getLoadProgress, isLoadDone, loadFailed } from './wordlist.js';
import { AudioManager } from './audio.js';

const VERSION = 'v5.0.0';

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

document.getElementById('version').textContent = VERSION;
document.getElementById('intro-version').textContent = VERSION;
const introScreen = document.getElementById('intro-screen');
const pauseScreen = document.getElementById('pause-screen');
const levelSelectEl = document.getElementById('level-select');
const levelGridEl = document.getElementById('level-grid');
let gameStarted = false;
let paused = false;

// ── Settings ──
const DEFAULT_SETTINGS = { shadows: true, fog: true };
function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('dandle_settings') || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) { localStorage.setItem('dandle_settings', JSON.stringify(s)); }
let currentSettings = loadSettings();

const TOTAL_LEVELS = 6;

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

// ── Audio ──
const audio = new AudioManager();

// ── Babylon.js + Havok setup ──
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new BABYLON.Scene(engine);

// Sky color
scene.clearColor = new BABYLON.Color4(0.529, 0.808, 0.922, 1); // sky blue

// Camera
const camera = new BABYLON.ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3, 16, new BABYLON.Vector3(0, 0, 0), scene);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 4;
camera.upperRadiusLimit = 30;
camera.upperBetaLimit = Math.PI / 2 - 0.05;
camera.panningSensibility = 0; // disable panning

// Lights
const ambient = new BABYLON.HemisphericLight('ambient', new BABYLON.Vector3(0, 1, 0), scene);
ambient.intensity = 0.5;
const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -1, -0.3), scene);
sun.intensity = 1.2;
sun.position = new BABYLON.Vector3(8, 15, 10);

// Shadows
let shadowGen = null;
function setupShadows() {
  if (shadowGen) shadowGen.dispose();
  if (currentSettings.shadows) {
    shadowGen = new BABYLON.ShadowGenerator(2048, sun);
    shadowGen.useBlurExponentialShadowMap = true;
  } else {
    shadowGen = null;
  }
}
setupShadows();

// Fog
function applySettings(s) {
  if (s.fog) {
    scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
    scene.fogColor = new BABYLON.Color3(0.529, 0.808, 0.922);
    scene.fogStart = 30;
    scene.fogEnd = 60;
  } else {
    scene.fogMode = BABYLON.Scene.FOGMODE_NONE;
  }
  setupShadows();
}
applySettings(currentSettings);

// ── Havok physics ──
let havokInstance = null;
let hk = null; // HavokPlugin

async function initPhysics() {
  havokInstance = await HavokPhysics();
  hk = new BABYLON.HavokPlugin(true, havokInstance);
  scene.enablePhysics(new BABYLON.Vector3(0, -10, 0), hk);
  console.log('[DANDLE] Babylon.js + Havok', VERSION, 'initialized');
}

// ── Physics constants ──
const CUBE_HALF = 0.5;
const STRUCT_FRICTION = 0.1;
const STRUCT_RESTITUTION = 0.02;
const STATIC_FRICTION = 0.8;

// ── Collision filter groups ──
const CG_GROUND = 1;
const CG_STRUCTURE = 2;
const CG_FLYING = 4;
const CG_DEBRIS = 8;

function setCollisionFiltering(aggregate, membership, collidesWith) {
  if (!aggregate || !aggregate.shape) return;
  aggregate.shape.filterMembershipMask = membership;
  aggregate.shape.filterCollideMask = collidesWith;
}

// ── Game state ──
let selectedCube = null;
let selectedHighlight = null;
let levelComplete = false;
let levelFalling = false;

const cubes = [];       // { letter, gx, gy, gz, mesh, wordIdx, aggregate, constraints[] }
const words = [];       // { text, dir, positions, _deleted }

const FLYING_LETTER_SPEED = 8;
let endZone = null;
let endZoneBox = null;
let directionArrow = null;
let currentDir = 'x+';
let currentLevel = 1;
const levelObstacles = [];
const letterZones = [];
const debrisPieces = [];
const floorMeshes = [];
const floorAggregates = [];

// ── Animation / placement queues ──
const animations = [];
const BLOCK_ANIM_DURATION = 0.35;

let _placementQueue = null;
let _flyingLetter = null; // { cube, targetPos, aggregate }

// ── Ghost preview ──
let _ghostMeshes = [];

// ── Explosion ──
const explosionPieces = [];

// ── Letter mesh creation (canvas texture on box) ──
function makeLetterTexture(letter, bgColor = '#f5ecd7', borderColor = '#999', textColor = '#222') {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 124, 124);
  ctx.fillStyle = textColor;
  ctx.font = 'bold 78px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 68);
  const tex = new BABYLON.DynamicTexture('letterTex_' + letter + '_' + Math.random(), c, scene, false);
  tex.update(false);
  // Copy canvas data
  const texCtx = tex.getContext();
  texCtx.drawImage(c, 0, 0);
  tex.update(false);
  return tex;
}

function makeLetterMaterial(letter, bgColor, borderColor, textColor) {
  const mat = new BABYLON.StandardMaterial('letterMat_' + letter + '_' + Math.random(), scene);
  // Create canvas texture
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bgColor || '#f5ecd7';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = borderColor || '#999';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 124, 124);
  ctx.fillStyle = textColor || '#222';
  ctx.font = 'bold 78px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 68);

  const tex = BABYLON.RawTexture.CreateRGBATexture(
    null, 128, 128, scene, false, false
  );
  // Use DynamicTexture instead
  const dt = new BABYLON.DynamicTexture('dt_' + Math.random(), { width: 128, height: 128 }, scene, false);
  const dtCtx = dt.getContext();
  dtCtx.drawImage(c, 0, 0);
  dt.update(false);
  mat.diffuseTexture = dt;
  return mat;
}

function makeLetterMesh(letter) {
  const mesh = BABYLON.MeshBuilder.CreateBox('cube_' + letter + '_' + Math.random(), { size: 0.94 }, scene);
  const mat = makeLetterMaterial(letter);
  mesh.material = mat;
  if (shadowGen) {
    shadowGen.addShadowCaster(mesh);
    mesh.receiveShadows = true;
  }
  return mesh;
}

function makeGhostMesh(letter) {
  const mesh = BABYLON.MeshBuilder.CreateBox('ghost_' + letter + '_' + Math.random(), { size: 0.94 }, scene);
  const mat = makeLetterMaterial(letter, 'rgba(200, 220, 255, 0.3)', 'rgba(100, 150, 255, 0.5)', 'rgba(50, 80, 200, 0.6)');
  mat.alpha = 0.4;
  mesh.material = mat;
  return mesh;
}

function makeGreyMesh(letter) {
  const mesh = BABYLON.MeshBuilder.CreateBox('grey_' + letter + '_' + Math.random(), { size: 0.94 }, scene);
  const mat = makeLetterMaterial(letter, '#777', '#555', '#333');
  mesh.material = mat;
  if (shadowGen) {
    shadowGen.addShadowCaster(mesh);
    mesh.receiveShadows = true;
  }
  return mesh;
}

// ── Floor building ──
function buildFloor(tiles) {
  // Clean up old floor
  for (const m of floorMeshes) m.dispose();
  for (const a of floorAggregates) a.dispose();
  floorMeshes.length = 0;
  floorAggregates.length = 0;

  if (!tiles) {
    tiles = [];
    for (let xi = -20; xi < 20; xi++)
      for (let zi = -20; zi < 20; zi++)
        tiles.push({ x: xi, z: zi, y: 0 });
  }
  if (tiles.length === 0) return;

  // Group tiles by y-level for efficient merged meshes
  const byY = new Map();
  for (const t of tiles) {
    const y = t.y || 0;
    if (!byY.has(y)) byY.set(y, []);
    byY.get(y).push(t);
  }

  for (const [yLevel, group] of byY) {
    // Create a single large box for each y-level as physics collider
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const t of group) {
      minX = Math.min(minX, t.x);
      maxX = Math.max(maxX, t.x + 1);
      minZ = Math.min(minZ, t.z);
      maxZ = Math.max(maxZ, t.z + 1);
    }

    const green = new BABYLON.Color3(0.416, 0.678, 0.478);
    const beige = new BABYLON.Color3(0.925, 0.878, 0.753);

    // Visual: individual tiles using thin instances
    const tileBox = BABYLON.MeshBuilder.CreateBox('floor_tile', { width: 1, height: 1, depth: 1 }, scene);
    const tileMat = new BABYLON.StandardMaterial('floorMat_' + yLevel, scene);
    tileMat.diffuseColor = green; // base color
    tileBox.material = tileMat;
    tileBox.receiveShadows = true;
    tileBox.isPickable = false;

    // Position the template tile off-screen, use instances
    tileBox.position.set(group[0].x + 0.5, yLevel - 0.5, group[0].z + 0.5);

    // For remaining tiles, use thin instances
    if (group.length > 1) {
      const matrices = [];
      for (let i = 1; i < group.length; i++) {
        const t = group[i];
        const mat = BABYLON.Matrix.Translation(
          (t.x + 0.5) - (group[0].x + 0.5),
          0,
          (t.z + 0.5) - (group[0].z + 0.5)
        );
        matrices.push(mat);
      }
      // Use instances instead of thin instances for simplicity
      for (let i = 1; i < group.length; i++) {
        const t = group[i];
        const inst = tileBox.createInstance('floorInst_' + i);
        inst.position.set(t.x + 0.5, yLevel - 0.5, t.z + 0.5);
        inst.receiveShadows = true;
        inst.isPickable = false;
        floorMeshes.push(inst);
      }
    }
    floorMeshes.push(tileBox);

    // Physics: one big static box per y-level
    const w = maxX - minX;
    const d = maxZ - minZ;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const physBox = BABYLON.MeshBuilder.CreateBox('floorPhys_' + yLevel, { width: w, height: 1, depth: d }, scene);
    physBox.position.set(cx, yLevel - 0.5, cz);
    physBox.isVisible = false;
    const agg = new BABYLON.PhysicsAggregate(physBox, BABYLON.PhysicsShapeType.BOX, {
      mass: 0,
      friction: STATIC_FRICTION,
      restitution: 0.02,
    }, scene);
    setCollisionFiltering(agg, CG_GROUND, CG_STRUCTURE | CG_FLYING | CG_DEBRIS);
    floorAggregates.push(agg);
    floorMeshes.push(physBox);
  }
}

// ── Direction helpers ──
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

// ── Constraint management ──
// Connect a cube to all its grid neighbors with lock constraints
function connectCubeToNeighbors(cube) {
  if (!cube.constraints) cube.constraints = [];
  const gx = cube.gx, gy = cube.gy || 0, gz = cube.gz;

  for (const other of cubes) {
    if (other === cube) continue;
    const ox = other.gx, oy = other.gy || 0, oz = other.gz;
    const dx = Math.abs(gx - ox), dy = Math.abs(gy - oy), dz = Math.abs(gz - oz);
    if (dx + dy + dz !== 1) continue; // not adjacent

    // Create a 6DOF lock constraint between them
    const pivotA = new BABYLON.Vector3((ox - gx) * 0.5, (oy - gy) * 0.5, (oz - gz) * 0.5);
    const pivotB = new BABYLON.Vector3((gx - ox) * 0.5, (gy - oy) * 0.5, (gz - oz) * 0.5);

    const constraint = new BABYLON.Physics6DoFConstraint({
      pivotA,
      pivotB,
      axisA: new BABYLON.Vector3(1, 0, 0),
      axisB: new BABYLON.Vector3(1, 0, 0),
      perpAxisA: new BABYLON.Vector3(0, 1, 0),
      perpAxisB: new BABYLON.Vector3(0, 1, 0),
    }, [
      { axis: BABYLON.PhysicsConstraintAxis.LINEAR_X, minLimit: 0, maxLimit: 0 },
      { axis: BABYLON.PhysicsConstraintAxis.LINEAR_Y, minLimit: 0, maxLimit: 0 },
      { axis: BABYLON.PhysicsConstraintAxis.LINEAR_Z, minLimit: 0, maxLimit: 0 },
      { axis: BABYLON.PhysicsConstraintAxis.ANGULAR_X, minLimit: 0, maxLimit: 0 },
      { axis: BABYLON.PhysicsConstraintAxis.ANGULAR_Y, minLimit: 0, maxLimit: 0 },
      { axis: BABYLON.PhysicsConstraintAxis.ANGULAR_Z, minLimit: 0, maxLimit: 0 },
    ], scene);

    cube.aggregate.body.addConstraint(other.aggregate.body, constraint);
    cube.constraints.push({ constraint, otherCube: other });
    if (!other.constraints) other.constraints = [];
    other.constraints.push({ constraint, otherCube: cube });
  }
}

// Remove all constraints involving a cube
function disconnectCube(cube) {
  if (!cube.constraints) return;
  for (const c of cube.constraints) {
    try { cube.aggregate.body.removeConstraint(c.constraint); } catch (e) {}
    // Remove from the other side too
    if (c.otherCube && c.otherCube.constraints) {
      c.otherCube.constraints = c.otherCube.constraints.filter(oc => oc.constraint !== c.constraint);
    }
  }
  cube.constraints = [];
}

// ── Create a physics cube (structure member) ──
function createStructureCube(letter, gx, gy, gz, wordIdx) {
  const mesh = makeLetterMesh(letter);
  mesh.position.set(gx, 0.5 + gy, gz);

  const aggregate = new BABYLON.PhysicsAggregate(mesh, BABYLON.PhysicsShapeType.BOX, {
    mass: 1,
    friction: STRUCT_FRICTION,
    restitution: STRUCT_RESTITUTION,
  }, scene);

  // Damping
  aggregate.body.setLinearDamping(0.15);
  aggregate.body.setAngularDamping(0.15);

  setCollisionFiltering(aggregate, CG_STRUCTURE, CG_GROUND | CG_STRUCTURE | CG_FLYING | CG_DEBRIS);

  const cube = { letter, gx, gy: gy || 0, gz, mesh, wordIdx, aggregate, constraints: [] };
  mesh.metadata = { cube };
  cubes.push(cube);

  // Connect to neighbors
  connectCubeToNeighbors(cube);

  return cube;
}

// ── Flying letter system ──
function updateFlyingLetter(dt) {
  if (!_flyingLetter) return;
  const fl = _flyingLetter;

  const pos = fl.cube.mesh.position;
  const target = fl.targetPos;
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dz = target.z - pos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist < 0.15) {
    // Arrived — snap and convert to structure cube
    fl.cube.mesh.position.set(target.x, target.y, target.z);

    // Remove the flying aggregate
    if (fl.aggregate) {
      fl.aggregate.dispose();
      fl.cube.aggregate = null;
    }

    // Create proper structure aggregate
    fl.cube.aggregate = new BABYLON.PhysicsAggregate(fl.cube.mesh, BABYLON.PhysicsShapeType.BOX, {
      mass: 1,
      friction: STRUCT_FRICTION,
      restitution: STRUCT_RESTITUTION,
    }, scene);
    fl.cube.aggregate.body.setLinearDamping(0.15);
    fl.cube.aggregate.body.setAngularDamping(0.15);
    setCollisionFiltering(fl.cube.aggregate, CG_STRUCTURE, CG_GROUND | CG_STRUCTURE | CG_FLYING | CG_DEBRIS);

    // Connect to neighbors
    connectCubeToNeighbors(fl.cube);

    _flyingLetter = null;
    audio.pop(_placementQueue ? _placementQueue.index : 0);

    if (_placementQueue) {
      _placementQueue.index++;
      _placeNextLetter();
    }
    return;
  }

  // Apply sustained force toward target
  if (fl.aggregate && fl.aggregate.body) {
    const forceMag = 40;
    const fx = (dx / dist) * forceMag;
    const fy = (dy / dist) * forceMag;
    const fz = (dz / dist) * forceMag;
    fl.aggregate.body.applyForce(
      new BABYLON.Vector3(fx, fy, fz),
      fl.cube.mesh.position
    );
  }
}

function _placeNextLetter() {
  if (!_placementQueue) return;
  const q = _placementQueue;

  if (q.index >= q.letters.length) {
    // All letters placed — apply push impulse
    const pushStrength = 3.0 * q.letters.length;
    const dv = q.dirVec;

    for (const c of cubes) {
      if (c.aggregate && c.aggregate.body) {
        const impulse = new BABYLON.Vector3(
          dv.x * pushStrength / cubes.length,
          (dv.y || 0) * pushStrength / cubes.length,
          dv.z * pushStrength / cubes.length
        );
        c.aggregate.body.applyImpulse(impulse, c.mesh.position);
      }
    }

    _placementQueue = null;
    clearGhosts();

    // Select the last placed letter
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

  // Spawn the next letter as a flying body
  const l = q.letters[q.index];
  const mesh = makeLetterMesh(l.letter);

  // Spawn behind target (opposite build direction)
  const spawnDist = 3;
  const fromX = l.gx - q.dirVec.x * spawnDist;
  const fromY = 0.5 + l.gy - (q.dirVec.y || 0) * spawnDist;
  const fromZ = l.gz - q.dirVec.z * spawnDist;

  mesh.position.set(fromX, fromY, fromZ);

  const cube = { letter: l.letter, gx: l.gx, gy: l.gy, gz: l.gz, mesh, wordIdx: l.wordIdx, aggregate: null, constraints: [] };
  mesh.metadata = { cube };
  cubes.push(cube);

  if (q.index === 0) clearGhosts();

  // Create flying physics body
  const aggregate = new BABYLON.PhysicsAggregate(mesh, BABYLON.PhysicsShapeType.BOX, {
    mass: 1,
    friction: 0.01,
    restitution: 0.02,
  }, scene);
  aggregate.body.setLinearDamping(0.3);
  aggregate.body.setAngularDamping(5); // High angular damping to prevent tumbling

  // Flying letters collide with structure and ground, but NOT other flying letters
  setCollisionFiltering(aggregate, CG_FLYING, CG_GROUND | CG_STRUCTURE);

  cube.aggregate = aggregate;

  const targetPos = new BABYLON.Vector3(l.gx, 0.5 + l.gy, l.gz);
  _flyingLetter = { cube, targetPos, aggregate };
}

// ── Place a word ──
function placeWord(text, startGx, startGz, dir, wordIdx, animated = false, startGy = 0) {
  const dirVec = dirToVec(dir);
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

  const letters = [];
  for (let i = 0; i < text.length; i++) {
    const gx = startGx + dirVec.x * i;
    const gy = startGy + (dirVec.y || 0) * i;
    const gz = startGz + dirVec.z * i;
    const existing = cubes.find(c => c.gx === gx && (c.gy || 0) === gy && c.gz === gz);
    if (existing) continue;
    letters.push({ letter: text[i], gx, gy, gz, wordIdx });
  }

  if (!animated) {
    for (const l of letters) {
      createStructureCube(l.letter, l.gx, l.gy, l.gz, wordIdx);
    }
    return;
  }

  // Animated: flying letters
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
  _placeNextLetter();
}

// ── Ghost preview ──
function clearGhosts() {
  for (const g of _ghostMeshes) g.dispose();
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
    const existing = cubes.find(c => c.gx === gx && (c.gy || 0) === gy && c.gz === gz);
    if (existing) continue;

    const ghost = makeGhostMesh(text[i]);
    ghost.position.set(gx, 0.5 + gy, gz);
    _ghostMeshes.push(ghost);
  }
}

// ── End zone ──
function createEndZone(x, z, w, d, y = 0) {
  const mat = new BABYLON.StandardMaterial('endZoneMat', scene);
  mat.diffuseColor = new BABYLON.Color3(1, 0.2, 0.2);
  mat.emissiveColor = new BABYLON.Color3(1, 0.13, 0.13);
  mat.alpha = 0.55;

  endZone = BABYLON.MeshBuilder.CreateGround('endZone', { width: w, height: d }, scene);
  endZone.position.set(x, y + 0.01, z);
  endZone.material = mat;
  endZone.isPickable = false;

  endZoneBox = new BABYLON.BoundingInfo(
    new BABYLON.Vector3(x - w / 2, y, z - d / 2),
    new BABYLON.Vector3(x + w / 2, y + 2, z + d / 2)
  );

  // Glowing pillar if elevated
  if (y > 0) {
    const pillar = BABYLON.MeshBuilder.CreateBox('pillar', { width: w, height: y, depth: d }, scene);
    const pMat = new BABYLON.StandardMaterial('pillarMat', scene);
    pMat.diffuseColor = new BABYLON.Color3(1, 0.2, 0.2);
    pMat.emissiveColor = new BABYLON.Color3(1, 0.13, 0.13);
    pMat.alpha = 0.25;
    pillar.material = pMat;
    pillar.position.set(x, y / 2, z);
    pillar.isPickable = false;
    levelObstacles.push(pillar);
  }
}

// ── Walls ──
function addWall(x, z, w, h, d) {
  const wall = BABYLON.MeshBuilder.CreateBox('wall', { width: w, height: h, depth: d }, scene);
  const mat = new BABYLON.StandardMaterial('wallMat', scene);
  mat.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.5);
  wall.material = mat;
  wall.position.set(x, h / 2, z);
  if (shadowGen) {
    shadowGen.addShadowCaster(wall);
    wall.receiveShadows = true;
  }
  wall.isPickable = false;
  levelObstacles.push(wall);

  const agg = new BABYLON.PhysicsAggregate(wall, BABYLON.PhysicsShapeType.BOX, {
    mass: 0,
    friction: STATIC_FRICTION,
    restitution: 0.02,
  }, scene);
  setCollisionFiltering(agg, CG_GROUND, CG_STRUCTURE | CG_FLYING | CG_DEBRIS);

  return wall;
}

// ── Zip line ──
function addZipLine(x1, y1, z1, x2, y2, z2, radius = 0.3) {
  const start = new BABYLON.Vector3(x1, y1, z1);
  const end = new BABYLON.Vector3(x2, y2, z2);
  const length = BABYLON.Vector3.Distance(start, end);
  const mid = BABYLON.Vector3.Center(start, end);
  const dir = end.subtract(start).normalize();

  const pole = BABYLON.MeshBuilder.CreateCylinder('zipline', {
    diameter: radius * 2,
    height: length,
    tessellation: 12,
  }, scene);

  const mat = new BABYLON.StandardMaterial('zipMat', scene);
  mat.diffuseColor = new BABYLON.Color3(0.53, 0.53, 0.6);
  mat.specularPower = 64;
  pole.material = mat;
  pole.position.copyFrom(mid);

  // Align cylinder to direction
  const up = new BABYLON.Vector3(0, 1, 0);
  const angle = Math.acos(BABYLON.Vector3.Dot(up, dir));
  const axis = BABYLON.Vector3.Cross(up, dir).normalize();
  if (axis.length() > 0.001) {
    pole.rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis, angle);
  }

  if (shadowGen) {
    shadowGen.addShadowCaster(pole);
    pole.receiveShadows = true;
  }
  pole.isPickable = false;
  levelObstacles.push(pole);

  // Physics: series of box segments
  const segments = Math.ceil(length / 2);
  const segLen = length / segments;
  for (let i = 0; i < segments; i++) {
    const t = (i + 0.5) / segments;
    const pos = BABYLON.Vector3.Lerp(start, end, t);
    const seg = BABYLON.MeshBuilder.CreateBox('zipSeg_' + i, {
      width: radius * 2,
      height: segLen,
      depth: radius * 2,
    }, scene);
    seg.position.copyFrom(pos);
    if (pole.rotationQuaternion) {
      seg.rotationQuaternion = pole.rotationQuaternion.clone();
    }
    seg.isVisible = false;
    const agg = new BABYLON.PhysicsAggregate(seg, BABYLON.PhysicsShapeType.BOX, {
      mass: 0,
      friction: STATIC_FRICTION * 0.3,
      restitution: 0.02,
    }, scene);
    setCollisionFiltering(agg, CG_GROUND, CG_STRUCTURE | CG_FLYING | CG_DEBRIS);
    levelObstacles.push(seg);
  }

  return pole;
}

// ── Letter zones ──
function addLetterZone(cx, cz, size, type, letter) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = type === '-' ? 'rgba(180, 60, 60, 0.55)' : 'rgba(50, 120, 180, 0.55)';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = type === '-' ? '#aa3333' : '#3366aa';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 250, 250);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 120px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${type}${letter}`, 128, 128);

  const dt = new BABYLON.DynamicTexture('zoneTex_' + Math.random(), { width: 256, height: 256 }, scene, false);
  const dtCtx = dt.getContext();
  dtCtx.drawImage(c, 0, 0);
  dt.update(false);

  const mat = new BABYLON.StandardMaterial('zoneMat_' + Math.random(), scene);
  mat.diffuseTexture = dt;
  mat.alpha = 0.7;

  const mesh = BABYLON.MeshBuilder.CreateGround('letterZone', { width: size, height: size }, scene);
  mesh.position.set(cx, 0.02, cz);
  mesh.material = mat;
  mesh.receiveShadows = true;
  mesh.isPickable = false;
  levelObstacles.push(mesh);

  const zone = { x: cx, z: cz, size, type, letter, mesh };
  letterZones.push(zone);
  return zone;
}

function getZoneAt(wx, wz) {
  for (const z of letterZones) {
    const half = z.size / 2;
    if (Math.abs(wx - z.x) < half && Math.abs(wz - z.z) < half) return z;
  }
  return null;
}

// ── Selection highlight ──
function highlightCube(cube) {
  clearHighlight();
  selectedHighlight = BABYLON.MeshBuilder.CreateBox('highlight', { size: 1.0 }, scene);
  const mat = new BABYLON.StandardMaterial('highlightMat', scene);
  mat.diffuseColor = new BABYLON.Color3(1, 0.84, 0);
  mat.alpha = 0.3;
  selectedHighlight.material = mat;
  selectedHighlight.position.copyFrom(cube.mesh.position);
  selectedHighlight.isPickable = false;
}

function clearHighlight() {
  if (selectedHighlight) {
    selectedHighlight.dispose();
    selectedHighlight = null;
  }
}

// ── Direction arrow ──
function updateDirectionArrow() {
  if (!selectedCube) { removeDirectionArrow(); return; }
  const dv = dirToVec(currentDir);
  const arrowDir = new BABYLON.Vector3(dv.x, dv.y || 0, dv.z);
  const origin = cubeWorldPos(selectedCube);

  removeDirectionArrow();

  // Create arrow using lines
  const end = origin.add(arrowDir.scale(2));
  const lines = BABYLON.MeshBuilder.CreateLines('dirArrow', {
    points: [origin, end],
  }, scene);
  lines.color = new BABYLON.Color3(0.27, 0.53, 1);
  lines.isPickable = false;
  directionArrow = lines;

  // Arrowhead
  const headSize = 0.2;
  const headBase = end.subtract(arrowDir.scale(headSize * 2));
  // Simple cone-like arrowhead using lines
  const perp1 = new BABYLON.Vector3(-arrowDir.z, 0, arrowDir.x).normalize().scale(headSize);
  const perp2 = new BABYLON.Vector3(0, 1, 0).scale(headSize);
  const headLines = BABYLON.MeshBuilder.CreateLineSystem('arrowHead', {
    lines: [
      [headBase.add(perp1), end],
      [headBase.subtract(perp1), end],
      [headBase.add(perp2), end],
      [headBase.subtract(perp2), end],
    ],
  }, scene);
  headLines.color = new BABYLON.Color3(0.27, 0.53, 1);
  headLines.isPickable = false;
  directionArrow._head = headLines;

  // Update highlight position too
  if (selectedHighlight) {
    selectedHighlight.position.copyFrom(selectedCube.mesh.position);
  }
}

function removeDirectionArrow() {
  if (directionArrow) {
    if (directionArrow._head) directionArrow._head.dispose();
    directionArrow.dispose();
    directionArrow = null;
  }
}

// ── Helper: cube world position ──
function cubeWorldPos(c) {
  return c.mesh.position.clone();
}

// ── Debris system ──
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
      for (const [ddx, ddy, ddz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const nk = `${cur.gx + ddx},${(cur.gy || 0) + ddy},${cur.gz + ddz}`;
        if (cubeMap.has(nk) && !visited.has(nk)) stack.push(cubeMap.get(nk));
      }
    }
    components.push(component);
  }
  return components;
}

function _spawnDebris(debrisCubes) {
  for (const c of debrisCubes) {
    // Disconnect constraints
    disconnectCube(c);

    // Remove from cubes array
    const idx = cubes.indexOf(c);
    if (idx !== -1) cubes.splice(idx, 1);

    // Change to grey mesh visual
    if (c.mesh && c.mesh.material) {
      c.mesh.material.dispose();
      c.mesh.material = makeLetterMaterial(c.letter, '#777', '#555', '#333');
    }

    // Change collision group to debris
    if (c.aggregate) {
      setCollisionFiltering(c.aggregate, CG_DEBRIS, CG_GROUND | CG_DEBRIS);
    }

    debrisPieces.push({ cube: c });
  }
}

function deleteWord(wordIdx) {
  const w = words[wordIdx];
  if (!w || w._deleted) return;
  w._deleted = true;

  const protectedPositions = new Set();
  for (let wi = 0; wi < words.length; wi++) {
    if (wi === wordIdx || words[wi]._deleted) continue;
    if (!words[wi].positions) continue;
    for (const p of words[wi].positions) protectedPositions.add(`${p.gx},${p.gy},${p.gz}`);
  }

  const thisWordPositions = new Set();
  if (w.positions) {
    for (const p of w.positions) thisWordPositions.add(`${p.gx},${p.gy},${p.gz}`);
  }

  const toDetach = [];
  for (const c of cubes) {
    const key = `${c.gx},${c.gy || 0},${c.gz}`;
    if (thisWordPositions.has(key) && !protectedPositions.has(key)) toDetach.push(c);
  }

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

  // Check remaining for disconnected components
  if (cubes.length <= 1) return;
  const components = _findComponents(cubes);
  if (components.length <= 1) return;

  components.sort((a, b) => b.length - a.length);
  for (let i = 1; i < components.length; i++) {
    _spawnDebris(components[i]);
  }
}

// ── Letter zone updates ──
function updateLetterZones() {
  if (letterZones.length === 0 || levelComplete) return;
  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi];
    if (w._deleted) continue;
    const wordCubes = cubes.filter(c => c.wordIdx === wi);
    for (const c of wordCubes) {
      const wx = c.mesh.position.x;
      const wz = c.mesh.position.z;
      const zone = getZoneAt(wx, wz);
      if (!zone) continue;
      const wordHasLetter = w.text.includes(zone.letter);
      if (zone.type === '-' && wordHasLetter) {
        deleteWord(wi);
        audio.collision();
        showMessage(`"${w.text}" dissolved! Contains [${zone.letter}] in a -${zone.letter} zone`, '#ff6b6b');
        break;
      }
      if (zone.type === '+' && !wordHasLetter) {
        deleteWord(wi);
        audio.collision();
        showMessage(`"${w.text}" dissolved! Missing [${zone.letter}] in a +${zone.letter} zone`, '#ff6b6b');
        break;
      }
    }
  }
}

// ── Keyboard navigation ──
const ALL_DIRS = ['x+', 'x-', 'z+', 'z-', 'y+', 'y-'];

function _getOpenFaces(cube) {
  const gx = cube.gx, gy = cube.gy || 0, gz = cube.gz;
  return ALL_DIRS.filter(dir => {
    const dv = dirToVec(dir);
    const nx = gx + dv.x, ny = gy + (dv.y || 0), nz = gz + dv.z;
    return !cubes.some(c => c.gx === nx && (c.gy || 0) === ny && c.gz === nz);
  });
}

function _handleNavKey(key) {
  if (!selectedCube) return false;
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

// ── Crossword adjacency validation ──
function validatePlacement(text, startGx, startGy, startGz, dv) {
  const perpAxes = [];
  if (dv.x === 0) perpAxes.push({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 });
  if (dv.z === 0) perpAxes.push({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 });
  if ((dv.y || 0) === 0) perpAxes.push({ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 });

  const beforeGx = startGx - dv.x;
  const beforeGy = startGy - (dv.y || 0);
  const beforeGz = startGz - dv.z;
  const afterGx = startGx + dv.x * text.length;
  const afterGy = startGy + (dv.y || 0) * text.length;
  const afterGz = startGz + dv.z * text.length;

  const cubeBefore = cubes.find(c => c.gx === beforeGx && (c.gy || 0) === beforeGy && c.gz === beforeGz);
  const cubeAfter = cubes.find(c => c.gx === afterGx && (c.gy || 0) === afterGy && c.gz === afterGz);
  if (cubeBefore) return `Word would extend from an existing [${cubeBefore.letter}]`;
  if (cubeAfter) return `Word would extend into an existing [${cubeAfter.letter}]`;

  for (let i = 0; i < text.length; i++) {
    const gx = startGx + dv.x * i;
    const gy = startGy + (dv.y || 0) * i;
    const gz = startGz + dv.z * i;
    const existing = cubes.find(c => c.gx === gx && (c.gy || 0) === gy && c.gz === gz);
    if (existing) continue;
    for (const perp of perpAxes) {
      const nx = gx + perp.x, ny = gy + perp.y, nz = gz + perp.z;
      const neighbor = cubes.find(c => c.gx === nx && (c.gy || 0) === ny && c.gz === nz);
      if (neighbor) return `[${text[i]}] would be adjacent to [${neighbor.letter}]`;
    }
  }
  return null;
}

// ── Word submission ──
function submitWord() {
  if (!selectedCube || levelComplete || _placementQueue) return;
  const text = wordInput.value.toUpperCase().trim();
  if (text.length < 2) { showMessage('Word must be at least 2 letters'); audio.error(); return; }
  if (!/^[A-Z]+$/.test(text)) { showMessage('Letters only!'); audio.error(); return; }
  if (!isValidWord(text)) { showMessage(`"${text}" is not a real word`); audio.error(); return; }

  const letter = selectedCube.letter;
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
  let bestIdx = -1, bestError = null;

  for (const idx of allIdx) {
    const sx = selectedCube.gx - dv.x * idx;
    const sy = (selectedCube.gy || 0) - (dv.y || 0) * idx;
    const sz = selectedCube.gz - dv.z * idx;
    let conflict = false;
    for (let i = 0; i < text.length; i++) {
      const gx = sx + dv.x * i, gy = sy + (dv.y || 0) * i, gz = sz + dv.z * i;
      const existing = cubes.find(c => c.gx === gx && (c.gy || 0) === gy && c.gz === gz);
      if (existing && existing.letter !== text[i]) { conflict = true; break; }
    }
    if (conflict) continue;
    const err = validatePlacement(text, sx, sy, sz, dv);
    if (!err) { bestIdx = idx; break; }
    if (!bestError) bestError = err;
  }

  if (bestIdx === -1) { showMessage(bestError || `Cannot place "${text}"`); audio.error(); return; }

  const startGx = selectedCube.gx - dv.x * bestIdx;
  const startGy = (selectedCube.gy || 0) - (dv.y || 0) * bestIdx;
  const startGz = selectedCube.gz - dv.z * bestIdx;

  // Easter egg
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

// ── Explosion ──
function explodeStructure() {
  audio.explode();
  showMessage('DAN?! BOOM!', '#ff2222');

  for (const c of cubes) {
    disconnectCube(c);
    if (c.aggregate && c.aggregate.body) {
      const vx = (Math.random() - 0.5) * 30;
      const vy = 8 + Math.random() * 15;
      const vz = (Math.random() - 0.5) * 30;
      c.aggregate.body.setLinearVelocity(new BABYLON.Vector3(vx, vy, vz));
      c.aggregate.body.setAngularVelocity(new BABYLON.Vector3(
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15
      ));
      setCollisionFiltering(c.aggregate, CG_DEBRIS, CG_GROUND);
    }
    explosionPieces.push(c);
  }

  cubes.length = 0;
  words.length = 0;
  selectedCube = null;
  clearHighlight();
  removeDirectionArrow();
  inputContainer.classList.add('hidden');
  levelComplete = true;

  setTimeout(() => {
    for (const p of explosionPieces) {
      if (p.aggregate) p.aggregate.dispose();
      if (p.mesh) p.mesh.dispose();
    }
    explosionPieces.length = 0;
    startLevel();
  }, 3000);
}

// ── Score tracking ──
let lettersUsed = 0;

// ── Start level ──
function startLevel() {
  // Dispose all cubes
  for (const c of cubes) {
    disconnectCube(c);
    if (c.aggregate) c.aggregate.dispose();
    if (c.mesh) c.mesh.dispose();
  }
  cubes.length = 0;
  words.length = 0;
  animations.length = 0;
  selectedCube = null;
  _placementQueue = null;
  _flyingLetter = null;
  clearGhosts();
  clearHighlight();
  removeDirectionArrow();
  levelComplete = false;
  levelFalling = false;
  lettersUsed = 0;
  levelCompleteEl.classList.add('hidden');
  inputContainer.classList.add('hidden');
  selectedInfoEl.textContent = '';

  // Remove end zone
  if (endZone) { endZone.dispose(); endZone = null; }
  endZoneBox = null;

  // Remove obstacles
  for (const o of levelObstacles) o.dispose();
  levelObstacles.length = 0;
  letterZones.length = 0;

  // Remove debris
  for (const d of debrisPieces) {
    if (d.cube && d.cube.aggregate) d.cube.aggregate.dispose();
    if (d.cube && d.cube.mesh) d.cube.mesh.dispose();
  }
  debrisPieces.length = 0;

  // Remove explosion pieces
  for (const p of explosionPieces) {
    if (p.aggregate) p.aggregate.dispose();
    if (p.mesh) p.mesh.dispose();
  }
  explosionPieces.length = 0;

  // Build floor
  if (currentLevel === 4) {
    const tiles = [];
    for (let x = -8; x < 5; x++)
      for (let z = -5; z < 5; z++) tiles.push({ x, z, y: 0 });
    for (let x = 9; x < 18; x++)
      for (let z = -5; z < 5; z++) tiles.push({ x, z, y: 0 });
    buildFloor(tiles);
  } else if (currentLevel === 5) {
    const tiles = [];
    for (let x = -8; x < 22; x++)
      for (let z = -2; z < 2; z++) tiles.push({ x, z, y: 0 });
    buildFloor(tiles);
  } else if (currentLevel === 6) {
    const tiles = [];
    for (let x = -6; x < 4; x++)
      for (let z = -4; z < 4; z++) tiles.push({ x, z, y: 10 });
    for (let x = 20; x < 30; x++)
      for (let z = -4; z < 4; z++) tiles.push({ x, z, y: 0 });
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

  // Camera
  const camTargetY = startY;
  camera.target = new BABYLON.Vector3(0, camTargetY, 0);
  camera.alpha = -Math.PI / 4;
  camera.beta = Math.PI / 3;
  camera.radius = 16;

  const LEVEL_HINTS = {
    1: 'Build words to push your structure into the red zone!',
    2: 'A wall blocks the way. Find a path around it!',
    3: 'The goal is in the air! Build upward momentum!',
    4: 'Two islands! Bridge the gap or launch across!',
    5: 'Letter zones! -X deletes words with X. +X deletes words WITHOUT X.',
    6: 'Zip line! Build a hook to slide down the pole!',
  };

  switch (currentLevel) {
    case 1: createEndZone(10, 0, 4, 4); break;
    case 2: createEndZone(12, 0, 4, 4); addWall(6, 0, 1, 3, 10); break;
    case 3: createEndZone(10, 0, 4, 4, 4); break;
    case 4: createEndZone(14, 0, 4, 4); break;
    case 5: {
      createEndZone(18, 0, 4, 4, 8);
      const zoneLetters = 'AEIORSTLN';
      for (let col = 0; col < 5; col++) {
        const zx = 2 + col * 3;
        const type = col % 2 === 0 ? '-' : '+';
        const letter = zoneLetters[Math.floor(Math.random() * zoneLetters.length)];
        addLetterZone(zx, 0, 3, type, letter);
      }
      break;
    }
    case 6: {
      createEndZone(25, 0, 4, 4);
      addZipLine(3, 12, 0, 21, 2, 0, 0.3);
      break;
    }
    default: createEndZone(10, 0, 4, 4); break;
  }

  levelInfoEl.textContent = `Level ${currentLevel}`;
  hintEl.textContent = LEVEL_HINTS[currentLevel] || 'Reach the red zone!';
  audio.startMusic(currentLevel);

  console.log('[DANDLE] Level', currentLevel, 'started | cubes:', cubes.length);
}

// ── Click handling ──
let mouseDownPos = { x: 0, y: 0 };
let isDrag = false;

scene.onPointerDown = (evt) => {
  mouseDownPos = { x: evt.clientX, y: evt.clientY };
  isDrag = false;
  audio.init();
};

scene.onPointerMove = (evt) => {
  const dx = evt.clientX - mouseDownPos.x;
  const dy = evt.clientY - mouseDownPos.y;
  if (Math.sqrt(dx * dx + dy * dy) > 5) isDrag = true;
};

scene.onPointerUp = (evt) => {
  if (isDrag || levelComplete) return;

  const pickResult = scene.pick(evt.clientX, evt.clientY, (mesh) => {
    return mesh.metadata && mesh.metadata.cube;
  });

  if (pickResult.hit && pickResult.pickedMesh) {
    const cube = pickResult.pickedMesh.metadata.cube;
    if (!cube) return;
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
};

// ── Input handlers ──
submitBtn.addEventListener('click', submitWord);
wordInput.addEventListener('blur', () => {
  if (selectedCube && !levelComplete && !paused && !_placementQueue) {
    setTimeout(() => wordInput.focus(), 0);
  }
});
wordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { submitWord(); return; }
  if (e.key.startsWith('Arrow')) return;
  if (e.shiftKey && _handleNavKey(e.key.toUpperCase())) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  e.stopPropagation();
});
wordInput.addEventListener('input', updateGhostPreview);

// ── UI buttons ──
restartBtn.addEventListener('click', () => { audio.stopMusic(); startLevel(); });
document.getElementById('level-select-btn').addEventListener('click', () => {
  audio.stopMusic();
  showLevelSelect();
});

// ── Settings ──
const settingsScreen = document.getElementById('settings-screen');
const settingsBtn = document.getElementById('settings-btn');
const settingsClose = document.getElementById('settings-close');

function syncSettingsUI() {
  document.getElementById('setting-shadows').checked = currentSettings.shadows;
  document.getElementById('setting-fog').checked = currentSettings.fog;
}

settingsBtn.addEventListener('click', () => { syncSettingsUI(); settingsScreen.classList.remove('hidden'); });
settingsClose.addEventListener('click', () => settingsScreen.classList.add('hidden'));

['shadows', 'fog'].forEach(key => {
  document.getElementById(`setting-${key}`).addEventListener('change', (e) => {
    currentSettings[key] = e.target.checked;
    applySettings(currentSettings);
    saveSettings(currentSettings);
  });
});

// ── Level complete ──
function advanceLevel() {
  if (levelFalling) return;
  levelCompleteEl.classList.add('hidden');
  audio.stopMusic();
  currentLevel = currentLevel < TOTAL_LEVELS ? currentLevel + 1 : 1;
  startLevel();
}
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' && levelComplete && !levelCompleteEl.classList.contains('hidden')) {
    e.preventDefault();
    advanceLevel();
  }
});
levelCompleteEl.addEventListener('click', advanceLevel);

// ── Camera orbit keys ──
const _cameraKeys = new Set();
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    _cameraKeys.add(e.key);
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => _cameraKeys.delete(e.key));

function updateCameraKeys() {
  if (_cameraKeys.size === 0) return;
  const speed = 0.03;
  if (_cameraKeys.has('ArrowLeft')) camera.alpha -= speed;
  if (_cameraKeys.has('ArrowRight')) camera.alpha += speed;
  if (_cameraKeys.has('ArrowUp')) camera.beta = Math.max(0.1, camera.beta - speed);
  if (_cameraKeys.has('ArrowDown')) camera.beta = Math.min(camera.upperBetaLimit, camera.beta + speed);
}

// ── Pause ──
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !settingsScreen.classList.contains('hidden')) {
    settingsScreen.classList.add('hidden');
    return;
  }
  if (e.key === 'Escape' && gameStarted) {
    paused = !paused;
    pauseScreen.classList.toggle('hidden', !paused);
    if (paused) audio.stopMusic();
    else audio.startMusic(currentLevel);
  }
});

// ── Global shift nav ──
window.addEventListener('keydown', (e) => {
  if (!e.shiftKey || levelComplete || paused || _placementQueue) return;
  const key = e.key.toUpperCase();
  if ('WASDEQ '.includes(key) || key === ' ') {
    if (_handleNavKey(key === ' ' ? ' ' : key)) e.preventDefault();
  }
});

// ── Game loop updates ──
function updatePhysics() {
  if (levelComplete) return;

  // Update highlight position
  if (selectedHighlight && selectedCube) {
    selectedHighlight.position.copyFrom(selectedCube.mesh.position);
  }

  // Fell off edge
  const floorEdge = 20;
  let onPlatform = false;
  for (const c of cubes) {
    const wp = c.mesh.position;
    if (Math.abs(wp.x) < floorEdge && Math.abs(wp.z) < floorEdge) { onPlatform = true; break; }
  }
  if (!onPlatform && cubes.length > 0) {
    levelFalling = true;
    const firstCube = cubes[0];
    if (firstCube.mesh.position.y < -5) {
      showMessage('Fell off! Restarting...', '#ff6b6b');
      levelComplete = true;
      setTimeout(() => startLevel(), 1000);
      return;
    }
    return;
  }

  // Clean up debris that fell too far
  for (let i = debrisPieces.length - 1; i >= 0; i--) {
    const d = debrisPieces[i];
    if (d.cube && d.cube.mesh && d.cube.mesh.position.y < -20) {
      if (d.cube.aggregate) d.cube.aggregate.dispose();
      if (d.cube.mesh) d.cube.mesh.dispose();
      debrisPieces.splice(i, 1);
    }
  }

  // Win check
  if (endZoneBox) {
    for (const c of cubes) {
      const wp = c.mesh.position;
      if (wp.x >= endZoneBox.minimum.x && wp.x <= endZoneBox.maximum.x &&
          wp.y >= endZoneBox.minimum.y && wp.y <= endZoneBox.maximum.y &&
          wp.z >= endZoneBox.minimum.z && wp.z <= endZoneBox.maximum.z) {
        levelComplete = true;
        unlockNextLevel(currentLevel);
        const isLast = currentLevel >= TOTAL_LEVELS;
        levelCompleteEl.querySelector('h1').textContent = 'Level Complete!';
        levelCompleteEl.querySelector('p').textContent = isLast
          ? `All ${TOTAL_LEVELS} levels done! Letters used: ${lettersUsed}`
          : `Letters used: ${lettersUsed} -- press SPACE to continue`;
        levelCompleteEl.classList.remove('hidden');
        audio.levelComplete();
        return;
      }
    }
  }
}

function animateEndZone(time) {
  if (endZone && endZone.material) {
    endZone.material.alpha = 0.45 + Math.sin(time * 3) * 0.15;
  }
}

function updateCamera() {
  let target;
  if (selectedCube) {
    target = selectedCube.mesh.position;
  } else if (cubes.length > 0) {
    target = cubes[0].mesh.position;
  } else {
    return;
  }
  camera.target = BABYLON.Vector3.Lerp(camera.target, target, 0.06);
}

// ── Intro screen ──
const startPromptEl = document.getElementById('intro-start');
const introLoaderBar = document.getElementById('intro-loader-bar');
const introLoaderText = document.getElementById('intro-loader-text');
const introLoader = document.getElementById('intro-loader');

let _fakeProgress = 0;
(function pollProgress() {
  if (isLoadDone()) {
    introLoaderBar.style.setProperty('--progress', '100%');
    introLoaderText.textContent = loadFailed() ? 'Playing without dictionary' : 'Dictionary ready!';
    setTimeout(() => {
      introLoader.style.opacity = '0.4';
      startPromptEl.classList.remove('hidden');
    }, 300);
    return;
  }
  _fakeProgress += (0.9 - _fakeProgress) * 0.04;
  introLoaderBar.style.setProperty('--progress', Math.round(_fakeProgress * 100) + '%');
  introLoaderText.textContent = 'Loading dictionary...';
  setTimeout(pollProgress, 80);
})();

let audioStarted = false;
function tryStartTitleMusic() {
  if (audioStarted) return;
  audioStarted = true;
  audio.init();
  audio.startMusic(0);
}

async function beginGame() {
  if (gameStarted) return;
  tryStartTitleMusic();
  if (!isLoadDone()) return;

  // Init physics first
  await initPhysics();

  gameStarted = true;
  introScreen.classList.add('hidden');
  currentLevel = 1;
  startLevel();
}

introScreen.addEventListener('click', beginGame);
window.addEventListener('keydown', () => {
  if (!gameStarted) beginGame();
});

// ── Main render loop ──
let _lastTime = 0;
scene.registerBeforeRender(() => {
  const time = performance.now() / 1000;
  const dt = Math.min(time - _lastTime, 0.05);
  _lastTime = time;

  if (paused) return;

  updateFlyingLetter(dt);
  updateLetterZones();
  updateDirectionArrow();
  audio.setMusicIntensity(cubes.length);
  updatePhysics();
  updateCamera();
  updateCameraKeys();
  animateEndZone(time);
});

// ── Resize ──
window.addEventListener('resize', () => engine.resize());

// ── Start engine ──
engine.runRenderLoop(() => scene.render());

console.log('[DANDLE]', VERSION, 'engine started');
