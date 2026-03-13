// ── Dandle 3D Level Editor (Block-Based) ──

const canvas = document.getElementById('editor-canvas');
const engine = new BABYLON.Engine(canvas, true);
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.18, 1);

// ── Camera ──
// Right-drag: orbit | Middle-drag: pan | Scroll: zoom | Left-click: tool
const camera = new BABYLON.ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3, 30,
  new BABYLON.Vector3(0, 0, 0), scene);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 5;
camera.upperRadiusLimit = 120;
camera.upperBetaLimit = Math.PI / 2 - 0.02;
camera.wheelDeltaPercentage = 0.02;
camera.panningSensibility = 30;
camera.minZ = 0.1;
// buttons[0]=orbit, buttons[1]=zoom(unused), buttons[2]=pan
camera.inputs.attached.pointers.buttons = [2, -1, 1];

// ── Lights ──
const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity = 0.7;
const dirLight = new BABYLON.DirectionalLight('dir', new BABYLON.Vector3(-1, -2, 1), scene);
dirLight.intensity = 0.5;

// Invisible ground for raycasting
const groundPlane = BABYLON.MeshBuilder.CreateGround('ground', { width: 200, height: 200 }, scene);
groundPlane.position.y = -0.01;
groundPlane.visibility = 0;
groundPlane.isPickable = true;

// ── State ──
let tool = 'select';
let floorY = 0;
let levelName = 'My Level';
let levelHint = 'Reach the red zone!';
let startY = 0;

// Block maps: key = "x,y,z" -> { mesh, x, y, z, ... }
const blocks = {
  floor: new Map(),
  endzone: new Map(),
  wall: new Map(),
  letterzone: new Map(),
  sticky: new Map(),
  ice: new Map(),
  ramp: new Map(),
  impulse: new Map(),
  moving: new Map(),
  destructible: new Map(),
  spawner: new Map(),
};
let zipLines = [];
let zipLineMeshes = [];
let ziplineFirstClick = null;

let selected = null;
let selectedHighlight = null;
let cursorMesh = null;

// Paint settings
let paintLzType = '-';
let paintLzLetter = 'random';
let paintRampSlope = '1:1';
let paintDirection = '+x';
let paintSpawnerType = 'ball';

// ── Materials ──
function makeMat(name, r, g, b, alpha) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = new BABYLON.Color3(r, g, b);
  if (alpha !== undefined && alpha < 1) m.alpha = alpha;
  return m;
}

const mats = {
  floorGreen: makeMat('flG', 0.45, 0.7, 0.45),
  floorBeige: makeMat('flB', 0.7, 0.7, 0.55),
  endzone: (() => { const m = makeMat('ez', 1, 0.2, 0.2, 0.85); m.emissiveColor = new BABYLON.Color3(0.4, 0.05, 0.05); return m; })(),
  wall: makeMat('wall', 0.4, 0.4, 0.5),
  lzMinus: makeMat('lzM', 0.9, 0.3, 0.3, 0.8),
  lzPlus: makeMat('lzP', 0.3, 0.3, 0.9, 0.8),
  sticky: (() => { const m = makeMat('sticky', 0.9, 0.7, 0.1); m.emissiveColor = new BABYLON.Color3(0.2, 0.15, 0); return m; })(),
  ice: (() => { const m = makeMat('ice', 0.7, 0.9, 1.0, 0.8); m.emissiveColor = new BABYLON.Color3(0.1, 0.15, 0.2); m.specularColor = new BABYLON.Color3(1, 1, 1); return m; })(),
  ramp: makeMat('ramp', 0.55, 0.55, 0.45),
  impulse: (() => { const m = makeMat('imp', 1, 0.5, 0, 0.9); m.emissiveColor = new BABYLON.Color3(0.3, 0.1, 0); return m; })(),
  moving: (() => { const m = makeMat('mov', 0.3, 0.8, 0.3); m.emissiveColor = new BABYLON.Color3(0.05, 0.2, 0.05); return m; })(),
  destructible: makeMat('destr', 0.7, 0.5, 0.3),
  spawner: (() => { const m = makeMat('spawn', 0.8, 0.2, 0.8); m.emissiveColor = new BABYLON.Color3(0.2, 0, 0.2); return m; })(),
  cursor: makeMat('cur', 1, 1, 0, 0.35),
  select: (() => { const m = makeMat('sel', 1, 0.84, 0, 0.5); m.wireframe = true; return m; })(),
  zip: makeMat('zip', 0.5, 0.5, 0.6),
};

