import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getRandomWord, isVerb } from './wordlist.js';
import { AudioManager } from './audio.js';

// ── DOM ──
const canvas = document.getElementById('game-canvas');
const levelInfoEl = document.getElementById('level-info');
const hintEl = document.getElementById('hint');
const selectedInfoEl = document.getElementById('selected-info');
const inputContainer = document.getElementById('word-input-container');
const wordInput = document.getElementById('word-input');
const submitBtn = document.getElementById('submit-word');
const messageEl = document.getElementById('message');
const verbLegend = document.getElementById('verb-legend');
const levelCompleteEl = document.getElementById('level-complete');

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
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

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

// ── Game state ──
let selectedCube = null;
let selectedHighlight = null;
let levelComplete = false;
let structureGroup = new THREE.Group();
scene.add(structureGroup);

const cubes = [];       // { letter, gx, gz, mesh, wordIdx }
const words = [];       // { text, dir, isVerb, arrowHelper }
const velocity = new THREE.Vector3();
const FRICTION = 0.97;
const VERB_FORCE = 2.5;

let endZone = null;
let endZoneBox = null;

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
function placeWord(text, startGx, startGz, dir, wordIdx) {
  const verb = isVerb(text);
  const placed = [];
  const dirVec = dirToVec(dir);

  for (let i = 0; i < text.length; i++) {
    const gx = startGx + dirVec.x * i;
    const gz = startGz + dirVec.z * i;
    const existing = cubes.find(c => c.gx === gx && c.gz === gz);
    if (existing) {
      placed.push(existing);
      continue;
    }
    const mesh = makeLetterMesh(text[i], verb);
    mesh.position.set(gx, 0.5, gz);
    structureGroup.add(mesh);
    const cube = { letter: text[i], gx, gz, mesh, wordIdx };
    mesh.userData.cube = cube;
    cubes.push(cube);
    placed.push(cube);
  }

  const wordEntry = { text, dir, isVerb: verb, arrowHelper: null };

  // Verb force arrow
  if (verb) {
    const arrowDir = new THREE.Vector3(dirVec.x, 0, dirVec.z).normalize();
    const midIdx = Math.floor(text.length / 2);
    const midCube = placed[midIdx];
    const origin = new THREE.Vector3(midCube.gx, 1.2, midCube.gz);
    const arrow = new THREE.ArrowHelper(arrowDir, origin, 1.5, 0xff2222, 0.4, 0.25);
    structureGroup.add(arrow);
    wordEntry.arrowHelper = arrow;
    verbLegend.classList.remove('hidden');
  }

  words.push(wordEntry);
  return { placed, verb };
}

function dirToVec(dir) {
  switch (dir) {
    case 'x+': return { x: 1, z: 0 };
    case 'x-': return { x: -1, z: 0 };
    case 'z+': return { x: 0, z: 1 };
    case 'z-': return { x: 0, z: -1 };
  }
}

function oppositeAxis(dir) {
  if (dir.startsWith('x')) return Math.random() < 0.5 ? 'z+' : 'z-';
  return Math.random() < 0.5 ? 'x+' : 'x-';
}

// ── End zone ──
function createEndZone(x, z, w, d) {
  const geo = new THREE.PlaneGeometry(w, d);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xcc2222,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });
  endZone = new THREE.Mesh(geo, mat);
  endZone.rotation.x = -Math.PI / 2;
  endZone.position.set(x, 0.01, z);
  scene.add(endZone);

  // pulsing border
  const edges = new THREE.EdgesGeometry(geo);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xff4444 }));
  line.rotation.x = -Math.PI / 2;
  line.position.copy(endZone.position);
  line.position.y = 0.02;
  scene.add(line);
  endZone.userData.line = line;

  endZoneBox = new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(x, 0.5, z),
    new THREE.Vector3(w, 1, d)
  );
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

// ── Message flash ──
let msgTimeout = null;
function showMessage(text, color = '#ff6b6b') {
  messageEl.textContent = text;
  messageEl.style.color = color;
  messageEl.style.opacity = '1';
  clearTimeout(msgTimeout);
  msgTimeout = setTimeout(() => { messageEl.style.opacity = '0'; }, 2000);
}

