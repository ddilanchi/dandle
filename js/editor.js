// ── Dandle 3D Level Editor ──

const canvas = document.getElementById('editor-canvas');
const engine = new BABYLON.Engine(canvas, true);
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.529, 0.808, 0.922, 1);

// Camera
const camera = new BABYLON.ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3, 30, BABYLON.Vector3.Zero(), scene);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 5;
camera.upperRadiusLimit = 100;
camera.upperBetaLimit = Math.PI / 2 - 0.05;
camera.panningSensibility = 50;
camera.inputs.attached.pointers.buttons = [0]; // left-click orbit
// Right-click pan
camera.inputs.attached.pointers._getButtonIndex = () => 2;

// Lights
const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity = 0.8;
const dir = new BABYLON.DirectionalLight('dir', new BABYLON.Vector3(-1, -2, 1), scene);
dir.intensity = 0.5;

// Ground plane for raycasting (invisible, large)
const groundPlane = BABYLON.MeshBuilder.CreateGround('groundPlane', { width: 200, height: 200 }, scene);
groundPlane.position.y = 0;
groundPlane.visibility = 0;
groundPlane.isPickable = true;

// ── State ──
let tool = 'select';
let floorTiles = new Map(); // "x,z,y" -> mesh
let endZone = null;
let walls = [];
let letterZones = [];
let zipLines = [];
let selected = null;
let levelName = 'My Level';
let levelHint = 'Reach the red zone!';
let startY = 0;
let floorY = 0;

// Meshes tracking
let endZoneMeshes = [];
let wallMeshes = [];
let letterZoneMeshes = [];
let zipLineMeshes = [];
let selectedHighlight = null;
let cursorMesh = null;

// ── Materials ──
const greenFloorMat = new BABYLON.StandardMaterial('greenFloor', scene);
greenFloorMat.diffuseColor = new BABYLON.Color3(0.45, 0.7, 0.45);
const beigeFloorMat = new BABYLON.StandardMaterial('beigeFloor', scene);
beigeFloorMat.diffuseColor = new BABYLON.Color3(0.7, 0.7, 0.55);
const endZoneMat = new BABYLON.StandardMaterial('ezMat', scene);
endZoneMat.diffuseColor = new BABYLON.Color3(1, 0.15, 0.15);
endZoneMat.emissiveColor = new BABYLON.Color3(1, 0.3, 0.2);
endZoneMat.alpha = 0.7;
const wallMat = new BABYLON.StandardMaterial('wallMat', scene);
wallMat.diffuseColor = new BABYLON.Color3(0.35, 0.35, 0.4);
const lzMinusMat = new BABYLON.StandardMaterial('lzMinus', scene);
lzMinusMat.diffuseColor = new BABYLON.Color3(0.9, 0.3, 0.3);
lzMinusMat.alpha = 0.7;
const lzPlusMat = new BABYLON.StandardMaterial('lzPlus', scene);
lzPlusMat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.9);
lzPlusMat.alpha = 0.7;
const zipMat = new BABYLON.StandardMaterial('zipMat', scene);
zipMat.diffuseColor = new BABYLON.Color3(0.53, 0.53, 0.6);
const cursorMat = new BABYLON.StandardMaterial('cursorMat', scene);
cursorMat.diffuseColor = new BABYLON.Color3(1, 1, 0);
cursorMat.alpha = 0.4;
const selectMat = new BABYLON.StandardMaterial('selectMat', scene);
selectMat.diffuseColor = new BABYLON.Color3(1, 0.84, 0);
selectMat.alpha = 0.4;
selectMat.wireframe = true;