// ── Block helpers ──
function bkey(x, y, z) { return `${x},${y},${z}`; }
function parseKey(k) { const [x, y, z] = k.split(',').map(Number); return { x, y, z }; }

// Direction to rotation (for ramps and impulse arrows)
function dirToRotY(dir) {
  if (dir === '+x') return 0;
  if (dir === '-x') return Math.PI;
  if (dir === '+z') return -Math.PI / 2;
  if (dir === '-z') return Math.PI / 2;
  return 0;
}

function addBlock(layer, x, y, z, mat, extra) {
  const key = bkey(x, y, z);
  if (blocks[layer].has(key)) return blocks[layer].get(key);

  let mesh;
  const isFloor = layer === 'floor';

  if (layer === 'ramp') {
    const slope = (extra && extra.slope) || '1:1';
    const dir = (extra && extra.direction) || '+x';
    // Create a wedge shape using CreateBox + vertex manipulation...
    // Simpler: use a box rotated to look like a ramp
    const riseRun = slope === '2:1' ? 0.5 : 1;
    const h = riseRun; // height of the ramp
    mesh = BABYLON.MeshBuilder.CreateBox(layer + '_' + key, { width: 0.96, height: 0.96 * h, depth: 0.96 }, scene);
    mesh.position.set(x + 0.5, y + 0.5 * h, z + 0.5);
    // Tilt the box to indicate ramp direction
    const tiltAngle = Math.atan(riseRun);
    mesh.rotation.y = dirToRotY(dir);
    // Visual indicator: skew via non-uniform scaling to suggest slope
    mesh.material = mat;
  } else {
    const h = isFloor ? 0.2 : 1;
    mesh = BABYLON.MeshBuilder.CreateBox(layer + '_' + key,
      { width: 0.96, height: h * 0.96, depth: 0.96 }, scene);
    mesh.position.set(x + 0.5, isFloor ? y - 0.1 : y + 0.5, z + 0.5);
    mesh.material = mat;
  }

  // Add direction arrow for impulse blocks
  if (layer === 'impulse') {
    const dir = (extra && extra.direction) || '+x';
    mesh.rotation.y = dirToRotY(dir);
  }

  // Add direction indicator for moving blocks
  if (layer === 'moving') {
    const dir = (extra && extra.direction) || '+x';
    mesh.rotation.y = dirToRotY(dir);
  }

  mesh.isPickable = true;
  mesh.metadata = { type: layer, key };

  const entry = { mesh, x, y, z, ...extra };
  blocks[layer].set(key, entry);
  return entry;
}

function removeBlock(layer, key) {
  const entry = blocks[layer].get(key);
  if (entry) { entry.mesh.dispose(); blocks[layer].delete(key); }
}

function clearLayer(layer) {
  for (const [, e] of blocks[layer]) e.mesh.dispose();
  blocks[layer].clear();
}

function clearAll() {
  for (const layer of Object.keys(blocks)) clearLayer(layer);
  for (const m of zipLineMeshes) m.dispose();
  zipLines = []; zipLineMeshes = [];
}

// ── Floor ──
function getFloorMat(x, z) { return (x + z) % 2 === 0 ? mats.floorGreen : mats.floorBeige; }
function addFloor(x, z, y) { return addBlock('floor', x, y, z, getFloorMat(x, z)); }

function addDefaultFloor() {
  for (let x = -20; x < 20; x++)
    for (let z = -20; z < 20; z++)
      addFloor(x, z, 0);
}

