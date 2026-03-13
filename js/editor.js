// ── Dandle Level Editor ──

const canvas = document.getElementById('editor-canvas');
const ctx = canvas.getContext('2d');

// ── State ──
let tool = 'select';
let viewX = 0, viewZ = 0, zoom = 20; // pixels per unit
let floorTiles = new Set(); // "x,z,y" keys
let endZone = null;   // { x, z, width, depth, elevation }
let walls = [];       // [{ x, z, width, height, depth }]
let letterZones = []; // [{ x, z, size, type, letter }]
let zipLines = [];    // [{ x1, y1, z1, x2, y2, z2, radius }]
let selected = null;  // { type: 'wall'|'endzone'|'letterzone'|'zipline', index }
let levelName = 'My Level';
let levelHint = 'Reach the red zone!';
let startY = 0;
let floorY = 0; // default floor y for painting

// Drag state
let dragging = false;
let dragStart = null; // { wx, wz } world coords
let dragCurrent = null;
let panning = false;
let panStart = null;
let ziplineFirstClick = null;

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

// ── Coordinate transforms ──
function worldToScreen(wx, wz) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return { sx: cx + (wx - viewX) * zoom, sy: cy + (wz - viewZ) * zoom };
}

function screenToWorld(sx, sy) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return { wx: (sx - cx) / zoom + viewX, wz: (sy - cy) / zoom + viewZ };
}

function snapToGrid(v) { return Math.floor(v); }

// ── Floor helpers ──
function tileKey(x, z, y) { return `${x},${z},${y || 0}`; }
function parseTileKey(k) { const [x, z, y] = k.split(',').map(Number); return { x, z, y }; }

function addDefaultFloor() {
  floorTiles.clear();
  for (let x = -20; x < 20; x++)
    for (let z = -20; z < 20; z++)
      floorTiles.add(tileKey(x, z, 0));
}

