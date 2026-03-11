// ── DANDLE Physics Engine v4.0 ──
// Clean Rapier3D wrapper. No Three.js dependency.
// All positions are {x,y,z}, rotations are {x,y,z,w} quaternions.

// ── Constants ──
const GRAVITY = 10;
const PHYS_STEP = 1 / 120;
const SOLVER_ITERATIONS = 8;
const CUBE_HALF = 0.5;

// Structure body
const STRUCT_FRICTION = 0.5;
const STRUCT_RESTITUTION = 0.02;
const STRUCT_DENSITY = 1.0;
const STRUCT_LINEAR_DAMPING = 0.3;
const STRUCT_ANGULAR_DAMPING = 0.3;

// Static geometry
const STATIC_FRICTION = 0.8;
const STATIC_RESTITUTION = 0.0;

// Debris
const DEBRIS_FRICTION = 0.4;
const DEBRIS_RESTITUTION = 0.05;
const DEBRIS_LINEAR_DAMPING = 0.2;
const DEBRIS_ANGULAR_DAMPING = 0.2;

// ── Collision groups ──
// Membership is upper 16 bits, filter is lower 16 bits.
const CG_GROUND    = 1;
const CG_STRUCTURE = 2;
const CG_GROWING   = 4;
const CG_DEBRIS    = 8;

function packGroups(membership, filter) {
  return (membership << 16) | filter;
}

// Ground collides with everything
const GROUPS_GROUND    = packGroups(CG_GROUND, 0xffff);
// Structure collides with ground + debris (not growing — growing is cosmetic)
const GROUPS_STRUCTURE = packGroups(CG_STRUCTURE, CG_GROUND | CG_DEBRIS);
// Growing only collides with ground (purely cosmetic slide, no structure push)
const GROUPS_GROWING   = packGroups(CG_GROWING, CG_GROUND);
// Debris collides with ground + structure + other debris
const GROUPS_DEBRIS    = packGroups(CG_DEBRIS, CG_GROUND | CG_STRUCTURE | CG_DEBRIS);

export class Physics {
  constructor(RAPIER) {
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = PHYS_STEP;
    this.world.numSolverIterations = SOLVER_ITERATIONS;

    this._accumulator = 0;

    // Structure
    this._structureBody = null;
    this._anchor = { x: 0, y: 0, z: 0 };
    this._cubeColliders = new Map(); // key -> collider

    // Static geometry
    this._floorBody = null;
    this._wallBodies = [];

    // Growing cubes (kinematic)
    this._growingBodies = new Map(); // id -> body
    this._growId = 0;

    // Debris
    this._debrisBodies = new Map(); // id -> body
    this._debrisId = 0;
  }

  // ═══════════════════════════════════════════════════
  // WORLD
  // ═══════════════════════════════════════════════════

  step(dt) {
    this._accumulator += dt;
    let stepped = false;
    while (this._accumulator >= PHYS_STEP) {
      this.world.step();
      this._accumulator -= PHYS_STEP;
      stepped = true;
    }
    return stepped;
  }

  reset() {
    // Tear down everything and recreate the world
    this.world.free();
    this.world = new this.RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = PHYS_STEP;
    this.world.numSolverIterations = SOLVER_ITERATIONS;
    this._accumulator = 0;
    this._structureBody = null;
    this._anchor = { x: 0, y: 0, z: 0 };
    this._cubeColliders = new Map();
    this._floorBody = null;
    this._wallBodies = [];
    this._growingBodies = new Map();
    this._debrisBodies = new Map();
  }

  // ═══════════════════════════════════════════════════
  // STATIC GEOMETRY
  // ═══════════════════════════════════════════════════

