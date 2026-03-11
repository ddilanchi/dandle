# DANDLE Physics Reference

## What We've Been Doing Wrong

Our fundamental mistake has been **destroying and recreating the entire compound body
every time the structure changes**. The `createStructureBody()` function tears down
the rigid body, kills all solver contact state, and builds a fresh one from scratch.
This is the root cause of nearly every physics bug we've hit.

Here's why this is so destructive:

### 1. Contact cache (warmstarting) is obliterated on every rebuild

Rapier's constraint solver stores computed impulses inside `TrackedContact::data::impulse`
on geometric contacts. These cached impulses are reused as starting guesses each frame
("warmstarting") — this is what makes stacked/resting objects stable. When we call
`world.removeRigidBody(structureBody)` and create a new one, **all of that cached
contact data is gone**. The new body starts with zero contact history. The solver has
to re-discover every contact from scratch, which takes multiple frames. During those
frames, gravity is pulling the body down unopposed.

This is exactly what caused the ground-gap launch bug. Even a 0.03-unit gap gave
gravity 3-4 frames to accelerate before the solver caught up. With `GRAVITY=20`,
that's ~1.2 m/s of downward velocity resolved as a massive corrective impulse.

**Half-Life 2 (Source/Havok) never did this.** Their physics objects were created once
with fixed collider sets. They didn't dynamically add/remove shapes from compound
bodies during gameplay.

### 2. We're using compound bodies where we should just add colliders

Rapier explicitly supports adding colliders to an existing body at runtime:
```js
let collider = world.createCollider(colliderDesc, existingBody);
```
The body stays alive, contacts stay warm, mass/inertia update automatically. We never
needed to rebuild. The Rapier docs confirm: "Attaching multiple colliders to a single
rigid-body" is the intended way to make compound shapes — and it's incremental.

### 3. Gravity is too high

We use `GRAVITY = 20`, which is 2x real-world gravity (9.81). This means:
- Any gap/penetration produces 2x the velocity before correction
- The solver has half the time to resolve contacts before things explode
- Impulse magnitudes on collision are doubled

This was originally set to make the game feel "snappy" but it amplifies every other
physics bug. At gravity=20 with timestep 1/120, a body falls 0.0007 units per step.
Sounds small, but over the 3-4 frames it takes the solver to warmstart new contacts,
that's enough penetration to trigger corrective impulses.

### 4. Solver iterations are at defaults

We never configured solver iterations. Rapier's defaults are:
- `max_velocity_iterations`: 4
- `max_position_iterations`: 1

For a game where we're pushing compound structures into walls, 4 velocity iterations
isn't enough. The solver needs more passes to resolve all the simultaneous contacts
between multiple cubes and a wall surface.

### 5. The kinematic growth workaround adds complexity for the wrong reason

We built an elaborate system: kinematic bodies with collision filtering that slide
cubes into position, then destroy everything and rebuild. This was a workaround for
the body-rebuild problem. If we stop rebuilding, we don't need most of this.

---

## Bug History

### The Ground Gap Bug (v2.0 - v2.2.2)

Physics shapes had half-extent 0.47 (matching 0.94 visual cubes), but cube centers
sat at y=0.5. Shape bottom = 0.5 - 0.47 = **0.03 above the ground**.

Every `createStructureBody()` call created a body with zero contact cache. Gravity
pulled it through the 0.03 gap. By the time the solver established ground contact
(~4 frames), the body had accumulated ~1.165 m/s downward velocity. The solver
resolved this penetration with a massive impulse, launching the structure.

**Fix:** Half-extent = 0.5. Shape bottom = 0.5 - 0.5 = 0.0 (exact ground level).

**Real fix we should have done:** Stop rebuilding the body.

### The Wall Explosion Bug (ongoing)

Pushing the structure into a static wall with verb forces causes instability. The
compound body has N colliders all contacting the wall simultaneously. With only 4
solver iterations, the solver can't resolve all N contacts in one step. Residual
penetration triggers position corrections that overshoot, causing jitter or launch.

This is a direct consequence of low solver iterations + high gravity + large
compound bodies.

### Failed Approaches (and why they failed)

| Approach | Root cause it didn't address |
|---|---|
| Rebuild body every frame during growth | Destroys warmstart cache every frame |
| `body.addShape()` mid-simulation (cannon-es) | Shape appears overlapping → impulse. But Rapier handles this better with `createCollider()` |
| KINEMATIC during growth | Gravity stops, structure floats |
| STATIC during placement | STATIC→DYNAMIC transition resets contact state |
| Zero velocity every frame | `world.step()` still integrates, micro-drift accumulates |
| Rebalance COM by shifting position | Teleports body → penetration → impulse |

---

## How It Should Work (Going Forward)

### Core principle: Create the body once, add colliders incrementally

```js
// At level start — create the structure body ONCE
function initStructureBody(firstCube) {
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(firstCube.gx, 0.5, firstCube.gz)
    .setCanSleep(false)
    .setLinearDamping(0.3)
    .setAngularDamping(0.3);
  structureBody = world.createRigidBody(bodyDesc);

  const desc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
    .setTranslation(0, 0, 0)  // relative to body
    .setFriction(0.3).setRestitution(0.02)
    .setDensity(1.0);
  firstCube.collider = world.createCollider(desc, structureBody);
}

// When a new letter arrives — just add a collider
function addCubeToBody(cube) {
  const bodyPos = structureBody.translation();
  const desc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
    .setTranslation(
      cube.gx - bodyPos.x,
      (0.5 + cube.gy) - bodyPos.y,
      cube.gz - bodyPos.z
    )
    .setFriction(0.3).setRestitution(0.02)
    .setDensity(1.0);
  cube.collider = world.createCollider(desc, structureBody);
  // Mass and inertia update automatically
}
```

