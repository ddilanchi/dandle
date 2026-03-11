# Dandle - Project Status (v4.0.1)

## What we are doing
3D word-building physics puzzle game. Players click letter cubes, type words containing that letter to place them Scrabble-style, and use word placement impulses to push the structure into a red end zone.

## Current Progress
- 6 playable levels with progressive obstacles
- Full physics rewrite (v4.0.0): separate `js/physics.js` module wrapping Rapier3D
- Incremental collider system — structure body created once, colliders added per word (no rebuild)
- Word validation via WordNet 3.1 (74k words)
- Procedural audio (Web Audio API)
- Level progression with unlock system
- Graphics settings (resolution, shadows, fog, pixelation, tone mapping)
- Keyboard navigation (Shift+WASD/QE/Space)
- Ghost preview of word placement
- Debris system (deleted words break off as grey chunks)
- GitHub Pages deployment (no build step)

## Architecture
- **js/game.js** — Three.js rendering, game logic, UI, levels
- **js/physics.js** — Rapier3D physics engine wrapper (clean API, no Three.js dependency)
- **js/audio.js** — Procedural Web Audio
- **js/wordlist.js** — WordNet dictionary loader

## Completed Steps
- [x] Project scaffold with Three.js + ES modules
- [x] Checkerboard floor (green/beige)
- [x] Letter cube generation with canvas textures
- [x] Word placement and crossword validation
- [x] End zone with win detection
- [x] Procedural audio (Web Audio API)
- [x] GitHub Pages ready (no build step)
- [x] 6 levels (flat, wall, elevated, gap, letter zones, zip line)
- [x] Level progression and unlock system
- [x] Graphics settings panel
- [x] Word deletion and debris system
- [x] Ghost preview for word placement
- [x] Keyboard navigation (Shift+WASD/QE/Space)
- [x] Physics engine rewrite — separate module, incremental colliders, no body rebuilds
- [x] Collision group cleanup (removed CG_PARENT hack)
- [x] Physics tuning (gravity 10, solver iterations 8, friction 0.1, damping 0.15)

## Next Steps
- [ ] Verify physics stability across all 6 levels after v4.0 rewrite
- [ ] Tune push impulse strength vs friction balance
- [ ] More level designs
- [ ] Score/rating system
- [ ] Visual polish (particles, animations)
- [ ] Mobile touch support

## Future Goals
- Leaderboard
- Custom level editor
- Verb force system (verbs apply sustained directional thrust)

## Important Notes
- Always commit and push after changes — testing happens via GitHub Pages in browser
- Cache buster in index.html must be updated when game.js changes (`?v=X.X.X`)
- Half-extent MUST be 0.5 (not 0.47) — see PHYSICS_ANIMATION.md for ground gap bug history
- Structure body should NEVER be rebuilt during normal word placement — only on debris splits or level restart