// ── Builtin templates ──
const BUILTIN_LEVELS = [
  { name: 'Level 1', hint: 'Build words to push your structure into the red zone!',
    floor: { type: 'default' }, endZone: { x: 10, z: 0, width: 4, depth: 4 } },
  { name: 'Level 2', hint: 'A wall blocks the way!',
    floor: { type: 'default' }, endZone: { x: 12, z: 0, width: 4, depth: 4 },
    walls: [{ x: 6, z: 0, width: 1, height: 3, depth: 10 }] },
  { name: 'Level 3', hint: 'The goal is in the air!',
    floor: { type: 'default' }, endZone: { x: 10, z: 0, width: 4, depth: 4, elevation: 4 } },
  { name: 'Level 4', hint: 'Two islands!',
    floor: { type: 'regions', regions: [
      { xMin: -8, xMax: 5, zMin: -5, zMax: 5, y: 0 },
      { xMin: 9, xMax: 18, zMin: -5, zMax: 5, y: 0 },
    ]}, endZone: { x: 14, z: 0, width: 4, depth: 4 } },
  { name: 'Level 5', hint: 'Letter zones!',
    floor: { type: 'regions', regions: [{ xMin: -8, xMax: 22, zMin: -2, zMax: 2, y: 0 }] },
    endZone: { x: 18, z: 0, width: 4, depth: 4, elevation: 8 },
    letterZones: [
      { x: 5, z: 0, size: 3, type: '-', letter: 'random' },
      { x: 8, z: 0, size: 3, type: '+', letter: 'random' },
      { x: 11, z: 0, size: 3, type: '-', letter: 'random' },
      { x: 14, z: 0, size: 3, type: '+', letter: 'random' },
      { x: 17, z: 0, size: 3, type: '-', letter: 'random' },
    ] },
  { name: 'Level 6', hint: 'Zip line!',
    floor: { type: 'regions', regions: [
      { xMin: -6, xMax: 4, zMin: -4, zMax: 4, y: 10 },
      { xMin: 20, xMax: 30, zMin: -4, zMax: 4, y: 0 },
    ]}, startY: 10, endZone: { x: 25, z: 0, width: 4, depth: 4 },
    zipLines: [{ x1: 3, y1: 12, z1: 0, x2: 21, y2: 2, z2: 0, radius: 0.3 }] },
];

// ── Floor tile management ──
function tileKey(x, z, y) { return `${x},${z},${y || 0}`; }
function parseTileKey(k) { const [x, z, y] = k.split(',').map(Number); return { x, z, y }; }

function addFloorTile(x, z, y) {
  const key = tileKey(x, z, y);
  if (floorTiles.has(key)) return;
  const mesh = BABYLON.MeshBuilder.CreateBox('floor_' + key, { width: 1, height: 0.1, depth: 1 }, scene);
  mesh.position.set(x + 0.5, y - 0.05, z + 0.5);
  mesh.material = (x + z) % 2 === 0 ? greenFloorMat : beigeFloorMat;
  mesh.isPickable = false;
  mesh.metadata = { type: 'floor', key };
  floorTiles.set(key, mesh);
}

function removeFloorTile(x, z, y) {
  const key = tileKey(x, z, y);
  const mesh = floorTiles.get(key);
  if (mesh) { mesh.dispose(); floorTiles.delete(key); }
}

function clearAllFloor() {
  for (const [, mesh] of floorTiles) mesh.dispose();
  floorTiles.clear();
}

function addDefaultFloor() {
  for (let x = -20; x < 20; x++)
    for (let z = -20; z < 20; z++)
      addFloorTile(x, z, 0);
}

// ── Object rebuilding ──
function rebuildEndZone() {
  for (const m of endZoneMeshes) m.dispose();
  endZoneMeshes = [];
  if (!endZone) return;

  const ez = endZone;
  const ground = BABYLON.MeshBuilder.CreateGround('ez_ground', { width: ez.width, height: ez.depth }, scene);
  ground.position.set(ez.x, (ez.elevation || 0) + 0.02, ez.z);
  ground.material = endZoneMat;
  ground.isPickable = true;
  ground.metadata = { type: 'endzone' };
  endZoneMeshes.push(ground);

  if (ez.elevation > 0) {
    const pillar = BABYLON.MeshBuilder.CreateBox('ez_pillar', { width: ez.width, height: ez.elevation, depth: ez.depth }, scene);
    const pMat = new BABYLON.StandardMaterial('ez_pMat', scene);
    pMat.diffuseColor = new BABYLON.Color3(1, 0.2, 0.2);
    pMat.emissiveColor = new BABYLON.Color3(1, 0.2, 0.15);
    pMat.alpha = 0.3;
    pillar.material = pMat;
    pillar.position.set(ez.x, ez.elevation / 2, ez.z);
    pillar.isPickable = false;
    endZoneMeshes.push(pillar);
  }
}

