# Physics & Animation: Unified System

## Core Principle

**Physics and animation are the same thing.** There is no separate visual animation
pass followed by a physics instantiation. The mesh scale, mesh position, and physics
box size all change together, every frame, driven by the same growth function.

## Why This Matters

If you create a full-size physics box out of thin air at a position that overlaps
with the floor or another body, the physics engine resolves the penetration with a
massive corrective impulse — launching the entire structure into the air.

Separating "animate first, then add physics" doesn't fix this. The physics box still
pops into existence at full size the moment you add it. The user sees a launch.

## How It Works

1. A new cube starts at the previous letter's position with scale ~0 (mesh and physics)
2. Every frame, `updateCubeGrowth()` advances the cube:
   - Mesh position lerps from previous letter to target grid position
   - Mesh scale grows from 0 to 1
   - Physics half-extents grow from ~0 to 0.47 (synchronized with mesh scale)
   - Physics body is rebuilt at discrete steps (8 rebuilds over the growth period)
3. When growth completes (t=1), the cube is at its final position at full size
4. The next letter in the word then starts its growth

## Rules

- Never instantiate a full-size physics shape at a new position
- Never run a visual animation separately from the physics representation
- The mesh IS the physics object — what you see is what the physics engine uses
- One cube grows at a time (sequential per word)