  createFloor(tiles) {
    if (this._floorBody) {
      this.world.removeRigidBody(this._floorBody);
      this._floorBody = null;
    }
    if (!tiles || tiles.length === 0) return;

    const desc = this.RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    this._floorBody = this.world.createRigidBody(desc);

    const TILE_H = 1;
    for (const t of tiles) {
      const ty = t.y || 0;
      const cd = this.RAPIER.ColliderDesc.cuboid(0.5, TILE_H / 2, 0.5)
        .setTranslation(t.x + 0.5, ty - TILE_H / 2, t.z + 0.5)
        .setFriction(STATIC_FRICTION)
        .setRestitution(STATIC_RESTITUTION)
        .setCollisionGroups(GROUPS_GROUND);
      this.world.createCollider(cd, this._floorBody);
    }
  }

  addWall(x, z, w, h, d) {
    const desc = this.RAPIER.RigidBodyDesc.fixed().setTranslation(x, h / 2, z);
    const body = this.world.createRigidBody(desc);
    const cd = this.RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
      .setFriction(STATIC_FRICTION)
      .setRestitution(STATIC_RESTITUTION)
      .setCollisionGroups(GROUPS_GROUND);
    this.world.createCollider(cd, body);
    this._wallBodies.push(body);
    return body;
  }

  addZipSegment(pos, rot, halfW, halfH, halfD) {
    const desc = this.RAPIER.RigidBodyDesc.fixed()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation(rot);
    const body = this.world.createRigidBody(desc);
    const cd = this.RAPIER.ColliderDesc.cuboid(halfW, halfH, halfD)
      .setFriction(STATIC_FRICTION)
      .setRestitution(STATIC_RESTITUTION)
      .setCollisionGroups(GROUPS_GROUND);
    this.world.createCollider(cd, body);
    this._wallBodies.push(body);
    return body;
  }

  clearStaticGeometry() {
    if (this._floorBody) {
      this.world.removeRigidBody(this._floorBody);
      this._floorBody = null;
    }
    for (const b of this._wallBodies) {
      this.world.removeRigidBody(b);
    }
    this._wallBodies.length = 0;
  }

  // ═══════════════════════════════════════════════════
  // STRUCTURE BODY
  // ═══════════════════════════════════════════════════

  /**
   * Create the structure body from a set of cube grid positions.
   * Called once at level start and on debris splits.
   * @param {Array<{gx,gy,gz}>} cubes - grid positions
   * @param {{x,y,z}} groupPos - structureGroup.position
   * @param {{x,y,z,w}} groupRot - structureGroup.quaternion
   * @returns {{ position, rotation, anchor }} or null
   */
  createStructureBody(cubes, groupPos = {x:0,y:0,z:0}, groupRot = {x:0,y:0,z:0,w:1}) {
    // Clean up old body
    if (this._structureBody) {
      this.world.removeRigidBody(this._structureBody);
      this._structureBody = null;
    }
    this._cubeColliders.clear();

    if (!cubes || cubes.length === 0) return null;

    // Compute anchor (centroid of cube centers in local space)
    let ax = 0, ay = 0, az = 0;
    for (const c of cubes) {
      ax += c.gx;
      ay += 0.5 + (c.gy || 0);
      az += c.gz;
    }
    ax /= cubes.length;
    ay /= cubes.length;
    az /= cubes.length;
    this._anchor = { x: ax, y: ay, z: az };

    // Compute world position of anchor
    const wp = applyQuatToVec(groupRot, this._anchor);
    wp.x += groupPos.x;
    wp.y += groupPos.y;
    wp.z += groupPos.z;

    const bodyDesc = this.RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(wp.x, wp.y, wp.z)
      .setRotation(groupRot)
      .setCanSleep(false)
      .setLinearDamping(STRUCT_LINEAR_DAMPING)
      .setAngularDamping(STRUCT_ANGULAR_DAMPING);
    this._structureBody = this.world.createRigidBody(bodyDesc);

    // Add colliders for each cube
    for (const c of cubes) {
      const lx = c.gx - ax;
      const ly = (0.5 + (c.gy || 0)) - ay;
      const lz = c.gz - az;
      const cd = this.RAPIER.ColliderDesc.cuboid(CUBE_HALF, CUBE_HALF, CUBE_HALF)
        .setTranslation(lx, ly, lz)
        .setFriction(STRUCT_FRICTION)
        .setRestitution(STRUCT_RESTITUTION)
        .setDensity(STRUCT_DENSITY)
        .setCollisionGroups(GROUPS_STRUCTURE);
      const collider = this.world.createCollider(cd, this._structureBody);
      this._cubeColliders.set(cubeKey(c), collider);
    }

    return this.getStructureTransform();
  }