// ── Zip lines (rendered as cube chains) ──
function rebuildZipLines() {
  for (const m of zipLineMeshes) m.dispose();
  zipLineMeshes = [];
  for (let i = 0; i < zipLines.length; i++) {
    const zl = zipLines[i];
    const start = new BABYLON.Vector3(zl.x1, zl.y1, zl.z1);
    const end = new BABYLON.Vector3(zl.x2, zl.y2, zl.z2);
    const dist = BABYLON.Vector3.Distance(start, end);
    const steps = Math.max(2, Math.ceil(dist / 1.2));
    for (let s = 0; s <= steps; s++) {
      const pos = BABYLON.Vector3.Lerp(start, end, s / steps);
      const cube = BABYLON.MeshBuilder.CreateBox(`zl_${i}_${s}`, { size: 0.5 }, scene);
      cube.position.copyFrom(pos);
      cube.material = mats.zip;
      cube.isPickable = true;
      cube.metadata = { type: 'zipline', index: i };
      zipLineMeshes.push(cube);
    }
  }
}

// ── Cursor ──
cursorMesh = BABYLON.MeshBuilder.CreateBox('cursor', { size: 1 }, scene);
cursorMesh.material = mats.cursor;
cursorMesh.isPickable = false;
cursorMesh.setEnabled(false);

// ── Selection highlight ──
function updateHighlight() {
  if (selectedHighlight) { selectedHighlight.dispose(); selectedHighlight = null; }
  if (!selected) return;
  if (selected.type === 'zipline') return;
  const entry = blocks[selected.type]?.get(selected.key);
  if (!entry) { selected = null; return; }
  const isFloor = selected.type === 'floor';
  const h = isFloor ? 0.25 : 1.05;
  selectedHighlight = BABYLON.MeshBuilder.CreateBox('selH', { width: 1.04, height: h, depth: 1.04 }, scene);
  selectedHighlight.position.copyFrom(entry.mesh.position);
  selectedHighlight.material = mats.select;
  selectedHighlight.isPickable = false;
}

// ── Raycasting ──
function getGroundHit() {
  const pick = scene.pick(scene.pointerX, scene.pointerY, m => m === groundPlane);
  if (pick.hit) {
    return { x: Math.floor(pick.pickedPoint.x), y: floorY, z: Math.floor(pick.pickedPoint.z) };
  }
  return null;
}

function getBlockHit() {
  const pick = scene.pick(scene.pointerX, scene.pointerY, m =>
    m !== groundPlane && m !== cursorMesh && m !== selectedHighlight && m.isPickable);
  if (pick.hit && pick.pickedMesh.metadata) {
    return { mesh: pick.pickedMesh, md: pick.pickedMesh.metadata,
             point: pick.pickedPoint, normal: pick.getNormal(true) };
  }
  return null;
}

// ── Tool → material/layer mapping ──
function getToolLayer(t) {
  const map = {
    floor: 'floor', wall: 'wall', endzone: 'endzone', letterzone: 'letterzone',
    sticky: 'sticky', ice: 'ice', ramp: 'ramp', impulse: 'impulse', moving: 'moving',
    destructible: 'destructible', spawner: 'spawner'
  };
  return map[t] || null;
}

function getToolMat(t) {
  const map = {
    floor: null, wall: mats.wall, endzone: mats.endzone,
    sticky: mats.sticky, ice: mats.ice, ramp: mats.ramp,
    impulse: mats.impulse, moving: mats.moving,
    destructible: mats.destructible, spawner: mats.spawner
  };
  return map[t] || null;
}

function getToolExtra(t) {
  if (t === 'letterzone') return { lzType: paintLzType, letter: paintLzLetter };
  if (t === 'ramp') return { slope: paintRampSlope, direction: paintDirection };
  if (t === 'impulse') return { direction: paintDirection, strength: 10 };
  if (t === 'moving') return { direction: paintDirection, distance: 5, speed: 2 };
  if (t === 'spawner') return { objectType: paintSpawnerType, interval: 5, velocity: { x: 0, y: 3, z: 0 } };
  return {};
}

// ── Pointer handling ──
let isDrag = false;
let isPointerDown = false;
let mouseDownPos = { x: 0, y: 0 };
let lastPaintKey = null;