No body destruction. No contact cache loss. No impulse spikes.

### Solver tuning

```js
const world = new RAPIER.World({ x: 0, y: -12, z: 0 }); // reduced from 20
world.timestep = 1 / 120;

// Increase solver iterations for stability with compound shapes against walls
world.integrationParameters.numSolverIterations = 8;       // default: 4
world.integrationParameters.numAdditionalFrictionIterations = 4; // default: 4
world.integrationParameters.numInternalPgsIterations = 1;   // default: 1
```

### Damping and friction adjustments

Current: `linearDamping=0.1, friction=0.02`
These are too low. The structure slides like it's on ice and barely resists motion.

Recommended: `linearDamping=0.3, friction=0.3, restitution=0.02`
This gives blocks a "weighty" feel without being sluggish, and prevents the structure
from sliding endlessly after verb forces expire.

### When you actually need to rebuild

There are a few cases where a full rebuild is still necessary:
- **Debris separation** (word removal splits the structure into disconnected pieces)
- **Level restart** (clean slate)

For these cases, the rebuild is fine because the structure is being fundamentally
restructured. But for normal word placement, never rebuild.

---

## Current System (v4.0.0) — Clean Physics Module

Physics is now a separate module (`js/physics.js`) with a clean API.

### Architecture
- `Physics` class owns the Rapier world, all bodies, all colliders
- game.js talks to it through methods, never touches Rapier directly
- No Three.js dependency in physics module — pure `{x,y,z}` objects

### Placement flow
1. Structure body created ONCE at level start via `physics.createStructureBody()`
2. Each new letter gets a kinematic body via `physics.createGrowingBody()` for slide animation
3. Growing cube only collides with ground (cosmetic — no CG_PARENT hack)
4. When word completes, colliders added incrementally via `physics.addCubeCollider()`
5. Body is NEVER destroyed during normal gameplay — contact cache stays warm
6. Rebuild only happens on debris splits (topology change) or level restart

### Collision filter groups
```
CG_GROUND    = 1   // floor, walls, static geometry
CG_STRUCTURE = 2   // main compound structure body
CG_GROWING   = 4   // kinematic cubes (ground-only collision)
CG_DEBRIS    = 8   // detached chunks
```

No more CG_PARENT. Growing cubes simply don't filter against CG_STRUCTURE.

### Key constants (in physics.js)
```
GRAVITY = 10
PHYS_STEP = 1/120
SOLVER_ITERATIONS = 8
CUBE_HALF = 0.5
STRUCT_FRICTION = 0.5
STRUCT_RESTITUTION = 0.02
STRUCT_LINEAR_DAMPING = 0.3
STRUCT_ANGULAR_DAMPING = 0.3
STATIC_FRICTION = 0.8
```

---

## Debugging Physics

Debug logging: `PHYS_DEBUG = true` at the top of game.js.

Key log signatures:
- `VELOCITY SPIKE` — velY delta > 1.0, indicates impulse (the "launch" bug)
- `STRUCTURE COLLISION` — impact > 0.5, shows what the body hit
- `CREATE STRUCTURE BODY` — shape bottoms should all be >= 0.0
- `POST-REBUILD` — 10 frames after rebuild, velocity should settle near 0

If `worldBottom` values are below 0 in the create log, shapes are inside the
ground and a launch is coming.

---

## Sources and Further Reading

- **Rapier collider docs** — confirms colliders can be added to existing bodies
  incrementally; mass/inertia auto-update. Compound shapes are the recommended
  approach over fixed joints (joints are less numerically stable and slower).
  https://rapier.rs/docs/user_guides/javascript/colliders

- **Rapier integration parameters** — `numSolverIterations` controls constraint
  resolution quality. Higher = more stable stacking/wall contact at cost of CPU.
  `allowed_linear_error` (default 0.001m) prevents jitter from contact cycling.
  `erp` (Error Reduction Parameter) controls penetration correction per step.
  https://rapier.rs/docs/user_guides/javascript/integration_parameters

- **Rapier joints docs** — fixed joints exist but are explicitly documented as
  slower and less numerically stable than multi-collider compound bodies. Only
  use joints when you need to read joint forces (e.g., for breakable connections).
  https://rapier.rs/docs/user_guides/javascript/joints

- **Rapier advanced collision detection** — solver contacts are recomputed each
  frame from geometric contacts, but impulses are cached on geometric contacts
  for warmstarting. This is why body destruction kills stability: cached impulses
  live on the contact manifold, which dies with the body.
  https://rapier.rs/docs/user_guides/javascript/advanced_collision_detection

- **Rapier common mistakes** — gravity/scale mismatches are the #1 issue.
  Using pixel-scale bodies with real gravity makes everything feel floaty or
  explosive. Stick to SI units (1 unit = 1 meter).
  https://rapier.rs/docs/user_guides/javascript/common_mistakes

- **Fix Your Timestep (Gaffer on Games)** — the accumulator pattern we use is
  correct. Key insight: physics must run at fixed dt regardless of frame rate.
  Our 1/120 step with accumulator is textbook correct. The problem was never
  the timestep — it was the body rebuilds and high gravity.
  https://gafferongames.com/post/fix_your_timestep/

- **Integration Basics (Gaffer on Games)** — semi-implicit Euler (update velocity
  first, then position) is the standard for game physics and what Rapier uses
  internally. RK4 is more accurate but not necessary for our use case.
  https://gafferongames.com/post/integration_basics/

- **Physics in 3D (Gaffer on Games)** — use momentum (not velocity) as primary
  state variable. Quaternion drift must be normalized after each step. Forces
  applied at a point generate both linear force and torque simultaneously.
  https://gafferongames.com/post/physics_in_3d/