  /**
   * Add a single cube collider to the existing structure body.
   * No rebuild — preserves contact cache and warmstarting.
   * @param {{gx,gy,gz}} cube
   * @param {{x,y,z}} groupPos - current structureGroup.position
   * @param {{x,y,z,w}} groupRot - current structureGroup.quaternion
   * @returns collider handle key
   */
  addCubeCollider(cube, groupPos, groupRot) {
    if (!this._structureBody) return null;

    const bodyPos = this._structureBody.translation();
    const bodyRot = this._structureBody.rotation();

    // Cube center in world space (via group transform)
    const cubeLocal = { x: cube.gx, y: 0.5 + (cube.gy || 0), z: cube.gz };
    const cubeWorld = applyQuatToVec(groupRot, cubeLocal);
    cubeWorld.x += groupPos.x;
    cubeWorld.y += groupPos.y;
    cubeWorld.z += groupPos.z;

    // Convert to body-local space
    const offset = {
      x: cubeWorld.x - bodyPos.x,
      y: cubeWorld.y - bodyPos.y,
      z: cubeWorld.z - bodyPos.z,
    };
    const invBodyRot = invertQuat(bodyRot);
    const localOffset = applyQuatToVec(invBodyRot, offset);

    const cd = this.RAPIER.ColliderDesc.cuboid(CUBE_HALF, CUBE_HALF, CUBE_HALF)
      .setTranslation(localOffset.x, localOffset.y, localOffset.z)
      .setFriction(STRUCT_FRICTION)
      .setRestitution(STRUCT_RESTITUTION)
      .setDensity(STRUCT_DENSITY)
      .setCollisionGroups(GROUPS_STRUCTURE);
    const collider = this.world.createCollider(cd, this._structureBody);

    const key = cubeKey(cube);
    this._cubeColliders.set(key, collider);
    return key;
  }

  /**
   * Remove a cube's collider from the structure body.
   */
  removeCubeCollider(cube) {
    const key = cubeKey(cube);
    const collider = this._cubeColliders.get(key);
    if (collider) {
      this.world.removeCollider(collider, true);
      this._cubeColliders.delete(key);
    }
  }

  /**
   * Get the current transform of the structure body.
   */
  getStructureTransform() {
    if (!this._structureBody) return null;
    const pos = this._structureBody.translation();
    const rot = this._structureBody.rotation();
    return {
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      anchor: { ...this._anchor },
    };
  }

  hasStructureBody() {
    return this._structureBody !== null;
  }

  applyImpulse(impulse) {
    if (!this._structureBody) return;
    this._structureBody.applyImpulse(impulse, true);
  }

  getLinvel() {
    if (!this._structureBody) return { x: 0, y: 0, z: 0 };
    const v = this._structureBody.linvel();
    return { x: v.x, y: v.y, z: v.z };
  }

  getAngvel() {
    if (!this._structureBody) return { x: 0, y: 0, z: 0 };
    const v = this._structureBody.angvel();
    return { x: v.x, y: v.y, z: v.z };
  }

  getStructurePosition() {
    if (!this._structureBody) return { x: 0, y: 0, z: 0 };
    const p = this._structureBody.translation();
    return { x: p.x, y: p.y, z: p.z };
  }

  removeStructureBody() {
    if (this._structureBody) {
      this.world.removeRigidBody(this._structureBody);
      this._structureBody = null;
    }
    this._cubeColliders.clear();
  }

  // ═══════════════════════════════════════════════════
  // GROWING CUBES (kinematic slide animation)
  // ═══════════════════════════════════════════════════