scene.onPointerObservable.add((info) => {
  const evt = info.event;

  if (info.type === BABYLON.PointerEventTypes.POINTERDOWN) {
    if (evt.button === 0) {
      mouseDownPos = { x: evt.clientX, y: evt.clientY };
      isDrag = false; isPointerDown = true; lastPaintKey = null;
    }
  }

  if (info.type === BABYLON.PointerEventTypes.POINTERMOVE) {
    if (isPointerDown) {
      const dx = evt.clientX - mouseDownPos.x, dy = evt.clientY - mouseDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) isDrag = true;
    }

    // Cursor preview
    const paintTools = ['floor', 'erase', 'wall', 'endzone', 'letterzone',
                        'sticky', 'ice', 'ramp', 'impulse', 'moving'];
    if (paintTools.includes(tool)) {
      const hit = getGroundHit();
      if (hit) {
        cursorMesh.setEnabled(true);
        const h = tool === 'floor' ? 0.2 : 1;
        cursorMesh.scaling.set(1, h, 1);
        cursorMesh.position.set(hit.x + 0.5, hit.y + (tool === 'floor' ? -0.1 : 0.5), hit.z + 0.5);
      } else cursorMesh.setEnabled(false);
    } else cursorMesh.setEnabled(false);

    // Drag-paint
    if (isPointerDown && isDrag && evt.button === 0 && paintTools.includes(tool)) {
      dragPaint();
    }
  }

  if (info.type === BABYLON.PointerEventTypes.POINTERUP) {
    if (evt.button === 0) {
      if (!isDrag) handleToolClick();
      isPointerDown = false; lastPaintKey = null;
    }
  }
});

function dragPaint() {
  if (tool === 'erase') {
    const bh = getBlockHit();
    if (bh) {
      const md = bh.md;
      const pk = md.key || `zl_${md.index}`;
      if (pk === lastPaintKey) return;
      lastPaintKey = pk;
      if (md.type === 'zipline') { zipLines.splice(md.index, 1); rebuildZipLines(); }
      else if (blocks[md.type]) removeBlock(md.type, md.key);
      autoSave();
    }
    return;
  }

  const hit = getGroundHit();
  if (!hit) return;
  const pk = bkey(hit.x, hit.y, hit.z);
  if (pk === lastPaintKey) return;
  lastPaintKey = pk;

  if (tool === 'floor') addFloor(hit.x, hit.z, floorY);
  else if (tool === 'letterzone') {
    addBlock('letterzone', hit.x, hit.y, hit.z,
      paintLzType === '-' ? mats.lzMinus : mats.lzPlus, getToolExtra('letterzone'));
  } else {
    const layer = getToolLayer(tool);
    if (layer) addBlock(layer, hit.x, hit.y, hit.z, getToolMat(tool), getToolExtra(tool));
  }
  autoSave();
}

function handleToolClick() {
  const groundHit = getGroundHit();
  const blockHit = getBlockHit();

  switch (tool) {
    case 'floor':
      if (groundHit) { addFloor(groundHit.x, groundHit.z, floorY); autoSave(); }
      break;

    case 'wall': case 'sticky': case 'ice': case 'destructible': {
      const layer = getToolLayer(tool);
      // Click existing block of same type to stack on top
      if (blockHit && blockHit.md.type === layer) {
        const e = blocks[layer].get(blockHit.md.key);
        if (e) { addBlock(layer, e.x, e.y + 1, e.z, getToolMat(tool)); autoSave(); }
      } else if (groundHit) {
        addBlock(layer, groundHit.x, groundHit.y, groundHit.z, getToolMat(tool));
        autoSave();
      }
      break;
    }

    case 'endzone': case 'letterzone': case 'ramp': case 'impulse': case 'moving':
      if (groundHit) {
        const layer = getToolLayer(tool);
        const mat = tool === 'letterzone'
          ? (paintLzType === '-' ? mats.lzMinus : mats.lzPlus)
          : getToolMat(tool);
        addBlock(layer, groundHit.x, groundHit.y, groundHit.z, mat, getToolExtra(tool));
        autoSave();
      }
      break;

    case 'erase':
      if (blockHit) {
        const md = blockHit.md;
        if (md.type === 'zipline') { zipLines.splice(md.index, 1); rebuildZipLines(); }
        else if (blocks[md.type]) removeBlock(md.type, md.key);
        if (selected && selected.key === md.key) selected = null;
        updateHighlight(); autoSave();
      }
      break;

    case 'zipline':
      if (groundHit) {
        if (!ziplineFirstClick) {
          ziplineFirstClick = { x: groundHit.x + 0.5, z: groundHit.z + 0.5 };
        } else {
          zipLines.push({
            x1: ziplineFirstClick.x, y1: 10, z1: ziplineFirstClick.z,
            x2: groundHit.x + 0.5, y2: 0, z2: groundHit.z + 0.5, radius: 0.3
          });
          ziplineFirstClick = null;
          rebuildZipLines(); autoSave();
        }
      }
      break;

    case 'select':
      if (blockHit) {
        selected = { type: blockHit.md.type, key: blockHit.md.key, index: blockHit.md.index };
        updateHighlight(); updatePanel();
      } else {
        selected = null; updateHighlight(); updatePanel();
      }
      break;
  }
}