// ── Init level ──
function startLevel() {
  // Clear previous
  while (structureGroup.children.length) {
    const c = structureGroup.children[0];
    structureGroup.remove(c);
  }
  cubes.length = 0;
  words.length = 0;
  velocity.set(0, 0, 0);
  structureGroup.position.set(0, 0, 0);
  selectedCube = null;
  clearHighlight();
  levelComplete = false;
  levelCompleteEl.classList.add('hidden');
  inputContainer.classList.add('hidden');
  selectedInfoEl.textContent = '';

  if (endZone) {
    scene.remove(endZone);
    if (endZone.userData.line) scene.remove(endZone.userData.line);
  }

  // Starting word
  const word = getRandomWord();
  const startX = -Math.floor(word.length / 2);
  placeWord(word, startX, 0, 'x+', 0);

  // End zone - placed 10 units away in a random direction
  const angle = Math.random() * Math.PI * 2;
  const dist = 10;
  const ezX = Math.round(Math.cos(angle) * dist);
  const ezZ = Math.round(Math.sin(angle) * dist);
  createEndZone(ezX, ezZ, 4, 4);

  // Camera target
  controls.target.set(0, 0, 0);
  camera.position.set(6, 8, 10);

  levelInfoEl.textContent = 'Level 1';
  hintEl.textContent = 'Click a letter cube, then type a word containing that letter';
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
    selectedInfoEl.textContent = '';
    inputContainer.classList.add('hidden');
  }
});

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

  const letter = selectedCube.letter;
  const idx = text.indexOf(letter);
  if (idx === -1) {
    showMessage(`Word must contain the letter [${letter}]`);
    audio.error();
    return;
  }

  // Find which word the selected cube belongs to, determine perpendicular direction
  const parentWord = words[selectedCube.wordIdx];
  const dir = parentWord ? oppositeAxis(parentWord.dir) : (Math.random() < 0.5 ? 'z+' : 'z-');
  const dv = dirToVec(dir);

  // Calculate starting position so that text[idx] aligns with selectedCube
  const startGx = selectedCube.gx - dv.x * idx;
  const startGz = selectedCube.gz - dv.z * idx;

  // Check for conflicts - letters at occupied positions must match
  for (let i = 0; i < text.length; i++) {
    const gx = startGx + dv.x * i;
    const gz = startGz + dv.z * i;
    const existing = cubes.find(c => c.gx === gx && c.gz === gz);
    if (existing && existing.letter !== text[i]) {
      showMessage(`Conflict: [${text[i]}] overlaps [${existing.letter}] at (${gx},${gz})`);
      audio.error();
      return;
    }
  }

  const wordIdx = words.length;
  const { verb } = placeWord(text, startGx, startGz, dir, wordIdx);

  audio.place();
  if (verb) {
    audio.verb();
    showMessage(`VERB: "${text}" applies force!`, '#44ff44');
  } else {
    showMessage(`Placed "${text}"`, '#aaddff');
  }

  // Deselect
  selectedCube = null;
  clearHighlight();
  selectedInfoEl.textContent = '';
  inputContainer.classList.add('hidden');
  wordInput.value = '';
}

submitBtn.addEventListener('click', submitWord);
wordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitWord();
  e.stopPropagation();
});

// ── Level complete handler ──
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && levelComplete) {
    startLevel();
  }
});

// ── Physics update ──
function updatePhysics(dt) {
  if (levelComplete) return;

  // Apply verb forces
  for (const w of words) {
    if (!w.isVerb) continue;
    const dv = dirToVec(w.dir);
    velocity.x += dv.x * VERB_FORCE * dt;
    velocity.z += dv.z * VERB_FORCE * dt;
  }

  // Friction
  velocity.x *= FRICTION;
  velocity.z *= FRICTION;

  // Move structure
  structureGroup.position.x += velocity.x * dt;
  structureGroup.position.z += velocity.z * dt;

  // Keep on floor bounds
  const bound = 18;
  if (Math.abs(structureGroup.position.x) > bound) {
    structureGroup.position.x = Math.sign(structureGroup.position.x) * bound;
    velocity.x *= -0.5;
    audio.collision();
  }
  if (Math.abs(structureGroup.position.z) > bound) {
    structureGroup.position.z = Math.sign(structureGroup.position.z) * bound;
    velocity.z *= -0.5;
    audio.collision();
  }

  // Check win - any cube in end zone?
  if (endZoneBox) {
    const sp = structureGroup.position;
    for (const c of cubes) {
      const wx = c.mesh.position.x + sp.x;
      const wz = c.mesh.position.z + sp.z;
      const p = new THREE.Vector3(wx, 0.5, wz);
      if (endZoneBox.containsPoint(p)) {
        levelComplete = true;
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
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  updatePhysics(dt);
  updateCamera();
  animateEndZone(time);
  controls.update();
  renderer.render(scene, camera);
}

// ── Resize ──
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Start ──
startLevel();
animate();