// ── Rendering ──
function resize() {
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

function render() {
  const w = canvas.width / devicePixelRatio;
  const h = canvas.height / devicePixelRatio;
  ctx.clearRect(0, 0, w, h);

  // Grid lines
  const gridStep = zoom >= 10 ? 1 : zoom >= 5 ? 5 : 10;
  const minW = screenToWorld(0, 0);
  const maxW = screenToWorld(w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 0.5;
  for (let x = snapToGrid(minW.wx); x <= maxW.wx; x += gridStep) {
    const { sx } = worldToScreen(x, 0);
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
  }
  for (let z = snapToGrid(minW.wz); z <= maxW.wz; z += gridStep) {
    const { sy } = worldToScreen(0, z);
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
  }

  // Origin cross
  const o = worldToScreen(0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(o.sx, 0); ctx.lineTo(o.sx, h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, o.sy); ctx.lineTo(w, o.sy); ctx.stroke();

  // Floor tiles
  for (const k of floorTiles) {
    const t = parseTileKey(k);
    const { sx, sy } = worldToScreen(t.x, t.z);
    const isGreen = (t.x + t.z) % 2 === 0;
    const elev = t.y || 0;
    ctx.fillStyle = elev > 0
      ? (isGreen ? 'rgba(100,180,100,0.5)' : 'rgba(180,180,140,0.5)')
      : (isGreen ? 'rgba(60,120,60,0.6)' : 'rgba(140,140,100,0.6)');
    ctx.fillRect(sx, sy, zoom, zoom);
  }

  // Letter zones
  for (let i = 0; i < letterZones.length; i++) {
    const lz = letterZones[i];
    const half = lz.size / 2;
    const { sx, sy } = worldToScreen(lz.x - half, lz.z - half);
    const size = lz.size * zoom;
    ctx.fillStyle = lz.type === '-' ? 'rgba(255,80,80,0.4)' : 'rgba(80,80,255,0.4)';
    ctx.fillRect(sx, sy, size, size);
    ctx.strokeStyle = lz.type === '-' ? '#f66' : '#66f';
    ctx.lineWidth = selected?.type === 'letterzone' && selected.index === i ? 2 : 1;
    ctx.strokeRect(sx, sy, size, size);
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.min(14, zoom)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`${lz.type}${lz.letter}`, sx + size / 2, sy + size / 2 + 5);
  }

  // Walls
  for (let i = 0; i < walls.length; i++) {
    const wall = walls[i];
    const { sx, sy } = worldToScreen(wall.x - wall.width / 2, wall.z - wall.depth / 2);
    const pw = wall.width * zoom;
    const pd = wall.depth * zoom;
    ctx.fillStyle = 'rgba(80,80,80,0.7)';
    ctx.fillRect(sx, sy, pw, pd);
    ctx.strokeStyle = selected?.type === 'wall' && selected.index === i ? '#ffd700' : '#aaa';
    ctx.lineWidth = selected?.type === 'wall' && selected.index === i ? 2 : 1;
    ctx.strokeRect(sx, sy, pw, pd);
    ctx.fillStyle = '#ccc';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('WALL', sx + pw / 2, sy + pd / 2 + 4);
  }

  // End zone
  if (endZone) {
    const { sx, sy } = worldToScreen(endZone.x - endZone.width / 2, endZone.z - endZone.depth / 2);
    const pw = endZone.width * zoom;
    const pd = endZone.depth * zoom;
    ctx.fillStyle = 'rgba(255,40,40,0.4)';
    ctx.fillRect(sx, sy, pw, pd);
    ctx.strokeStyle = selected?.type === 'endzone' ? '#ffd700' : '#f44';
    ctx.lineWidth = selected?.type === 'endzone' ? 2 : 1;
    ctx.strokeRect(sx, sy, pw, pd);
    ctx.fillStyle = '#faa';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('END ZONE', sx + pw / 2, sy + pd / 2 + 4);
    if (endZone.elevation) {
      ctx.fillText(`y=${endZone.elevation}`, sx + pw / 2, sy + pd / 2 + 16);
    }
  }

  // Zip lines
  for (let i = 0; i < zipLines.length; i++) {
    const zl = zipLines[i];
    const s = worldToScreen(zl.x1, zl.z1);
    const e = worldToScreen(zl.x2, zl.z2);
    ctx.strokeStyle = selected?.type === 'zipline' && selected.index === i ? '#ffd700' : '#888';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(s.sx, s.sy); ctx.lineTo(e.sx, e.sy); ctx.stroke();
    ctx.fillStyle = '#aaa';
    ctx.beginPath(); ctx.arc(s.sx, s.sy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(e.sx, e.sy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`y=${zl.y1}`, s.sx, s.sy - 8);
    ctx.fillText(`y=${zl.y2}`, e.sx, e.sy - 8);
  }

  // Drag preview
  if (dragging && dragStart && dragCurrent && (tool === 'floor' || tool === 'erase' || tool === 'endzone' || tool === 'wall')) {
    const x1 = Math.min(dragStart.wx, dragCurrent.wx);
    const z1 = Math.min(dragStart.wz, dragCurrent.wz);
    const x2 = Math.max(dragStart.wx, dragCurrent.wx);
    const z2 = Math.max(dragStart.wz, dragCurrent.wz);
    const s = worldToScreen(x1, z1);
    const pw = (x2 - x1 + 1) * zoom;
    const pd = (z2 - z1 + 1) * zoom;
    ctx.strokeStyle = tool === 'erase' ? 'rgba(255,80,80,0.6)' : 'rgba(255,215,0,0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(s.sx, s.sy, pw, pd);
    ctx.setLineDash([]);
  }

  // Zip line placement preview
  if (tool === 'zipline' && ziplineFirstClick) {
    const s = worldToScreen(ziplineFirstClick.wx, ziplineFirstClick.wz);
    ctx.fillStyle = '#ff0';
    ctx.beginPath(); ctx.arc(s.sx, s.sy, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '10px monospace';
    ctx.fillText('Start', s.sx, s.sy - 10);
  }

  // Starting word indicator
  const sw = worldToScreen(-3, -0.5);
  ctx.fillStyle = 'rgba(255,215,0,0.3)';
  ctx.fillRect(sw.sx, sw.sy, 6 * zoom, 1 * zoom);
  ctx.fillStyle = '#ffd700';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('START', sw.sx + 3 * zoom, sw.sy + zoom / 2 + 3);

  requestAnimationFrame(render);
}

// ── Serialization ──
function exportLevel() {
  const config = { name: levelName, hint: levelHint };

  // Floor — check if it's the default 40x40
  const defaultCount = 40 * 40;
  if (floorTiles.size === defaultCount) {
    let isDefault = true;
    for (let x = -20; x < 20 && isDefault; x++)
      for (let z = -20; z < 20 && isDefault; z++)
        if (!floorTiles.has(tileKey(x, z, 0))) isDefault = false;
    if (isDefault) {
      config.floor = { type: 'default' };
    }
  }
  if (!config.floor) {
    // Group tiles by y to create regions or custom tiles
    const tiles = [...floorTiles].map(parseTileKey);
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
  floorTiles.clear();
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

  // Floor
  if (!config.floor || config.floor.type === 'default') {
    addDefaultFloor();
  } else if (config.floor.type === 'regions') {
    for (const r of config.floor.regions) {
      const y = r.y || 0;
      for (let x = r.xMin; x < r.xMax; x++)
        for (let z = r.zMin; z < r.zMax; z++)
          floorTiles.add(tileKey(x, z, y));
    }
  } else if (config.floor.tiles) {
    for (const t of config.floor.tiles)
      floorTiles.add(tileKey(t.x, t.z, t.y || 0));
  }

  if (config.endZone) endZone = { ...config.endZone };
  if (config.walls) walls = config.walls.map(w => ({ ...w }));
  if (config.letterZones) letterZones = config.letterZones.map(lz => ({ ...lz }));
  if (config.zipLines) zipLines = config.zipLines.map(zl => ({ ...zl }));

  autoSave();
}

function autoSave() {
  try {
    localStorage.setItem('dandle_editor_wip', JSON.stringify(exportLevel()));
  } catch (e) { /* ignore */ }
}

// ── Properties panel ──
function updatePanel() {
  const title = document.getElementById('panel-obj-title');
  const fields = document.getElementById('panel-obj-fields');
  fields.innerHTML = '';

  if (!selected) {
    title.textContent = 'No Selection';
    return;
  }

  let obj;
  if (selected.type === 'endzone') {
    obj = endZone;
    title.textContent = 'End Zone';
    addField(fields, 'X', 'number', obj.x, v => { obj.x = v; autoSave(); });
    addField(fields, 'Z', 'number', obj.z, v => { obj.z = v; autoSave(); });
    addField(fields, 'Width', 'number', obj.width, v => { obj.width = v; autoSave(); });
    addField(fields, 'Depth', 'number', obj.depth, v => { obj.depth = v; autoSave(); });
    addField(fields, 'Elevation', 'number', obj.elevation || 0, v => { obj.elevation = v; autoSave(); });
  } else if (selected.type === 'wall') {
    obj = walls[selected.index];
    title.textContent = `Wall ${selected.index + 1}`;
    addField(fields, 'X', 'number', obj.x, v => { obj.x = v; autoSave(); });
    addField(fields, 'Z', 'number', obj.z, v => { obj.z = v; autoSave(); });
    addField(fields, 'Width', 'number', obj.width, v => { obj.width = v; autoSave(); });
    addField(fields, 'Height', 'number', obj.height, v => { obj.height = v; autoSave(); });
    addField(fields, 'Depth', 'number', obj.depth, v => { obj.depth = v; autoSave(); });
    addDeleteBtn(fields, () => { walls.splice(selected.index, 1); selected = null; updatePanel(); autoSave(); });
  } else if (selected.type === 'letterzone') {
    obj = letterZones[selected.index];
    title.textContent = `Letter Zone ${selected.index + 1}`;
    addField(fields, 'X', 'number', obj.x, v => { obj.x = v; autoSave(); });
    addField(fields, 'Z', 'number', obj.z, v => { obj.z = v; autoSave(); });
    addField(fields, 'Size', 'number', obj.size, v => { obj.size = v; autoSave(); });
    addSelect(fields, 'Type', ['+', '-'], obj.type, v => { obj.type = v; autoSave(); });
    addField(fields, 'Letter', 'text', obj.letter, v => { obj.letter = v.toUpperCase(); autoSave(); });
    addDeleteBtn(fields, () => { letterZones.splice(selected.index, 1); selected = null; updatePanel(); autoSave(); });
  } else if (selected.type === 'zipline') {
    obj = zipLines[selected.index];
    title.textContent = `Zip Line ${selected.index + 1}`;
    addField(fields, 'X1', 'number', obj.x1, v => { obj.x1 = v; autoSave(); });
    addField(fields, 'Y1', 'number', obj.y1, v => { obj.y1 = v; autoSave(); });
    addField(fields, 'Z1', 'number', obj.z1, v => { obj.z1 = v; autoSave(); });
    addField(fields, 'X2', 'number', obj.x2, v => { obj.x2 = v; autoSave(); });
    addField(fields, 'Y2', 'number', obj.y2, v => { obj.y2 = v; autoSave(); });
    addField(fields, 'Z2', 'number', obj.z2, v => { obj.z2 = v; autoSave(); });
    addDeleteBtn(fields, () => { zipLines.splice(selected.index, 1); selected = null; updatePanel(); autoSave(); });
  }
}

function addField(container, label, type, value, onChange) {
  const lbl = document.createElement('label');
  lbl.textContent = label + ' ';
  const inp = document.createElement('input');
  inp.type = type;
  inp.value = value;
  if (type === 'number') inp.step = '1';
  inp.addEventListener('change', () => {
    onChange(type === 'number' ? Number(inp.value) : inp.value);
  });
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

// ── Hit testing ──
function hitTest(wx, wz) {
  // End zone
  if (endZone) {
    const hw = endZone.width / 2, hd = endZone.depth / 2;
    if (Math.abs(wx - endZone.x) < hw && Math.abs(wz - endZone.z) < hd) {
      return { type: 'endzone' };
    }
  }
  // Walls
  for (let i = walls.length - 1; i >= 0; i--) {
    const wall = walls[i];
    const hw = wall.width / 2, hd = wall.depth / 2;
    if (Math.abs(wx - wall.x) < hw && Math.abs(wz - wall.z) < hd) {
      return { type: 'wall', index: i };
    }
  }
  // Letter zones
  for (let i = letterZones.length - 1; i >= 0; i--) {
    const lz = letterZones[i];
    const half = lz.size / 2;
    if (Math.abs(wx - lz.x) < half && Math.abs(wz - lz.z) < half) {
      return { type: 'letterzone', index: i };
    }
  }
  // Zip lines (endpoints)
  for (let i = zipLines.length - 1; i >= 0; i--) {
    const zl = zipLines[i];
    if (Math.hypot(wx - zl.x1, wz - zl.z1) < 1) return { type: 'zipline', index: i };
    if (Math.hypot(wx - zl.x2, wz - zl.z2) < 1) return { type: 'zipline', index: i };
  }
  return null;
}

// ── Input handling ──
canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const { wx, wz } = screenToWorld(sx, sy);
  const gx = snapToGrid(wx), gz = snapToGrid(wz);

  // Middle click = pan
  if (e.button === 1) {
    panning = true;
    panStart = { x: e.clientX, y: e.clientY, vx: viewX, vz: viewZ };
    e.preventDefault();
    return;
  }

  if (e.button !== 0) return;

  if (tool === 'select') {
    selected = hitTest(wx, wz);
    updatePanel();
  } else if (tool === 'floor' || tool === 'erase') {
    dragging = true;
    dragStart = { wx: gx, wz: gz };
    dragCurrent = { wx: gx, wz: gz };
  } else if (tool === 'endzone') {
    dragging = true;
    dragStart = { wx: gx, wz: gz };
    dragCurrent = { wx: gx, wz: gz };
  } else if (tool === 'wall') {
    dragging = true;
    dragStart = { wx: gx, wz: gz };
    dragCurrent = { wx: gx, wz: gz };
  } else if (tool === 'letterzone') {
    letterZones.push({ x: gx + 0.5, z: gz + 0.5, size: 3, type: '-', letter: 'A' });
    selected = { type: 'letterzone', index: letterZones.length - 1 };
    updatePanel();
    autoSave();
  } else if (tool === 'zipline') {
    if (!ziplineFirstClick) {
      ziplineFirstClick = { wx: gx, wz: gz };
    } else {
      zipLines.push({
        x1: ziplineFirstClick.wx, y1: 10, z1: ziplineFirstClick.wz,
        x2: gx, y2: 0, z2: gz, radius: 0.3
      });
      selected = { type: 'zipline', index: zipLines.length - 1 };
      ziplineFirstClick = null;
      updatePanel();
      autoSave();
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  if (panning && panStart) {
    const dx = (e.clientX - panStart.x) / zoom;
    const dy = (e.clientY - panStart.y) / zoom;
    viewX = panStart.vx - dx;
    viewZ = panStart.vz - dy;
    return;
  }

  if (dragging && dragStart) {
    const { wx, wz } = screenToWorld(sx, sy);
    dragCurrent = { wx: snapToGrid(wx), wz: snapToGrid(wz) };
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (panning) { panning = false; panStart = null; return; }
  if (!dragging) return;
  dragging = false;

  if (!dragStart || !dragCurrent) return;
  const x1 = Math.min(dragStart.wx, dragCurrent.wx);
  const z1 = Math.min(dragStart.wz, dragCurrent.wz);
  const x2 = Math.max(dragStart.wx, dragCurrent.wx);
  const z2 = Math.max(dragStart.wz, dragCurrent.wz);

  if (tool === 'floor') {
    for (let x = x1; x <= x2; x++)
      for (let z = z1; z <= z2; z++)
        floorTiles.add(tileKey(x, z, floorY));
    autoSave();
  } else if (tool === 'erase') {
    for (let x = x1; x <= x2; x++)
      for (let z = z1; z <= z2; z++) {
        // Remove tiles at any Y
        for (let y = -20; y <= 20; y++) floorTiles.delete(tileKey(x, z, y));
      }
    autoSave();
  } else if (tool === 'endzone') {
    const w = x2 - x1 + 1;
    const d = z2 - z1 + 1;
    endZone = { x: (x1 + x2 + 1) / 2, z: (z1 + z2 + 1) / 2, width: w, depth: d, elevation: 0 };
    selected = { type: 'endzone' };
    updatePanel();
    autoSave();
  } else if (tool === 'wall') {
    const w = x2 - x1 + 1;
    const d = z2 - z1 + 1;
    walls.push({ x: (x1 + x2 + 1) / 2, z: (z1 + z2 + 1) / 2, width: w, height: 3, depth: d });
    selected = { type: 'wall', index: walls.length - 1 };
    updatePanel();
    autoSave();
  }

  dragStart = null;
  dragCurrent = null;
});

// Zoom
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.15 : 0.87;
  zoom = Math.max(3, Math.min(80, zoom * factor));
}, { passive: false });

// Pan with WASD
window.addEventListener('keydown', (e) => {
  const panSpeed = 2;
  if (e.key === 'w' || e.key === 'W') viewZ -= panSpeed;
  if (e.key === 's' || e.key === 'S') viewZ += panSpeed;
  if (e.key === 'a' || e.key === 'A') viewX -= panSpeed;
  if (e.key === 'd' || e.key === 'D') viewX += panSpeed;

  // Tool hotkeys
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === 'v') setTool('select');
  if (e.key === 'f') setTool('floor');
  if (e.key === 'x') setTool('erase');
  if (e.key === 'e') setTool('endzone');
  if (e.key === 'Delete' && selected) {
    if (selected.type === 'wall') walls.splice(selected.index, 1);
    else if (selected.type === 'letterzone') letterZones.splice(selected.index, 1);
    else if (selected.type === 'zipline') zipLines.splice(selected.index, 1);
    else if (selected.type === 'endzone') endZone = null;
    selected = null;
    updatePanel();
    autoSave();
  }
  if (e.key === 'l') setTool('letterzone');
  if (e.key === 'z') setTool('zipline');
});

// ── Tool switching ──
function setTool(t) {
  tool = t;
  ziplineFirstClick = null;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
}

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

// ── Level property inputs ──
document.getElementById('prop-name').addEventListener('input', (e) => { levelName = e.target.value; autoSave(); });
document.getElementById('prop-hint').addEventListener('input', (e) => { levelHint = e.target.value; autoSave(); });
document.getElementById('prop-starty').addEventListener('change', (e) => { startY = Number(e.target.value); autoSave(); });

// ── Buttons ──
document.getElementById('btn-playtest').addEventListener('click', () => {
  const config = exportLevel();
  localStorage.setItem('dandle_custom_level', JSON.stringify(config));
  window.open('index.html?custom=1', '_blank');
});

document.getElementById('btn-export').addEventListener('click', () => {
  const config = exportLevel();
  document.getElementById('modal-title').textContent = 'Export JSON';
  document.getElementById('modal-text').value = JSON.stringify(config, null, 2);
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal-ok').onclick = () => document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal-cancel').onclick = () => document.getElementById('modal').classList.add('hidden');
});

document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('modal-title').textContent = 'Import JSON';
  document.getElementById('modal-text').value = '';
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal-ok').onclick = () => {
    try {
      const config = JSON.parse(document.getElementById('modal-text').value);
      importLevel(config);
      document.getElementById('modal').classList.add('hidden');
    } catch (e) {
      alert('Invalid JSON: ' + e.message);
    }
  };
  document.getElementById('modal-cancel').onclick = () => document.getElementById('modal').classList.add('hidden');
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (!confirm('Clear everything?')) return;
  floorTiles.clear();
  endZone = null;
  walls = [];
  letterZones = [];
  zipLines = [];
  selected = null;
  updatePanel();
  autoSave();
});

// ── Template buttons ──
const templateBtns = document.getElementById('template-btns');
for (let i = 0; i < BUILTIN_LEVELS.length; i++) {
  const btn = document.createElement('button');
  btn.textContent = BUILTIN_LEVELS[i].name;
  btn.addEventListener('click', () => importLevel(BUILTIN_LEVELS[i]));
  templateBtns.appendChild(btn);
}

// ── Init ──
resize();
window.addEventListener('resize', resize);

// Load WIP or default
try {
  const wip = localStorage.getItem('dandle_editor_wip');
  if (wip) {
    importLevel(JSON.parse(wip));
  } else {
    addDefaultFloor();
  }
} catch (e) {
  addDefaultFloor();
}

requestAnimationFrame(render);