// ── Keyboard ──
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  const toolMap = { v:'select', f:'floor', x:'erase', e:'endzone', w:'wall',
    l:'letterzone', z:'zipline', s:'sticky', i:'ice', r:'ramp', g:'impulse', m:'moving',
    d:'destructible', p:'spawner' };
  if (toolMap[k]) setTool(toolMap[k]);
  else if (e.key === 'Delete' && selected) {
    if (selected.type === 'zipline' && selected.index != null) {
      zipLines.splice(selected.index, 1); rebuildZipLines();
    } else if (blocks[selected.type]) removeBlock(selected.type, selected.key);
    selected = null; updateHighlight(); updatePanel(); autoSave();
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

  if (selected.type === 'zipline' && zipLines[selected.index]) {
    const zl = zipLines[selected.index];
    title.textContent = 'Zip Line';
    addField(fields, 'X1', 'number', zl.x1, v => { zl.x1 = v; rebuildZipLines(); autoSave(); });
    addField(fields, 'Y1', 'number', zl.y1, v => { zl.y1 = v; rebuildZipLines(); autoSave(); });
    addField(fields, 'Z1', 'number', zl.z1, v => { zl.z1 = v; rebuildZipLines(); autoSave(); });
    addField(fields, 'X2', 'number', zl.x2, v => { zl.x2 = v; rebuildZipLines(); autoSave(); });
    addField(fields, 'Y2', 'number', zl.y2, v => { zl.y2 = v; rebuildZipLines(); autoSave(); });
    addField(fields, 'Z2', 'number', zl.z2, v => { zl.z2 = v; rebuildZipLines(); autoSave(); });
    addDeleteBtn(fields, () => {
      zipLines.splice(selected.index, 1); selected = null;
      rebuildZipLines(); updateHighlight(); updatePanel(); autoSave();
    });
    return;
  }

  const entry = blocks[selected.type]?.get(selected.key);
  if (!entry) { title.textContent = 'No Selection'; selected = null; return; }

  const labels = {
    floor: 'Floor Block', wall: 'Wall Block', endzone: 'End Zone Block',
    letterzone: 'Letter Zone Block', sticky: 'Sticky Block', ice: 'Ice Block',
    ramp: 'Ramp Block', impulse: 'Impulse Block', moving: 'Moving Block',
    destructible: 'Breakable Block', spawner: 'Spawner'
  };
  title.textContent = labels[selected.type] || 'Block';

  const posDiv = document.createElement('div');
  posDiv.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:8px;';
  posDiv.textContent = `Position: (${entry.x}, ${entry.y}, ${entry.z})`;
  fields.appendChild(posDiv);

  if (selected.type === 'letterzone') {
    addSelect(fields, 'Type', ['-', '+'], entry.lzType || '-', v => {
      entry.lzType = v;
      entry.mesh.material = v === '-' ? mats.lzMinus : mats.lzPlus;
      autoSave();
    });
    addField(fields, 'Letter', 'text', entry.letter || 'random', v => {
      entry.letter = v.toUpperCase() || 'random'; autoSave();
    });
  }

  if (selected.type === 'ramp') {
    addSelect(fields, 'Slope', ['1:1', '2:1'], entry.slope || '1:1', v => {
      entry.slope = v; autoSave();
    });
    addSelect(fields, 'Direction', ['+x', '-x', '+z', '-z'], entry.direction || '+x', v => {
      entry.direction = v; entry.mesh.rotation.y = dirToRotY(v); autoSave();
    });
  }

  if (selected.type === 'impulse') {
    addSelect(fields, 'Direction', ['+x', '-x', '+z', '-z', '+y', '-y'], entry.direction || '+x', v => {
      entry.direction = v; entry.mesh.rotation.y = dirToRotY(v); autoSave();
    });
    addField(fields, 'Strength', 'number', entry.strength || 10, v => {
      entry.strength = v; autoSave();
    });
  }

  if (selected.type === 'moving') {
    addSelect(fields, 'Direction', ['+x', '-x', '+z', '-z', '+y', '-y'], entry.direction || '+x', v => {
      entry.direction = v; entry.mesh.rotation.y = dirToRotY(v); autoSave();
    });
    addField(fields, 'Distance', 'number', entry.distance || 5, v => {
      entry.distance = v; autoSave();
    });
    addField(fields, 'Speed', 'number', entry.speed || 2, v => {
      entry.speed = v; autoSave();
    });
  }

  if (selected.type === 'spawner') {
    addSelect(fields, 'Object', ['ball', 'boulder'], entry.objectType || 'ball', v => {
      entry.objectType = v; autoSave();
    });
    addField(fields, 'Interval (s)', 'number', entry.interval || 5, v => {
      entry.interval = v; autoSave();
    });
  }

  addDeleteBtn(fields, () => {
    removeBlock(selected.type, selected.key);
    selected = null; updateHighlight(); updatePanel(); autoSave();
  });
}