function rebuildWalls() {
  for (const m of wallMeshes) m.dispose();
  wallMeshes = [];
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const mesh = BABYLON.MeshBuilder.CreateBox('wall_' + i, { width: w.width, height: w.height, depth: w.depth }, scene);
    mesh.position.set(w.x, w.height / 2, w.z);
    mesh.material = wallMat;
    mesh.isPickable = true;
    mesh.metadata = { type: 'wall', index: i };
    wallMeshes.push(mesh);
  }
}

function rebuildLetterZones() {
  for (const m of letterZoneMeshes) m.dispose();
  letterZoneMeshes = [];
  for (let i = 0; i < letterZones.length; i++) {
    const lz = letterZones[i];
    const mesh = BABYLON.MeshBuilder.CreateGround('lz_' + i, { width: lz.size, height: lz.size }, scene);
    mesh.position.set(lz.x, 0.03, lz.z);
    mesh.material = lz.type === '-' ? lzMinusMat : lzPlusMat;
    mesh.isPickable = true;
    mesh.metadata = { type: 'letterzone', index: i };
    letterZoneMeshes.push(mesh);
  }
}

function rebuildZipLines() {
  for (const m of zipLineMeshes) m.dispose();
  zipLineMeshes = [];
  for (let i = 0; i < zipLines.length; i++) {
    const zl = zipLines[i];
    const start = new BABYLON.Vector3(zl.x1, zl.y1, zl.z1);
    const end = new BABYLON.Vector3(zl.x2, zl.y2, zl.z2);
    const length = BABYLON.Vector3.Distance(start, end);
    const mid = BABYLON.Vector3.Center(start, end);
    const dir = end.subtract(start).normalize();

    const cyl = BABYLON.MeshBuilder.CreateCylinder('zl_' + i, {
      diameter: (zl.radius || 0.3) * 2, height: length, tessellation: 12
    }, scene);
    cyl.material = zipMat;
    cyl.position.copyFrom(mid);
    // Rotate cylinder to align with direction
    const up = new BABYLON.Vector3(0, 1, 0);
    const axis = BABYLON.Vector3.Cross(up, dir);
    const angle = Math.acos(BABYLON.Vector3.Dot(up, dir));
    if (axis.length() > 0.001) {
      cyl.rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis.normalize(), angle);
    }
    cyl.isPickable = true;
    cyl.metadata = { type: 'zipline', index: i };
    zipLineMeshes.push(cyl);
  }
}

function rebuildAll() {
  rebuildEndZone();
  rebuildWalls();
  rebuildLetterZones();
  rebuildZipLines();
  updateHighlight();
}

// ── Selection highlight ──
function updateHighlight() {
  if (selectedHighlight) { selectedHighlight.dispose(); selectedHighlight = null; }
  if (!selected) return;

  if (selected.type === 'endzone' && endZone) {
    selectedHighlight = BABYLON.MeshBuilder.CreateBox('sel', {
      width: endZone.width + 0.1, height: 0.5, depth: endZone.depth + 0.1
    }, scene);
    selectedHighlight.position.set(endZone.x, (endZone.elevation || 0) + 0.25, endZone.z);
  } else if (selected.type === 'wall' && walls[selected.index]) {
    const w = walls[selected.index];
    selectedHighlight = BABYLON.MeshBuilder.CreateBox('sel', {
      width: w.width + 0.1, height: w.height + 0.1, depth: w.depth + 0.1
    }, scene);
    selectedHighlight.position.set(w.x, w.height / 2, w.z);
  } else if (selected.type === 'letterzone' && letterZones[selected.index]) {
    const lz = letterZones[selected.index];
    selectedHighlight = BABYLON.MeshBuilder.CreateBox('sel', {
      width: lz.size + 0.1, height: 0.3, depth: lz.size + 0.1
    }, scene);
    selectedHighlight.position.set(lz.x, 0.15, lz.z);
  } else if (selected.type === 'zipline' && zipLineMeshes[selected.index]) {
    // Just highlight the cylinder
    return;
  }

  if (selectedHighlight) {
    selectedHighlight.material = selectMat;
    selectedHighlight.isPickable = false;
  }
}

