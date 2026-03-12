import { getRandomWord, isValidWord, getWordTypes, isVerb, initWordNet, getLoadProgress, isLoadDone, loadFailed } from './wordlist.js';
import { AudioManager } from './audio.js';

const VERSION = 'v5.3.3';

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
camera.upperRadiusLimit = 50;
camera.upperBetaLimit = Math.PI / 2 - 0.05;
camera.panningSensibility = 100;
// Left-click (0) = orbit only. Middle (1) and Right (2) = pan.
camera.inputs.attached.pointers.buttons = [0];

// Lights
const ambient = new BABYLON.HemisphericLight('ambient', new BABYLON.Vector3(0, 1, 0), scene);
ambient.intensity = 0.7;
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
    scene.fogStart = 50;
    scene.fogEnd = 90;
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
// ── Ghost preview ──
let _ghostMeshes = [];

// ── Explosion ──
const explosionPieces = [];

// ── Make materials matte by default ──
function _matte(mat) {
  mat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  mat.specularPower = 4;
  return mat;
}

// ── Letter mesh creation (canvas texture on box) ──
function _makeCanvasTex(letter, bgColor, borderColor, textColor) {
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
  return c.toDataURL();
}

function makeLetterMaterial(letter, bgColor, borderColor, textColor) {
  const mat = new BABYLON.StandardMaterial('letterMat_' + letter + '_' + Math.random(), scene);
  const dataUrl = _makeCanvasTex(letter, bgColor, borderColor, textColor);
  const tex = new BABYLON.Texture(dataUrl, scene, false, true);
  mat.diffuseTexture = tex;
  _matte(mat);
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

    // Two materials for checkerboard
    const greenMat = _matte(new BABYLON.StandardMaterial('floorGreen_' + yLevel, scene));
    greenMat.diffuseColor = new BABYLON.Color3(0.416, 0.678, 0.478);
    const beigeMat = _matte(new BABYLON.StandardMaterial('floorBeige_' + yLevel, scene));
    beigeMat.diffuseColor = new BABYLON.Color3(0.925, 0.878, 0.753);

    // Template boxes for each color (instances share parent material)
    const greenBox = BABYLON.MeshBuilder.CreateBox('floor_green', { width: 1, height: 1, depth: 1 }, scene);
    greenBox.material = greenMat;
    greenBox.receiveShadows = true;
    greenBox.isPickable = false;
    greenBox.setEnabled(false); // template only

    const beigeBox = BABYLON.MeshBuilder.CreateBox('floor_beige', { width: 1, height: 1, depth: 1 }, scene);
    beigeBox.material = beigeMat;
    beigeBox.receiveShadows = true;
    beigeBox.isPickable = false;
    beigeBox.setEnabled(false); // template only

    for (const t of group) {
      const isGreen = (t.x + t.z) % 2 === 0;
      const parent = isGreen ? greenBox : beigeBox;
      const inst = parent.createInstance('floorInst_' + t.x + '_' + t.z);
      inst.position.set(t.x + 0.5, yLevel - 0.5, t.z + 0.5);
      inst.receiveShadows = true;
      inst.isPickable = false;
      floorMeshes.push(inst);
    }
    floorMeshes.push(greenBox);
    floorMeshes.push(beigeBox);

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
    console.log(`[CONSTRAINT] "${cube.letter}"(${gx},${gy},${gz}) <-> "${other.letter}"(${ox},${oy},${oz}) pivotA=${_v3str(pivotA)} pivotB=${_v3str(pivotB)}`);
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

  // Position relative to an existing neighbor's ACTUAL position (not grid),
  // so the lock constraint doesn't have to snap a positional mismatch.
  let placed = false;
  for (const other of cubes) {
    const ox = other.gx, oy = other.gy || 0, oz = other.gz;
    const dx = Math.abs(gx - ox), dy = Math.abs((gy || 0) - oy), dz = Math.abs(gz - oz);
    if (dx + dy + dz === 1) {
      // Found a neighbor — offset from their actual position
      const op = other.mesh.position;
      mesh.position.set(
        op.x + (gx - ox),
        op.y + ((gy || 0) - oy),
        op.z + (gz - oz)
      );
      placed = true;
      break;
    }
  }
  if (!placed) {
    // No neighbor (first cube) — use grid position
    mesh.position.set(gx, 0.5 + (gy || 0), gz);
  }

  const aggregate = new BABYLON.PhysicsAggregate(mesh, BABYLON.PhysicsShapeType.BOX, {
    mass: 1,
    friction: STRUCT_FRICTION,
    restitution: STRUCT_RESTITUTION,
  }, scene);

  // Damping
  aggregate.body.setLinearDamping(0.15);
  aggregate.body.setAngularDamping(0.15);

  // Copy neighbor velocity so constraint doesn't jerk
  for (const other of cubes) {
    if (!other.aggregate?.body) continue;
    const ox = other.gx, oy = other.gy || 0, oz = other.gz;
    const dx = Math.abs(gx - ox), dy = Math.abs((gy || 0) - oy), dz = Math.abs(gz - oz);
    if (dx + dy + dz === 1) {
      const lv = other.aggregate.body.getLinearVelocity();
      const av = other.aggregate.body.getAngularVelocity();
      aggregate.body.setLinearVelocity(lv);
      aggregate.body.setAngularVelocity(av);
      break;
    }
  }

  setCollisionFiltering(aggregate, CG_STRUCTURE, CG_GROUND | CG_STRUCTURE | CG_FLYING | CG_DEBRIS);

  const cube = { letter, gx, gy: gy || 0, gz, mesh, wordIdx, aggregate, constraints: [] };
  mesh.metadata = { cube };
  cubes.push(cube);

  // Connect to neighbors
  connectCubeToNeighbors(cube);

  return cube;
}