function addField(container, label, type, value, onChange) {
  const lbl = document.createElement('label');
  lbl.textContent = label + ' ';
  const inp = document.createElement('input');
  inp.type = type; inp.value = value;
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

  // Floor
  if (blocks.floor.size === 0) {
    config.floor = { type: 'default' };
  } else {
    let isDefault = blocks.floor.size === 40 * 40;
    if (isDefault) {
      for (let x = -20; x < 20 && isDefault; x++)
        for (let z = -20; z < 20 && isDefault; z++)
          if (!blocks.floor.has(bkey(x, 0, z))) isDefault = false;
    }
    config.floor = isDefault
      ? { type: 'default' }
      : { type: 'custom', tiles: [...blocks.floor.values()].map(e => ({ x: e.x, z: e.z, y: e.y })) };
  }

  if (startY) config.startY = startY;

  // End zone: bounding box from blocks
  if (blocks.endzone.size > 0) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
    for (const [, e] of blocks.endzone) {
      minX = Math.min(minX, e.x); maxX = Math.max(maxX, e.x);
      minZ = Math.min(minZ, e.z); maxZ = Math.max(maxZ, e.z);
      minY = Math.min(minY, e.y);
    }
    const w = maxX - minX + 1, d = maxZ - minZ + 1;
    config.endZone = { x: minX + w / 2, z: minZ + d / 2, width: w, depth: d };
    if (minY > 0) config.endZone.elevation = minY;
  }

  // Walls: group columns
  if (blocks.wall.size > 0) {
    const cols = new Map();
    for (const [, e] of blocks.wall) {
      const ck = `${e.x},${e.z}`;
      if (!cols.has(ck)) cols.set(ck, { x: e.x, z: e.z, minY: e.y, maxY: e.y });
      else { const c = cols.get(ck); c.minY = Math.min(c.minY, e.y); c.maxY = Math.max(c.maxY, e.y); }
    }
    config.walls = [...cols.values()].map(c => ({
      x: c.x + 0.5, z: c.z + 0.5, width: 1, height: c.maxY - c.minY + 1, depth: 1
    }));
  }

  // Letter zones: group by type+letter
  if (blocks.letterzone.size > 0) {
    const groups = new Map();
    for (const [, e] of blocks.letterzone) {
      const gk = `${e.lzType || '-'}_${e.letter || 'random'}`;
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk).push(e);
    }
    config.letterZones = [];
    for (const [, entries] of groups) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const e of entries) {
        minX = Math.min(minX, e.x); maxX = Math.max(maxX, e.x);
        minZ = Math.min(minZ, e.z); maxZ = Math.max(maxZ, e.z);
      }
      const size = Math.max(maxX - minX + 1, maxZ - minZ + 1);
      config.letterZones.push({
        x: minX + (maxX - minX + 1) / 2, z: minZ + (maxZ - minZ + 1) / 2,
        size, type: entries[0].lzType || '-', letter: entries[0].letter || 'random'
      });
    }
  }

  // Sticky blocks
  if (blocks.sticky.size > 0) {
    config.stickyBlocks = [...blocks.sticky.values()].map(e => ({ x: e.x, y: e.y, z: e.z }));
  }

  // Ice blocks
  if (blocks.ice.size > 0) {
    config.iceBlocks = [...blocks.ice.values()].map(e => ({ x: e.x, y: e.y, z: e.z }));
  }

  // Ramps
  if (blocks.ramp.size > 0) {
    config.ramps = [...blocks.ramp.values()].map(e => ({
      x: e.x, y: e.y, z: e.z, slope: e.slope || '1:1', direction: e.direction || '+x'
    }));
  }

  // Impulse blocks
  if (blocks.impulse.size > 0) {
    config.impulseBlocks = [...blocks.impulse.values()].map(e => ({
      x: e.x, y: e.y, z: e.z, direction: e.direction || '+x', strength: e.strength || 10
    }));
  }

  // Moving blocks
  if (blocks.moving.size > 0) {
    config.movingBlocks = [...blocks.moving.values()].map(e => ({
      x: e.x, y: e.y, z: e.z, direction: e.direction || '+x',
      distance: e.distance || 5, speed: e.speed || 2
    }));
  }

  // Destructible blocks
  if (blocks.destructible.size > 0) {
    config.destructibleBlocks = [...blocks.destructible.values()].map(e => ({ x: e.x, y: e.y, z: e.z }));
  }

  // Spawners
  if (blocks.spawner.size > 0) {
    config.spawners = [...blocks.spawner.values()].map(e => ({
      x: e.x, y: e.y, z: e.z, objectType: e.objectType || 'ball',
      interval: e.interval || 5, velocity: e.velocity || { x: 0, y: 3, z: 0 }
    }));
  }

  if (zipLines.length) config.zipLines = zipLines.map(zl => ({ ...zl }));
  return config;
}

