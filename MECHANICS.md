# Dandle — Gameplay Mechanics

## Core Loop
Select a letter cube → type a word containing that letter → word is placed as a Scrabble-style chain of letter cubes → the structure is pushed toward the red end zone using physics and verb forces.

---

## Word Placement
- Click any cube to select it (highlighted in gold)
- Type a word that contains that letter
- The selected letter anchors the word at that position (Scrabble crossword style)
- Mouse position determines build direction (x+, x-, z+, z-) — a blue arrow shows the direction from the selected block
- Words branch off the existing structure; overlapping letters must match
- Minimum 2 letters per word
- The starter word is always a noun (never a verb)

## Word Types (Spinner)
When a word qualifies as multiple parts of speech, a spinner animates and lands on a random valid type:
- **NOUN** (beige) — passive block, no special effect
- **VERB** (sky blue) — triggers rocket thrust after a 3-second countdown
- **ADJ** (green) — passive block (no current special effect)

Type detection: WordNet 3.1 (74k words), with hardcoded VERBS/ADJECTIVES as fallback.

---

## Physics
- The entire structure is one compound rigid body (cannon-es)
- Mass = number of cubes
- Gravity = 20 m/s²
- Linear damping 0.05, angular damping 0.05
- Restitution 0.25 (slight bounce), friction 0.4
- Structure can tip, slide, tumble, and fall

---

## Verb Rocket Thrust
- After placing a verb, a 3-second countdown timer appears above the word
- On ignition: sustained rocket force applied for **word.length seconds**
- Force direction = direction the word was placed in
- Red arrow pulses during active thrust
- Multiple verbs stack and fire independently
- Sound: ignition pop → engine rumble → per-second countdown beeps → cutoff thud

---

## Level Obstacles

### End Zone
- Red pulsing plane; any cube entering it triggers level complete

### Walls
- Static rigid bodies the structure must go around or over (Level 2)

### Letter Zones (Level 5)
- Tiles on the floor labeled with a letter
- **+X**: deletes any word NOT containing letter X
- **-X**: deletes any word that DOES contain letter X
- Triggered when the structure slides over the zone

---

## Level Progression
- 5 levels, each with a unique obstacle layout
- Click anywhere on the level-complete screen to advance to the next level
- Loops back to Level 1 after Level 5
- Restart button → level select (manual navigation)

| Level | Layout |
|-------|--------|
| 1 | Open field — learn the basics |
| 2 | Wall blocking the path |
| 3 | Elevated end zone (build upward) |
| 4 | Corridor walls — navigate through |
| 5 | Letter zones scattered across the floor |

---

## Lose Conditions
- Structure slides off the edge of the floor → auto-restart

---

## Controls
- **Click** cube → select it
- **Type + Enter / Place** → place word
- **Mouse drag** → orbit camera
- **Scroll** → zoom
- **ESC** → pause / unpause
- **Gear button** → settings menu
- **Restart button** → level select

---

## Settings (Graphics)
- **Resolution**: Low (0.5x), Medium (1x), High (native DPI)
- **Shadows**: on/off
- **Fog**: on/off
- **Cinematic Tone**: ACES filmic tone mapping on/off
- **Pixelate**: Off / Low (1/4 res) / High (1/8 res)

---

## Audio
- **Select**: short chirp
- **Place**: thunk + noise snap
- **Verb ignition**: pop → engine rumble → countdown beeps → cutoff thud
- **Collision**: throttled thud (max once per second)
- **Level complete**: ascending chime (C-E-G-C)
- **Error**: descending buzz
- **Background music**: walking bass (scale steps every quarter note) + right-hand melody (chords, runs, fills); tempo increases slightly with cube count

---

## Ideas / Not Yet Implemented
- ADJ modifier effect (e.g. heavier/lighter cube, bigger/smaller)
- Ramps and inclined surfaces
- Moving platforms
- Word undo / deletion mechanic
- Score system (letters used, time, word quality)
- Mobile touch support
- Custom level editor