// ── Cursor (hover preview) ──
cursorMesh = BABYLON.MeshBuilder.CreateBox('cursor', { width: 1, height: 0.15, depth: 1 }, scene);
cursorMesh.material = cursorMat;
cursorMesh.isPickable = false;
cursorMesh.setEnabled(false);

function getGroundHit() {
  const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m === groundPlane);
  if (pick.hit) {
    return { x: Math.floor(pick.pickedPoint.x), z: Math.floor(pick.pickedPoint.z), y: floorY };
  }
  return null;
}

// ── Pointer handling ──
let isDrag = false;
let mouseDownPos = { x: 0, y: 0 };
let ziplineFirstClick = null;

scene.onPointerObservable.add((info) => {
  const evt = info.event;

  if (info.type === BABYLON.PointerEventTypes.POINTERDOWN) {
    mouseDownPos = { x: evt.clientX, y: evt.clientY };
    isDrag = false;
  }

  if (info.type === BABYLON.PointerEventTypes.POINTERMOVE) {
    const dx = evt.clientX - mouseDownPos.x;
    const dy = evt.clientY - mouseDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) isDrag = true;

    // Update cursor
    const hit = getGroundHit();
    if (hit && (tool === 'floor' || tool === 'erase')) {
      cursorMesh.setEnabled(true);
      cursorMesh.position.set(hit.x + 0.5, hit.y, hit.z + 0.5);
    } else {
      cursorMesh.setEnabled(false);
    }
  }

  if (info.type === BABYLON.PointerEventTypes.POINTERUP) {
    if (isDrag) return;
    if (evt.button !== 0) return;

    if (tool === 'floor') {
      const hit = getGroundHit();
      if (hit) { addFloorTile(hit.x, hit.z, floorY); autoSave(); }
    } else if (tool === 'erase') {
      const hit = getGroundHit();
      if (hit) {
        // Remove tile at any y
        for (let y = -20; y <= 20; y++) removeFloorTile(hit.x, hit.z, y);
        autoSave();
      }
    } else if (tool === 'endzone') {
      const hit = getGroundHit();
      if (hit) {
        endZone = { x: hit.x + 2, z: hit.z + 2, width: 4, depth: 4, elevation: 0 };
        selected = { type: 'endzone' };
        rebuildEndZone();
        updateHighlight();
        updatePanel();
        autoSave();
      }
    } else if (tool === 'wall') {
      const hit = getGroundHit();
      if (hit) {
        walls.push({ x: hit.x + 0.5, z: hit.z + 0.5, width: 1, height: 3, depth: 1 });
        selected = { type: 'wall', index: walls.length - 1 };
        rebuildWalls();
        updateHighlight();
        updatePanel();
        autoSave();
      }
    } else if (tool === 'letterzone') {
      const hit = getGroundHit();
      if (hit) {
        letterZones.push({ x: hit.x + 1.5, z: hit.z + 1.5, size: 3, type: '-', letter: 'A' });
        selected = { type: 'letterzone', index: letterZones.length - 1 };
        rebuildLetterZones();
        updateHighlight();
        updatePanel();
        autoSave();
      }
    } else if (tool === 'zipline') {
      const hit = getGroundHit();
      if (hit) {
        if (!ziplineFirstClick) {
          ziplineFirstClick = { x: hit.x, z: hit.z };
        } else {
          zipLines.push({
            x1: ziplineFirstClick.x, y1: 10, z1: ziplineFirstClick.z,
            x2: hit.x, y2: 0, z2: hit.z, radius: 0.3
          });
          selected = { type: 'zipline', index: zipLines.length - 1 };
          ziplineFirstClick = null;
          rebuildZipLines();
          updateHighlight();
          updatePanel();
          autoSave();
        }
      }
    } else if (tool === 'select') {
      // Pick objects
      const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => m !== groundPlane && m !== cursorMesh && m !== selectedHighlight && m.isPickable);
      if (pick.hit && pick.pickedMesh.metadata) {
        const md = pick.pickedMesh.metadata;
        selected = { type: md.type, index: md.index };
        updateHighlight();
        updatePanel();
      } else {
        selected = null;
        updateHighlight();
        updatePanel();
      }
    }
  }
});

