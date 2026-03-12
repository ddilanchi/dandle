# Dandle - Project Status (v5.0.0)

## What we are doing
3D word-building physics puzzle game. Players click letter cubes, type words containing that letter to place them Scrabble-style, and use word placement impulses to push the structure into a red end zone.

## Current Progress
- **v5.0.0: Complete engine migration from Three.js + Rapier3D to Babylon.js + Havok**
- 6 playable levels with progressive obstacles
- Individual physics bodies per cube with 6DOF lock constraints (no compound body)
- Flying letter system — new letters spawn as dynamic bodies that push structure
- Word validation via WordNet 3.1 (74k words)
- Procedural audio (Web Audio API)
- Level progression with unlock system
- Graphics settings (shadows, fog)
- Keyboard navigation (Shift+WASD/QE/Space)
- Ghost preview of word placement
- Debris system (deleted words become grey physics objects)
- GitHub Pages deployment (no build step)

## Architecture
- **js/game.js** — Babylon.js rendering, Havok physics, game logic, UI, levels (single file)
- **js/audio.js** — Procedural Web Audio
- **js/wordlist.js** — WordNet dictionary loader

### Physics Architecture (v5.0.0)
- Each cube is its own `PhysicsAggregate` with mass=1
- Adjacent cubes connected by `Physics6DoFConstraint` (lock all 6 axes)
- No compound body — no body rebuilds, no COM management
- Havok handles constraint solving, warmstarting, and contact cache automatically
- Flying letters: separate dynamic bodies with sustained force toward target
- Debris: just disconnect constraints and change collision group

### Collision Filter Groups
```
CG_GROUND    = 1   // floor, walls, static geometry
CG_STRUCTURE = 2   // main structure cubes
CG_FLYING    = 4   // flying letters (ground + structure collision only)
CG_DEBRIS    = 8   // detached chunks
```

## Completed Steps
- [x] Project scaffold with Three.js + ES modules (v1-v4)
- [x] Checkerboard floor (green/beige)
- [x] Letter cube generation with canvas textures
- [x] Word placement and crossword validation
- [x] End zone with win detection
- [x] Procedural audio (Web Audio API)
- [x] GitHub Pages ready (no build step)
- [x] 6 levels (flat, wall, elevated, gap, letter zones, zip line)
- [x] Level progression and unlock system
- [x] Word deletion and debris system
- [x] Ghost preview for word placement
- [x] Keyboard navigation (Shift+WASD/QE/Space)
- [x] **v5.0.0: Babylon.js + Havok migration (individual bodies + lock constraints)**

## Next Steps
- [ ] Verify physics stability across all 6 levels after v5.0 migration
- [ ] Tune constraint stiffness and damping
- [ ] More level designs
- [ ] Score/rating system
- [ ] Visual polish (particles, animations)
- [ ] Mobile touch support

## Important Notes
- Always commit and push after changes — testing happens via GitHub Pages in browser
- **VERSION must be updated in ALL 3 places when bumping:**
  1. `js/game.js` line ~5: `const VERSION = 'vX.X.X';`
  2. `index.html` CSS cache buster: `css/style.css?v=X.X.X`
  3. `index.html` JS cache buster: `js/game.js?v=X.X.X`
- CDN dependencies (loaded via script tags in index.html):
  - `https://cdn.babylonjs.com/babylon.js`
  - `https://cdn.babylonjs.com/havok/HavokPhysics_umd.js`