function importLevel(config) {
  clearAll();
  selected = null;

  levelName = config.name || 'My Level';
  levelHint = config.hint || 'Reach the red zone!';
  startY = config.startY || 0;

  document.getElementById('prop-name').value = levelName;
  document.getElementById('prop-hint').value = levelHint;
  document.getElementById('prop-starty').value = startY;

  // Floor
  if (!config.floor || config.floor.type === 'default') addDefaultFloor();
  else if (config.floor.type === 'regions') {
    for (const r of config.floor.regions)
      for (let x = r.xMin; x < r.xMax; x++)
        for (let z = r.zMin; z < r.zMax; z++)
          addFloor(x, z, r.y || 0);
  } else if (config.floor.tiles) {
    for (const t of config.floor.tiles) addFloor(t.x, t.z, t.y || 0);
  }

  // End zone
  if (config.endZone) {
    const ez = config.endZone;
    const x0 = Math.round(ez.x - ez.width / 2), z0 = Math.round(ez.z - ez.depth / 2);
    const y = ez.elevation || 0;
    for (let dx = 0; dx < ez.width; dx++)
      for (let dz = 0; dz < ez.depth; dz++)
        addBlock('endzone', x0 + dx, y, z0 + dz, mats.endzone);
  }

  // Walls
  if (config.walls) {
    for (const w of config.walls) {
      const bx = Math.round(w.x - w.width / 2), bz = Math.round(w.z - w.depth / 2);
      for (let dx = 0; dx < w.width; dx++)
        for (let dz = 0; dz < w.depth; dz++)
          for (let dy = 0; dy < w.height; dy++)
            addBlock('wall', bx + dx, dy, bz + dz, mats.wall);
    }
  }

  // Letter zones
  if (config.letterZones) {
    for (const lz of config.letterZones) {
      const x0 = Math.round(lz.x - lz.size / 2), z0 = Math.round(lz.z - lz.size / 2);
      for (let dx = 0; dx < lz.size; dx++)
        for (let dz = 0; dz < lz.size; dz++)
          addBlock('letterzone', x0 + dx, 0, z0 + dz,
            lz.type === '-' ? mats.lzMinus : mats.lzPlus,
            { lzType: lz.type, letter: lz.letter || 'random' });
    }
  }

  // Sticky blocks
  if (config.stickyBlocks) {
    for (const b of config.stickyBlocks) addBlock('sticky', b.x, b.y, b.z, mats.sticky);
  }

  // Ice blocks
  if (config.iceBlocks) {
    for (const b of config.iceBlocks) addBlock('ice', b.x, b.y, b.z, mats.ice);
  }

  // Ramps
  if (config.ramps) {
    for (const r of config.ramps) addBlock('ramp', r.x, r.y, r.z, mats.ramp,
      { slope: r.slope, direction: r.direction });
  }

  // Impulse blocks
  if (config.impulseBlocks) {
    for (const b of config.impulseBlocks) addBlock('impulse', b.x, b.y, b.z, mats.impulse,
      { direction: b.direction, strength: b.strength });
  }

  // Moving blocks
  if (config.movingBlocks) {
    for (const b of config.movingBlocks) addBlock('moving', b.x, b.y, b.z, mats.moving,
      { direction: b.direction, distance: b.distance, speed: b.speed });
  }

  // Destructible blocks
  if (config.destructibleBlocks) {
    for (const b of config.destructibleBlocks) addBlock('destructible', b.x, b.y, b.z, mats.destructible);
  }

  // Spawners
  if (config.spawners) {
    for (const s of config.spawners) addBlock('spawner', s.x, s.y, s.z, mats.spawner,
      { objectType: s.objectType, interval: s.interval, velocity: s.velocity });
  }

  // Zip lines
  if (config.zipLines) zipLines = config.zipLines.map(zl => ({ ...zl }));
  rebuildZipLines();
  updateHighlight(); updatePanel(); autoSave();
}