  createGrowingBody(worldPos, worldRot) {
    const desc = this.RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(worldPos.x, worldPos.y, worldPos.z)
      .setRotation(worldRot);
    const body = this.world.createRigidBody(desc);
    const cd = this.RAPIER.ColliderDesc.cuboid(CUBE_HALF, CUBE_HALF, CUBE_HALF)
      .setFriction(0.5)
      .setRestitution(0.0)
      .setCollisionGroups(GROUPS_GROWING);
    this.world.createCollider(cd, body);

    const id = this._growId++;
    this._growingBodies.set(id, body);
    return id;
  }

  moveGrowingBody(id, worldPos, worldRot) {
    const body = this._growingBodies.get(id);
    if (!body) return;
    body.setNextKinematicTranslation(worldPos);
    body.setNextKinematicRotation(worldRot);
  }

  removeGrowingBody(id) {
    const body = this._growingBodies.get(id);
    if (!body) return;
    this.world.removeRigidBody(body);
    this._growingBodies.delete(id);
  }

  // ═══════════════════════════════════════════════════
  // DEBRIS
  // ═══════════════════════════════════════════════════

  /**
   * Create a debris body from a set of cubes that detached.
   * @param {Array<{gx,gy,gz}>} cubes
   * @param {{x,y,z}} comWorld - center of mass in world space
   * @param {{x,y,z,w}} rot - rotation to inherit
   * @param {{x,y,z}} linvel - velocity to inherit
   * @param {{x,y,z}} angvel - angular velocity to inherit
   */
  spawnDebris(cubes, comWorld, rot, linvel, angvel) {
    const bodyDesc = this.RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(comWorld.x, comWorld.y, comWorld.z)
      .setRotation(rot)
      .setCanSleep(false)
      .setLinearDamping(DEBRIS_LINEAR_DAMPING)
      .setAngularDamping(DEBRIS_ANGULAR_DAMPING);
    const body = this.world.createRigidBody(bodyDesc);
    body.setLinvel(linvel, true);
    body.setAngvel(angvel, true);

    // Compute local COM for collider offsets
    let cx = 0, cy = 0, cz = 0;
    for (const c of cubes) {
      cx += c.gx; cy += 0.5 + (c.gy || 0); cz += c.gz;
    }
    cx /= cubes.length; cy /= cubes.length; cz /= cubes.length;

    for (const c of cubes) {
      const cd = this.RAPIER.ColliderDesc.cuboid(CUBE_HALF, CUBE_HALF, CUBE_HALF)
        .setTranslation(c.gx - cx, (0.5 + (c.gy || 0)) - cy, c.gz - cz)
        .setFriction(DEBRIS_FRICTION)
        .setRestitution(DEBRIS_RESTITUTION)
        .setDensity(STRUCT_DENSITY)
        .setCollisionGroups(GROUPS_DEBRIS);
      this.world.createCollider(cd, body);
    }

    const id = this._debrisId++;
    this._debrisBodies.set(id, body);
    return { id, comLocal: { x: cx, y: cy, z: cz } };
  }

  getDebrisTransform(id) {
    const body = this._debrisBodies.get(id);
    if (!body) return null;
    const pos = body.translation();
    const rot = body.rotation();
    return {
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
    };
  }

  removeDebris(id) {
    const body = this._debrisBodies.get(id);
    if (!body) return;
    this.world.removeRigidBody(body);
    this._debrisBodies.delete(id);
  }

  getAllDebrisIds() {
    return [...this._debrisBodies.keys()];
  }
}

// ═══════════════════════════════════════════════════
// MATH HELPERS (quaternion math without Three.js)
// ═══════════════════════════════════════════════════

function applyQuatToVec(q, v) {
  // Rotate vector v by quaternion q
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const vx = v.x, vy = v.y, vz = v.z;

  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);

  return {
    x: vx + qw * tx + (qy * tz - qz * ty),
    y: vy + qw * ty + (qz * tx - qx * tz),
    z: vz + qw * tz + (qx * ty - qy * tx),
  };
}

function invertQuat(q) {
  // For unit quaternions, inverse = conjugate
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

function cubeKey(c) {
  return `${c.gx},${c.gy || 0},${c.gz}`;
}