// ── Keyboard ──
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === 'v') setTool('select');
  if (e.key === 'f') setTool('floor');
  if (e.key === 'x') setTool('erase');
  if (e.key === 'e') setTool('endzone');
  if (e.key === 'w') setTool('wall');
  if (e.key === 'l') setTool('letterzone');
  if (e.key === 'z') setTool('zipline');
  if (e.key === 'Delete' && selected) {
    if (selected.type === 'wall') walls.splice(selected.index, 1);
    else if (selected.type === 'letterzone') letterZones.splice(selected.index, 1);
    else if (selected.type === 'zipline') zipLines.splice(selected.index, 1);
    else if (selected.type === 'endzone') endZone = null;
    selected = null;
    rebuildAll();
    updatePanel();
    autoSave();
  }
});

// ── Tool switching ──
function setTool(t) {
  tool = t;
  ziplineFirstClick = null;
  cursorMesh.setEnabled(false);
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
}

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

// ── Properties panel ──
function updatePanel() {
  const title = document.getElementById('panel-obj-title');
  const fields = document.getElementById('panel-obj-fields');
  fields.innerHTML = '';

  if (!selected) { title.textContent = 'No Selection'; return; }

  if (selected.type === 'endzone' && endZone) {
    title.textContent = 'End Zone';
    addField(fields, 'X', 'number', endZone.x, v => { endZone.x = v; rebuildEndZone(); updateHighlight(); autoSave(); });
    addField(fields, 'Z', 'number', endZone.z, v => { endZone.z = v; rebuildEndZone(); updateHighlight(); autoSave(); });
    addField(fields, 'Width', 'number', endZone.width, v => { endZone.width = v; rebuildEndZone(); updateHighlight(); autoSave(); });
    addField(fields, 'Depth', 'number', endZone.depth, v => { endZone.depth = v; rebuildEndZone(); updateHighlight(); autoSave(); });
    addField(fields, 'Elevation', 'number', endZone.elevation || 0, v => { endZone.elevation = v; rebuildEndZone(); updateHighlight(); autoSave(); });
    addDeleteBtn(fields, () => { endZone = null; selected = null; rebuildEndZone(); updateHighlight(); updatePanel(); autoSave(); });
  } else if (selected.type === 'wall' && walls[selected.index]) {
    const w = walls[selected.index];
    title.textContent = 'Wall';
    addField(fields, 'X', 'number', w.x, v => { w.x = v; rebuildWalls(); updateHighlight(); autoSave(); });
    addField(fields, 'Z', 'number', w.z, v => { w.z = v; rebuildWalls(); updateHighlight(); autoSave(); });
    addField(fields, 'Width', 'number', w.width, v => { w.width = v; rebuildWalls(); updateHighlight(); autoSave(); });
    addField(fields, 'Height', 'number', w.height, v => { w.height = v; rebuildWalls(); updateHighlight(); autoSave(); });
    addField(fields, 'Depth', 'number', w.depth, v => { w.depth = v; rebuildWalls(); updateHighlight(); autoSave(); });
    addDeleteBtn(fields, () => { walls.splice(selected.index, 1); selected = null; rebuildWalls(); updateHighlight(); updatePanel(); autoSave(); });
  } else if (selected.type === 'letterzone' && letterZones[selected.index]) {
    const lz = letterZones[selected.index];
    title.textContent = 'Letter Zone';
    addField(fields, 'X', 'number', lz.x, v => { lz.x = v; rebuildLetterZones(); updateHighlight(); autoSave(); });
    addField(fields, 'Z', 'number', lz.z, v => { lz.z = v; rebuildLetterZones(); updateHighlight(); autoSave(); });
    addField(fields, 'Size', 'number', lz.size, v => { lz.size = v; rebuildLetterZones(); updateHighlight(); autoSave(); });
    addSelect(fields, 'Type', ['+', '-'], lz.type, v => { lz.type = v; rebuildLetterZones(); autoSave(); });
    addField(fields, 'Letter', 'text', lz.letter, v => { lz.letter = v.toUpperCase(); autoSave(); });
    addDeleteBtn(fields, () => { letterZones.splice(selected.index, 1); selected = null; rebuildLetterZones(); updateHighlight(); updatePanel(); autoSave(); });
  } else if (selected.type === 'zipline' && zipLines[selected.index]) {
    const zl = zipLines[selected.index];
    title.textContent = 'Zip Line';
    addField(fields, 'X1', 'number', zl.x1, v => { zl.x1 = v; rebuildZipLines(); autoSave(); });
    addField(fields, 'Y1', 'number', zl.y1, v => { zl.y1 = v; rebuildZipLines(); autoSave(); });
    addField(fields, 'Z1', 'number', zl.z1, v => { zl.z1 = v; rebuildZipLines(); autoSave(); });
    addField(fields, 'X2', 'number', zl.x2, v => { zl.x2 = v; rebuildZipLines(); autoSave(); });
    addField(fields, 'Y2', 'number', zl.y2, v => { zl.y2 = v; rebuildZipLines(); autoSave(); });
    addField(fields, 'Z2', 'number', zl.z2, v => { zl.z2 = v; rebuildZipLines(); autoSave(); });
    addDeleteBtn(fields, () => { zipLines.splice(selected.index, 1); selected = null; rebuildZipLines(); updateHighlight(); updatePanel(); autoSave(); });
  } else {
    title.textContent = 'No Selection';
    selected = null;
  }
}