// ── Staggered letter placement (instant physics, animated scale-in) ──
function _v3str(v) {
  return `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
}

function _placeNextLetter() {
  if (!_placementQueue) return;
  const q = _placementQueue;

  if (q.index >= q.letters.length) {
    // All letters placed — start a sustained reaction push
    const dv = q.dirVec;
    const wordLen = q.letters.length;
    _placementQueue = null;
    clearGhosts();

    // Grey out any cubes disconnected from the starting word
    _checkDisconnected();

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

  // Place this letter instantly at its grid position
  const l = q.letters[q.index];

  // If this letter would go underground, lift everything up by 1
  if (l.gy < 0) {
    // Remember which cubes to animate and their current positions
    const liftCubes = cubes.map(c => ({ cube: c, startY: c.mesh.position.y }));

    // Shift grid coords and physics positions up by 1
    for (const c of cubes) {
      c.gy = (c.gy || 0) + 1;
      const pos = c.mesh.position;
      c.mesh.position.set(pos.x, pos.y + 1, pos.z);
      if (c.aggregate && c.aggregate.body) {
        c.aggregate.body.disablePreStep = false;
      }
    }
    for (const w of words) {
      if (w.positions) {
        for (const p of w.positions) p.gy = (p.gy || 0) + 1;
      }
    }
    for (const ll of q.letters) {
      ll.gy += 1;
    }
    q.startGy += 1;

    // Squash-and-stretch bounce on each lifted cube
    for (const entry of liftCubes) {
      animations.push({
        cube: entry.cube,
        startTime: performance.now() / 1000,
        duration: 0.2,
        type: 'bounce',
      });
    }
  }

  const cube = createStructureCube(l.letter, l.gx, l.gy, l.gz, l.wordIdx);

  // Scale-in animation
  cube.mesh.scaling.set(0.01, 0.01, 0.01);
  const anim = { cube, startTime: performance.now() / 1000, duration: 0.2 };
  animations.push(anim);

  audio.pop(q.index);

  if (q.index === 0) clearGhosts();

  // Next letter after a short delay
  q.index++;
  if (q.index < q.letters.length) {
    setTimeout(() => _placeNextLetter(), 120);
  } else {
    setTimeout(() => _placeNextLetter(), 120);
  }
}

// ── Place a word ──
function placeWord(text, startGx, startGz, dir, wordIdx, animated = false, startGy = 0) {
  const dirVec = dirToVec(dir);

  // Calculate raw positions
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
    const gx = allPositions[i].gx;
    const gy = allPositions[i].gy;
    const gz = allPositions[i].gz;
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
    if (!conflict) {
      const err = validatePlacement(text, sx, sy, sz, dv);
      if (!err) { bestIdx = idx; break; }
    }
  }
  if (bestIdx === -1) return;

  const startGx = selectedCube.gx - dv.x * bestIdx;
  const startGy = (selectedCube.gy || 0) - (dv.y || 0) * bestIdx;
  const startGz = selectedCube.gz - dv.z * bestIdx;

  // Position ghosts relative to selected cube's actual position & rotation
  // so they follow the structure even when it's rotated
  const selPos = selectedCube.mesh.position;
  const selGx = selectedCube.gx;
  const selGy = selectedCube.gy || 0;
  const selGz = selectedCube.gz;
  const rot = selectedCube.mesh.rotationQuaternion || BABYLON.Quaternion.Identity();
  const rotMatrix = new BABYLON.Matrix();
  rot.toRotationMatrix(rotMatrix);

  for (let i = 0; i < text.length; i++) {
    const gx = startGx + dv.x * i;
    const gy = startGy + (dv.y || 0) * i;
    const gz = startGz + dv.z * i;
    const existing = cubes.find(c => c.gx === gx && (c.gy || 0) === gy && c.gz === gz);
    if (existing) continue;

    // Grid offset from selected cube
    const offsetGrid = new BABYLON.Vector3(gx - selGx, gy - selGy, gz - selGz);
    // Rotate offset by structure's rotation
    const rotatedOffset = BABYLON.Vector3.TransformCoordinates(offsetGrid, rotMatrix);

    const ghost = makeGhostMesh(text[i]);
    ghost.position.set(
      selPos.x + rotatedOffset.x,
      selPos.y + rotatedOffset.y,
      selPos.z + rotatedOffset.z
    );
    ghost.rotationQuaternion = rot.clone();
    _ghostMeshes.push(ghost);
  }
}

// ── End zone ──
function createEndZone(x, z, w, d, y = 0) {
  const mat = new BABYLON.StandardMaterial('endZoneMat', scene);
  mat.diffuseColor = new BABYLON.Color3(1, 0.15, 0.15);
  mat.emissiveColor = new BABYLON.Color3(1, 0.3, 0.2);
  mat.alpha = 0.7;

  endZone = BABYLON.MeshBuilder.CreateGround('endZone', { width: w, height: d }, scene);
  endZone.position.set(x, y + 0.01, z);
  endZone.material = mat;
  endZone.isPickable = false;

  endZoneBox = new BABYLON.BoundingInfo(
    new BABYLON.Vector3(x - w / 2, y, z - d / 2),
    new BABYLON.Vector3(x + w / 2, y + 2, z + d / 2)
  );

  // Vertical beacon — tall glowing pillar visible from far away
  const beaconH = 12;
  const beacon = BABYLON.MeshBuilder.CreateBox('beacon', { width: 0.3, height: beaconH, depth: 0.3 }, scene);
  const bMat = new BABYLON.StandardMaterial('beaconMat', scene);
  bMat.diffuseColor = new BABYLON.Color3(1, 0.2, 0.2);
  bMat.emissiveColor = new BABYLON.Color3(1, 0.4, 0.3);
  bMat.alpha = 0.5;
  beacon.material = bMat;
  beacon.position.set(x, y + beaconH / 2, z);
  beacon.isPickable = false;
  levelObstacles.push(beacon);

  // Glowing pillar if elevated
  if (y > 0) {
    const pillar = BABYLON.MeshBuilder.CreateBox('pillar', { width: w, height: y, depth: d }, scene);
    const pMat = new BABYLON.StandardMaterial('pillarMat', scene);
    pMat.diffuseColor = new BABYLON.Color3(1, 0.2, 0.2);
    pMat.emissiveColor = new BABYLON.Color3(1, 0.2, 0.15);
    pMat.alpha = 0.3;
    pillar.material = pMat;
    pillar.position.set(x, y / 2, z);
    pillar.isPickable = false;
    levelObstacles.push(pillar);
  }
}

// ── Walls ──
function addWall(x, z, w, h, d) {
  const wall = BABYLON.MeshBuilder.CreateBox('wall', { width: w, height: h, depth: d }, scene);
  const mat = _matte(new BABYLON.StandardMaterial('wallMat', scene));
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

  const mat = _matte(new BABYLON.StandardMaterial('zipMat', scene));
  mat.diffuseColor = new BABYLON.Color3(0.53, 0.53, 0.6);
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
let _arrowShaft = null;
let _arrowCone = null;
let _arrowMat = null;
let _arrowLastCube = null;
let _arrowLastDir = null;

function _ensureArrowMeshes() {
  if (_arrowShaft) return;

  _arrowMat = new BABYLON.StandardMaterial('arrowMat', scene);
  _arrowMat.diffuseColor = new BABYLON.Color3(0.27, 0.53, 1);
  _arrowMat.emissiveColor = new BABYLON.Color3(0.3, 0.5, 1);
  _arrowMat.disableLighting = true;

  _arrowShaft = BABYLON.MeshBuilder.CreateCylinder('arrowShaft', {
    diameter: 0.1,
    height: 1.5,
    tessellation: 8,
  }, scene);
  _arrowShaft.material = _arrowMat;
  _arrowShaft.isPickable = false;
  _arrowShaft.renderingGroupId = 1; // render on top

  _arrowCone = BABYLON.MeshBuilder.CreateCylinder('arrowCone', {
    diameterTop: 0,
    diameterBottom: 0.3,
    height: 0.4,
    tessellation: 8,
  }, scene);
  _arrowCone.material = _arrowMat;
  _arrowCone.isPickable = false;
  _arrowCone.renderingGroupId = 1;
}

function _positionArrow(origin, arrowDir) {
  const shaftLen = 1.5;

  // Shaft center
  const shaftCenter = origin.add(arrowDir.scale(shaftLen / 2 + 0.55));
  _arrowShaft.position.copyFrom(shaftCenter);

  // Align cylinder (Y-up default) to arrowDir
  const up = new BABYLON.Vector3(0, 1, 0);
  const dot = BABYLON.Vector3.Dot(up, arrowDir);
  if (Math.abs(dot) > 0.999) {
    // Parallel to Y — use simple rotation
    if (dot < 0) {
      _arrowShaft.rotationQuaternion = BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(1, 0, 0), Math.PI);
    } else {
      _arrowShaft.rotationQuaternion = BABYLON.Quaternion.Identity();
    }
  } else {
    const axis = BABYLON.Vector3.Cross(up, arrowDir).normalize();
    const angle = Math.acos(dot);
    _arrowShaft.rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis, angle);
  }

  // Cone tip
  const tipPos = origin.add(arrowDir.scale(shaftLen + 0.55 + 0.2));
  _arrowCone.position.copyFrom(tipPos);
  _arrowCone.rotationQuaternion = _arrowShaft.rotationQuaternion.clone();
}

function updateDirectionArrow() {
  if (!selectedCube) { removeDirectionArrow(); return; }

  _ensureArrowMeshes();
  _arrowShaft.setEnabled(true);
  _arrowCone.setEnabled(true);

  const dv = dirToVec(currentDir);
  const gridDir = new BABYLON.Vector3(dv.x, dv.y || 0, dv.z);
  // Rotate arrow direction by the structure's rotation
  const rot = selectedCube.mesh.rotationQuaternion || BABYLON.Quaternion.Identity();
  const rotMatrix = new BABYLON.Matrix();
  rot.toRotationMatrix(rotMatrix);
  const arrowDir = BABYLON.Vector3.TransformCoordinates(gridDir, rotMatrix).normalize();
  const origin = cubeWorldPos(selectedCube);

  _positionArrow(origin, arrowDir);
  directionArrow = _arrowShaft; // mark as active

  if (selectedHighlight) {
    selectedHighlight.position.copyFrom(selectedCube.mesh.position);
  }
}

function removeDirectionArrow() {
  if (_arrowShaft) _arrowShaft.setEnabled(false);
  if (_arrowCone) _arrowCone.setEnabled(false);
  directionArrow = null;
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

// Check for cubes disconnected from the starting word and turn them to debris
function _checkDisconnected() {
  if (cubes.length <= 1) return;
  // Find a root cube (from wordIdx 0 — the starting word)
  const root = cubes.find(c => c.wordIdx === 0);
  if (!root) return;

  // BFS from root to find all connected cubes
  const key = c => `${c.gx},${c.gy || 0},${c.gz}`;
  const cubeMap = new Map();
  for (const c of cubes) cubeMap.set(key(c), c);
  const visited = new Set();
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    const ck = key(cur);
    if (visited.has(ck)) continue;
    visited.add(ck);
    for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const nk = `${cur.gx + dx},${(cur.gy || 0) + dy},${cur.gz + dz}`;
      if (cubeMap.has(nk) && !visited.has(nk)) stack.push(cubeMap.get(nk));
    }
  }

  // Any cube not visited is disconnected
  const disconnected = cubes.filter(c => !visited.has(key(c)));
  if (disconnected.length > 0) {
    // Deselect if selected cube is disconnected
    if (selectedCube && disconnected.includes(selectedCube)) {
      selectedCube = null;
      clearHighlight();
      removeDirectionArrow();
      selectedInfoEl.textContent = '';
      inputContainer.classList.add('hidden');
    }
    _spawnDebris(disconnected);
  }
}

function _spawnDebris(debrisCubes) {
  // First pass: disconnect ALL constraints from all debris cubes
  for (const c of debrisCubes) {
    disconnectCube(c);
  }
  // Second pass: also remove any constraints that connected cubes still have to debris
  for (const c of debrisCubes) {
    for (const active of cubes) {
      if (!active.constraints) continue;
      active.constraints = active.constraints.filter(con => {
        if (con.otherCube === c) {
          try { active.aggregate.body.removeConstraint(con.constraint); } catch (e) {}
          return false;
        }
        return true;
      });
    }
  }

  for (const c of debrisCubes) {
    // Remove from cubes array
    const idx = cubes.indexOf(c);
    if (idx !== -1) cubes.splice(idx, 1);

    // Change to grey mesh visual
    if (c.mesh && c.mesh.material) {
      c.mesh.material.dispose();
      c.mesh.material = makeLetterMaterial(c.letter, '#777', '#555', '#333');
    }

    // Change collision group to debris — only collides with ground/debris
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
      const wy = c.mesh.position.y;
      const wz = c.mesh.position.z;
      // Only trigger zones on surface contact (cube near ground level)
      if (wy > 1.5) continue;
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

  // Fixed world-axis navigation: W/S = Z, A/D = X, Q/E = Y
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

  // Reject consecutive duplicate letters (same letter tiles adjacent along word axis)
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === text[i + 1]) return `Adjacent same letters [${text[i]}][${text[i]}] not allowed`;
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
        const zx = 5 + col * 3;
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

scene.onPointerObservable.add((pointerInfo) => {
  const evt = pointerInfo.event;
  switch (pointerInfo.type) {
    case BABYLON.PointerEventTypes.POINTERDOWN:
      mouseDownPos = { x: evt.clientX, y: evt.clientY };
      isDrag = false;
      audio.init();
      break;
    case BABYLON.PointerEventTypes.POINTERMOVE: {
      const dx = evt.clientX - mouseDownPos.x;
      const dy = evt.clientY - mouseDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) isDrag = true;
      break;
    }
    case BABYLON.PointerEventTypes.POINTERUP: {
      if (isDrag || levelComplete) return;

      const pickResult = scene.pick(evt.clientX, evt.clientY, (mesh) => {
        return mesh.metadata && mesh.metadata.cube && cubes.includes(mesh.metadata.cube);
      });

      if (pickResult.hit && pickResult.pickedMesh) {
        const cube = pickResult.pickedMesh.metadata.cube;
        if (!cube || !cubes.includes(cube)) return;
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
      break;
    }
  }
});

// ── Input handlers ──
submitBtn.addEventListener('click', submitWord);
// No auto-refocus on blur — let canvas keep focus for camera orbiting
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
let _physLogTimer = 0;
function updatePhysics() {
  if (levelComplete) return;

  // Log structure state every 2 seconds
  _physLogTimer++;
  if (_physLogTimer % 120 === 1 && cubes.length > 0) {
    let maxVel = 0;
    let maxVelCube = null;
    for (const c of cubes) {
      if (!c.aggregate?.body) continue;
      const v = c.aggregate.body.getLinearVelocity();
      const speed = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
      if (speed > maxVel) { maxVel = speed; maxVelCube = c; }
    }
    const first = cubes[0];
    const fp = first.mesh.position;
    console.log(`[PHYS] tick=${_physLogTimer} cubes=${cubes.length} first=[${first.letter}] pos=${_v3str(fp)} maxSpeed=${maxVel.toFixed(2)} (${maxVelCube?.letter}) queue=${!!_placementQueue} anims=${animations.length}`);
  }

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
    endZone.material.alpha = 0.55 + Math.sin(time * 3) * 0.2;
    endZone.material.emissiveColor.r = 1;
    endZone.material.emissiveColor.g = 0.2 + Math.sin(time * 2) * 0.1;
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
  camera.target = BABYLON.Vector3.Lerp(camera.target, target, 0.12);
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

  // Cube animations
  for (let i = animations.length - 1; i >= 0; i--) {
    const a = animations[i];
    const t = Math.min((time - a.startTime) / a.duration, 1);
    if (a.type === 'bounce') {
      // Squash then stretch then settle: sin curve that overshoots
      const bounce = 1 + Math.sin(t * Math.PI) * 0.25 * (1 - t);
      const squash = 1 / Math.sqrt(bounce); // conserve volume
      a.cube.mesh.scaling.set(squash, bounce, squash);
    } else {
      // Scale-in (default)
      const s = t * t * (3 - 2 * t); // smoothstep
      a.cube.mesh.scaling.set(s, s, s);
    }
    if (t >= 1) {
      a.cube.mesh.scaling.set(1, 1, 1);
      animations.splice(i, 1);
    }
  }

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
