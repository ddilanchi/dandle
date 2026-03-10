# Physics Reference — Lessons Learned

## The Ground Gap Bug (v2.0→v2.2.2)

**Spent hours debugging a "launch" bug. Root cause was a 0.03 unit gap.**

Physics shapes had half-extent 0.47 (matching the 0.94 visual cube), but cube
centers were at y=0.5. Shape bottom = 0.5 - 0.47 = **0.03 above the ground**.

Every `createStructureBody()` call created a new body with no cached contacts.
Gravity pulled it through the 0.03 gap. By the time it hit the ground (~4 frames),
it was falling at **1.165 m/s across every shape**. cannon-es resolved the
penetration with a massive impulse → structure launched into the air.

**Fix:** Half-extent 0.5. Shape bottom = 0.5 - 0.5 = 0.0 = exact ground level.
Adjacent shapes overlap 0.06 within the same compound body — harmless.

**Takeaway:** In cannon-es, a gap of even 0.03 units under gravity=20 produces
a 1+ m/s impact. Always ensure shape bounds reach the resting surface exactly.

---

## What NOT to Do (tried all of these, none worked)

| Approach | Why it failed |
|---|---|
| Rebuild body every frame during growth | Destroys solver contact state → impulse |
| `body.addShape()` mid-simulation | Shape appears inside collision space → impulse |
| Make body KINEMATIC during growth | Structure freezes in mid-air, gravity stops |
| Make body STATIC during placement | STATIC↔DYNAMIC transition loses all contacts → impulse on resume |
| Zero velocity every frame during placement | `world.step()` still integrates → micro-drift → shape overlap |
| Rebalance COM by shifting `body.position` | Teleports body into ground overlap → impulse |
| Recompute `_comLocal` from actual body pos | Correct math, but doesn't fix the 0.03 gap |

---

## Current System (v2.2+)

### How cube placement works

1. Each new letter gets its own **kinematic CANNON.Body** (separate from the structure)
2. Collision-filtered: `CG_GROWING=4` only collides with `CG_GROUND=1`, ignores `CG_STRUCTURE=2`
3. The kinematic body physically slides from the parent cube to the target at `TRANSLATE_SPEED`
4. Mesh position + scale animate alongside (visual tracks kinematic body)
5. When the cube arrives, the kinematic body is removed
6. When the **entire word** finishes, a single `createStructureBody()` rebuilds the compound body

### Collision filter groups

```
CG_GROUND    = 1   // floor, walls, debris (default group for static geometry)
CG_STRUCTURE = 2   // the main compound structure body
CG_GROWING   = 4   // kinematic cubes sliding into position
```

- Structure ↔ Ground: collide ✓
- Growing ↔ Ground: collide ✓
- Structure ↔ Growing: NO collision (filtered out)
- Ground defaults: group=1, mask=-1 (collides with everything)

### createStructureBody rules

- Computes COM as average of all cube grid positions
- Places body at COM world position (derived from `structureGroup` transform)
- **Physics half-extent = 0.5** (not 0.47!) so shapes rest exactly on ground
- Copies velocity from old body if rebuilding (preserves momentum from verbs)
- Used only for: level start, word completion rebuild, debris separation, restart

### Key constants

```
GRAVITY = 20
TRANSLATE_SPEED = 3  // units/sec for new cube slide-in
Half-extent = 0.5    // DO NOT change to 0.47 — causes ground gap launch
Cube center y = 0.5 + gy
```

---

## Debugging Physics

Debug logging is toggled by `PHYS_DEBUG = true` at the top of game.js.

Logs to watch for:
- `VELOCITY SPIKE` — velY delta > 1.0, indicates impulse (the "launch")
- `STRUCTURE COLLISION` — impact > 0.5, shows what the body hit
- `CREATE STRUCTURE BODY` — shape bottoms should all be ≥ 0.0
- `POST-REBUILD` — 10 frames after rebuild, velocity should settle near 0

If you see `worldBottom` values below 0 in the create log, shapes are inside
the ground and a launch is imminent.