function autoSave() {
  try { localStorage.setItem('dandle_editor_wip', JSON.stringify(exportLevel())); } catch (e) {}
}

// ── Level property inputs ──
document.getElementById('prop-name').addEventListener('input', e => { levelName = e.target.value; autoSave(); });
document.getElementById('prop-hint').addEventListener('input', e => { levelHint = e.target.value; autoSave(); });
document.getElementById('prop-starty').addEventListener('change', e => { startY = Number(e.target.value); autoSave(); });
document.getElementById('prop-floory').addEventListener('change', e => {
  floorY = Number(e.target.value);
  groundPlane.position.y = floorY - 0.01;
});

// Paint settings
const lzTypeEl = document.getElementById('prop-lztype');
const lzLetterEl = document.getElementById('prop-lzletter');
const rampSlopeEl = document.getElementById('prop-rampslope');
const directionEl = document.getElementById('prop-direction');
if (lzTypeEl) lzTypeEl.addEventListener('change', e => { paintLzType = e.target.value; });
if (lzLetterEl) lzLetterEl.addEventListener('input', e => { paintLzLetter = e.target.value.toUpperCase() || 'random'; });
if (rampSlopeEl) rampSlopeEl.addEventListener('change', e => { paintRampSlope = e.target.value; });
if (directionEl) directionEl.addEventListener('change', e => { paintDirection = e.target.value; });
const spawnerTypeEl = document.getElementById('prop-spawnertype');
if (spawnerTypeEl) spawnerTypeEl.addEventListener('change', e => { paintSpawnerType = e.target.value; });

// ── Buttons ──
document.getElementById('btn-playtest').addEventListener('click', () => {
  localStorage.setItem('dandle_custom_level', JSON.stringify(exportLevel()));
  window.open('index.html?custom=1', '_blank');
});

document.getElementById('btn-export').addEventListener('click', () => {
  document.getElementById('modal-title').textContent = 'Export JSON \u2014 copy and share';
  document.getElementById('modal-text').value = JSON.stringify(exportLevel(), null, 2);
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal-ok').onclick = () => document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal-cancel').onclick = () => document.getElementById('modal').classList.add('hidden');
});

document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('modal-title').textContent = 'Import JSON \u2014 paste level data';
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
  clearAll(); selected = null; updateHighlight(); updatePanel(); autoSave();
});

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