function addField(container, label, type, value, onChange) {
  const lbl = document.createElement('label');
  lbl.textContent = label + ' ';
  const inp = document.createElement('input');
  inp.type = type;
  inp.value = value;
  if (type === 'number') inp.step = '1';
  inp.addEventListener('change', () => onChange(type === 'number' ? Number(inp.value) : inp.value));
  lbl.appendChild(inp);
  container.appendChild(lbl);
}

function addSelect(container, label, options, value, onChange) {
  const lbl = document.createElement('label');
  lbl.textContent = label + ' ';
  const sel = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt; o.textContent = opt;
    if (opt === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  lbl.appendChild(sel);
  container.appendChild(lbl);
}

function addDeleteBtn(container, onClick) {
  const btn = document.createElement('button');
  btn.textContent = 'Delete';
  btn.addEventListener('click', onClick);
  container.appendChild(btn);
}

// ── Serialization ──
function exportLevel() {
  const config = { name: levelName, hint: levelHint };

  // Check if default floor
  let isDefault = true;
  if (floorTiles.size !== 40 * 40) isDefault = false;
  if (isDefault) {
    for (let x = -20; x < 20 && isDefault; x++)
      for (let z = -20; z < 20 && isDefault; z++)
        if (!floorTiles.has(tileKey(x, z, 0))) isDefault = false;
  }
  if (isDefault) {
    config.floor = { type: 'default' };
  } else {
    const tiles = [];
    for (const k of floorTiles.keys()) tiles.push(parseTileKey(k));
    config.floor = { type: 'custom', tiles };
  }

  if (startY) config.startY = startY;
  if (endZone) config.endZone = { ...endZone };
  if (walls.length) config.walls = walls.map(w => ({ ...w }));
  if (letterZones.length) config.letterZones = letterZones.map(lz => ({ ...lz }));
  if (zipLines.length) config.zipLines = zipLines.map(zl => ({ ...zl }));
  return config;
}

function importLevel(config) {
  clearAllFloor();
  walls = [];
  letterZones = [];
  zipLines = [];
  endZone = null;
  selected = null;

  levelName = config.name || 'My Level';
  levelHint = config.hint || 'Reach the red zone!';
  startY = config.startY || 0;

  document.getElementById('prop-name').value = levelName;
  document.getElementById('prop-hint').value = levelHint;
  document.getElementById('prop-starty').value = startY;

  if (!config.floor || config.floor.type === 'default') {
    addDefaultFloor();
  } else if (config.floor.type === 'regions') {
    for (const r of config.floor.regions) {
      for (let x = r.xMin; x < r.xMax; x++)
        for (let z = r.zMin; z < r.zMax; z++)
          addFloorTile(x, z, r.y || 0);
    }
  } else if (config.floor.tiles) {
    for (const t of config.floor.tiles)
      addFloorTile(t.x, t.z, t.y || 0);
  }

  if (config.endZone) endZone = { ...config.endZone };
  if (config.walls) walls = config.walls.map(w => ({ ...w }));
  if (config.letterZones) letterZones = config.letterZones.map(lz => ({ ...lz }));
  if (config.zipLines) zipLines = config.zipLines.map(zl => ({ ...zl }));

  rebuildAll();
  updatePanel();
  autoSave();
}

function autoSave() {
  try { localStorage.setItem('dandle_editor_wip', JSON.stringify(exportLevel())); } catch (e) {}
}

// ── Level property inputs ──
document.getElementById('prop-name').addEventListener('input', (e) => { levelName = e.target.value; autoSave(); });
document.getElementById('prop-hint').addEventListener('input', (e) => { levelHint = e.target.value; autoSave(); });
document.getElementById('prop-starty').addEventListener('change', (e) => { startY = Number(e.target.value); autoSave(); });
document.getElementById('prop-floory').addEventListener('change', (e) => {
  floorY = Number(e.target.value);
  groundPlane.position.y = floorY;
});

// ── Buttons ──
document.getElementById('btn-playtest').addEventListener('click', () => {
  localStorage.setItem('dandle_custom_level', JSON.stringify(exportLevel()));
  window.open('index.html?custom=1', '_blank');
});

document.getElementById('btn-export').addEventListener('click', () => {
  document.getElementById('modal-title').textContent = 'Export JSON — copy and share';
  document.getElementById('modal-text').value = JSON.stringify(exportLevel(), null, 2);
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal-ok').onclick = () => document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal-cancel').onclick = () => document.getElementById('modal').classList.add('hidden');
});

