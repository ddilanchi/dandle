// Navigation test — verifies Shift+WASD can reach every cube in a construct
// Run: node tests/nav_test.js

// Replicate the navigation function from game.js (pure logic, no Babylon dependency)
function findNavTarget(cubes, fromCube, dirX, dirY, dirZ) {
  const sp = fromCube.pos;
  let best = null;
  let bestScore = -Infinity;

  for (const c of cubes) {
    if (c === fromCube) continue;
    const cp = c.pos;
    const dx = cp.x - sp.x, dy = cp.y - sp.y, dz = cp.z - sp.z;
    const fwd = dx * dirX + dy * dirY + dz * dirZ;
    if (fwd < 0.1) continue;
    const totalDistSq = dx * dx + dy * dy + dz * dz;
    const perpDistSq = totalDistSq - fwd * fwd;
    const perpDist = Math.sqrt(Math.max(0, perpDistSq));
    const score = -Math.sqrt(totalDistSq) - 2 * perpDist;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

const DIRS = {
  W: [0, 0, -1], S: [0, 0, 1],
  A: [-1, 0, 0], D: [1, 0, 0],
  Q: [0, 1, 0],  E: [0, -1, 0],
};

// Check that from every cube, repeatedly pressing all 6 directions
// can eventually reach every other cube in the construct.
function canReachAll(cubes) {
  const errors = [];
  for (const start of cubes) {
    const reachable = new Set();
    reachable.add(start);
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 100) {
      changed = false;
      iterations++;
      for (const from of [...reachable]) {
        for (const [key, [dx, dy, dz]] of Object.entries(DIRS)) {
          const target = findNavTarget(cubes, from, dx, dy, dz);
          if (target && !reachable.has(target)) {
            reachable.add(target);
            changed = true;
          }
        }
      }
    }
    if (reachable.size !== cubes.length) {
      const missing = cubes.filter(c => !reachable.has(c)).map(c => c.letter);
      errors.push(`From [${start.letter}] at (${start.pos.x},${start.pos.y},${start.pos.z}): cannot reach [${missing.join(',')}]`);
    }
  }
  return errors;
}

// ── Test cases ──

let passed = 0;
let failed = 0;

function test(name, cubes) {
  const errors = canReachAll(cubes);
  if (errors.length === 0) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}`);
    errors.forEach(e => console.log(`    ${e}`));
    failed++;
  }
}

console.log('Navigation reachability tests:\n');

// Test 1: Simple horizontal word (VALOR) along X axis
test('Horizontal word (x+)', [
  { letter: 'V', pos: { x: 0, y: 0.5, z: 0 } },
  { letter: 'A', pos: { x: 1, y: 0.5, z: 0 } },
  { letter: 'L', pos: { x: 2, y: 0.5, z: 0 } },
  { letter: 'O', pos: { x: 3, y: 0.5, z: 0 } },
  { letter: 'R', pos: { x: 4, y: 0.5, z: 0 } },
]);

// Test 2: Vertical tower (y+)
test('Vertical tower (y+)', [
  { letter: 'R', pos: { x: 0, y: 0.5, z: 0 } },
  { letter: 'E', pos: { x: 0, y: 1.5, z: 0 } },
  { letter: 'P', pos: { x: 0, y: 2.5, z: 0 } },
  { letter: 'N', pos: { x: 0, y: 3.5, z: 0 } },
]);

// Test 3: L-shape (horizontal + vertical branch)
// VALOR along x, then NEPER going up from R
test('L-shape: horizontal + vertical', [
  { letter: 'V', pos: { x: 0, y: 0.5, z: 0 } },
  { letter: 'A', pos: { x: 1, y: 0.5, z: 0 } },
  { letter: 'L', pos: { x: 2, y: 0.5, z: 0 } },
  { letter: 'O', pos: { x: 3, y: 0.5, z: 0 } },
  { letter: 'R', pos: { x: 4, y: 0.5, z: 0 } },
  { letter: 'E', pos: { x: 4, y: 1.5, z: 0 } },
  { letter: 'P', pos: { x: 4, y: 2.5, z: 0 } },
  { letter: 'N', pos: { x: 4, y: 3.5, z: 0 } },
]);

// Test 4: T-shape (word along x, word along z from middle)
test('T-shape: x + z crossing', [
  { letter: 'A', pos: { x: 0, y: 0.5, z: 0 } },
  { letter: 'B', pos: { x: 1, y: 0.5, z: 0 } },
  { letter: 'C', pos: { x: 2, y: 0.5, z: 0 } },
  { letter: 'D', pos: { x: 3, y: 0.5, z: 0 } },
  { letter: 'E', pos: { x: 4, y: 0.5, z: 0 } },
  { letter: 'F', pos: { x: 2, y: 0.5, z: 1 } },
  { letter: 'G', pos: { x: 2, y: 0.5, z: 2 } },
  { letter: 'H', pos: { x: 2, y: 0.5, z: -1 } },
  { letter: 'I', pos: { x: 2, y: 0.5, z: -2 } },
]);

// Test 5: Rotated structure — the construct has physically rotated ~45 degrees
// Simulates what happens when physics tilts the structure
const cos45 = Math.cos(Math.PI / 4);
const sin45 = Math.sin(Math.PI / 4);
function rotateY45(x, y, z) {
  return { x: x * cos45 - z * sin45, y, z: x * sin45 + z * cos45 };
}
test('Rotated 45deg: horizontal word', [
  { letter: 'V', pos: rotateY45(0, 0.5, 0) },
  { letter: 'A', pos: rotateY45(1, 0.5, 0) },
  { letter: 'L', pos: rotateY45(2, 0.5, 0) },
  { letter: 'O', pos: rotateY45(3, 0.5, 0) },
  { letter: 'R', pos: rotateY45(4, 0.5, 0) },
]);

// Test 6: Complex 3D structure — cubes in all 3 axes
test('3D cross: all axes', [
  { letter: 'C', pos: { x: 0, y: 0.5, z: 0 } },  // center
  { letter: 'L', pos: { x: -1, y: 0.5, z: 0 } },  // left
  { letter: 'R', pos: { x: 1, y: 0.5, z: 0 } },   // right
  { letter: 'F', pos: { x: 0, y: 0.5, z: -1 } },  // front
  { letter: 'B', pos: { x: 0, y: 0.5, z: 1 } },   // back
  { letter: 'U', pos: { x: 0, y: 1.5, z: 0 } },   // up
  { letter: 'D', pos: { x: 0, y: -0.5, z: 0 } },  // down
]);

// Test 7: Two parallel rows (like screenshot — VALOR base + column above R)
test('Screenshot layout: VALOR + NEPER column', [
  { letter: 'V', pos: { x: 0, y: 0.5, z: 0 } },
  { letter: 'A', pos: { x: 1, y: 0.5, z: 0 } },
  { letter: 'L', pos: { x: 2, y: 0.5, z: 0 } },
  { letter: 'O', pos: { x: 3, y: 0.5, z: 0 } },
  { letter: 'R', pos: { x: 4, y: 0.5, z: 0 } },
  { letter: 'E', pos: { x: 4, y: 1.5, z: 0 } },
  { letter: 'P', pos: { x: 4, y: 2.5, z: 0 } },
  { letter: 'N', pos: { x: 4, y: 3.5, z: 0 } },
]);

// Test 8: Verify specific navigation — from N, pressing E (down) should reach E/P, not jump to VALOR
(function testSpecificNav() {
  const cubeList = [
    { letter: 'V', pos: { x: 0, y: 0.5, z: 0 } },
    { letter: 'A', pos: { x: 1, y: 0.5, z: 0 } },
    { letter: 'L', pos: { x: 2, y: 0.5, z: 0 } },
    { letter: 'O', pos: { x: 3, y: 0.5, z: 0 } },
    { letter: 'R', pos: { x: 4, y: 0.5, z: 0 } },
    { letter: 'E', pos: { x: 4, y: 1.5, z: 0 } },
    { letter: 'P', pos: { x: 4, y: 2.5, z: 0 } },
    { letter: 'N', pos: { x: 4, y: 3.5, z: 0 } },
  ];
  const N = cubeList[7]; // N at top
  const target = findNavTarget(cubeList, N, 0, -1, 0); // E key = down
  if (target && target.letter === 'P') {
    console.log('  PASS: From N, pressing E(down) goes to P');
    passed++;
  } else {
    console.log(`  FAIL: From N, pressing E(down) should go to P, got ${target?.letter || 'null'}`);
    failed++;
  }

  // From P, pressing E(down) should go to E
  const P = cubeList[6];
  const target2 = findNavTarget(cubeList, P, 0, -1, 0);
  if (target2 && target2.letter === 'E') {
    console.log('  PASS: From P, pressing E(down) goes to E');
    passed++;
  } else {
    console.log(`  FAIL: From P, pressing E(down) should go to E, got ${target2?.letter || 'null'}`);
    failed++;
  }

  // From R, pressing Q(up) should go to E (the letter above R)
  const R = cubeList[4];
  const target3 = findNavTarget(cubeList, R, 0, 1, 0);
  if (target3 && target3.letter === 'E') {
    console.log('  PASS: From R, pressing Q(up) goes to E');
    passed++;
  } else {
    console.log(`  FAIL: From R, pressing Q(up) should go to E, got ${target3?.letter || 'null'}`);
    failed++;
  }

  // From N, pressing A(left) should go to something (P is directly below, not left —
  // but the whole column is at x=4, VALOR is at x=0-4. A=-x, so from N at x=4,
  // pressing A should reach O at x=3)
  const target4 = findNavTarget(cubeList, N, -1, 0, 0);
  if (target4) {
    console.log(`  PASS: From N, pressing A(left) reaches [${target4.letter}] at x=${target4.pos.x}`);
    passed++;
  } else {
    console.log('  FAIL: From N, pressing A(left) should find a cube');
    failed++;
  }
})();

// Test 9: Tilted structure (physics rotated ~30 deg around Z axis — like leaning)
// The column above R is now tilted so Y-axis cubes have X offset
(function testTiltedStructure() {
  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);
  // Rotate column around Z at R's position (4, 0.5, 0)
  function tiltFromR(localY) {
    return {
      x: 4 + localY * sin30,
      y: 0.5 + localY * cos30,
      z: 0,
    };
  }
  const cubeList = [
    { letter: 'V', pos: { x: 0, y: 0.5, z: 0 } },
    { letter: 'A', pos: { x: 1, y: 0.5, z: 0 } },
    { letter: 'L', pos: { x: 2, y: 0.5, z: 0 } },
    { letter: 'O', pos: { x: 3, y: 0.5, z: 0 } },
    { letter: 'R', pos: tiltFromR(0) },
    { letter: 'E', pos: tiltFromR(1) },
    { letter: 'P', pos: tiltFromR(2) },
    { letter: 'N', pos: tiltFromR(3) },
  ];

  const errors = canReachAll(cubeList);
  if (errors.length === 0) {
    console.log('  PASS: Tilted structure (30deg lean) — all reachable');
    passed++;
  } else {
    console.log('  FAIL: Tilted structure (30deg lean)');
    errors.forEach(e => console.log(`    ${e}`));
    failed++;
  }

  // From N (tilted top), pressing E(down) should go to P
  const N = cubeList[7];
  const target = findNavTarget(cubeList, N, 0, -1, 0);
  if (target && target.letter === 'P') {
    console.log('  PASS: Tilted: From N, E(down) goes to P');
    passed++;
  } else {
    console.log(`  FAIL: Tilted: From N, E(down) should go to P, got ${target?.letter || 'null'}`);
    failed++;
  }
})();

console.log(`\nResults: ${passed} passed, ${failed} failed`);

process.exit(failed > 0 ? 1 : 0);