document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('modal-title').textContent = 'Import JSON — paste level data';
  document.getElementById('modal-text').value = '';
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal-ok').onclick = () => {
    try {
      importLevel(JSON.parse(document.getElementById('modal-text').value));
      document.getElementById('modal').classList.add('hidden');
    } catch (e) { alert('Invalid JSON: ' + e.message); }
  };
  document.getElementById('modal-cancel').onclick = () => document.getElementById('modal').classList.add('hidden');
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (!confirm('Clear everything?')) return;
  clearAllFloor();
  endZone = null; walls = []; letterZones = []; zipLines = [];
  selected = null;
  rebuildAll();
  updatePanel();
  autoSave();
});

// ── Templates ──
const templateBtns = document.getElementById('template-btns');
for (let i = 0; i < BUILTIN_LEVELS.length; i++) {
  const btn = document.createElement('button');
  btn.textContent = BUILTIN_LEVELS[i].name;
  btn.addEventListener('click', () => importLevel(BUILTIN_LEVELS[i]));
  templateBtns.appendChild(btn);
}

// ── Init ──
try {
  const wip = localStorage.getItem('dandle_editor_wip');
  if (wip) importLevel(JSON.parse(wip));
  else addDefaultFloor();
} catch (e) { addDefaultFloor(); }

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
