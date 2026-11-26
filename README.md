# Rikudo³: Cube · Sphere · Pyramid

A three.js take on Rikudo. Fill every cell with **1 → N** so that each number touches the next. Gold **chutes** join two cells that must hold consecutive numbers. Every puzzle has exactly one solution, and the solver checks this when the puzzle is generated.

Open `index.html` in a browser. It works straight from disk. three.js loads from the jsDelivr CDN, so you need to be online the first time. Choose a board under **Board**, or link straight to one with `index.html?board=cube|sphere|pyramid`.

## Boards

| Board | Shape | Cells | Neighbours | Special cells |
|---|---|---|---|---|
| **Cube** | 6 faces × 3×3 tiles | 54 | 4 (wrapping over edges) | — |
| **Sphere** | Goldberg polyhedron | 42 / 72 / 92 | hexagons 6 | 12 pentagons (5 neighbours) |
| **Pyramid** | tetrahedron tiled with triangles | 36 / 64 / 100 | 3 (the triangles sharing a side, also across edges) | — |

- **Blocking pentagons:** on the sphere you can block the 12 pentagons, like the blocked centre of a classic Rikudo grid, giving 30 / 60 / 80 cells.
- **Pyramid:** every cell lies flat on one face, so nothing folds over an edge. With only 3 neighbours per cell the path is tightly constrained, so pyramid puzzles need far fewer givens: often only 3–6, even on 100 cells. Path lines and chutes bend over the pyramid's edges.
- **Size menu:** always shows the number of cells you'll actually fill.
- **Cube look:** the cube keeps its original Rubik's-style look (white-disc givens, flat tiles, orbit controls) for comparison.
- **Sphere and pyramid look:** engraved givens, gold chute bars and free trackball rotation. Numbers stay upright to the viewer.
- **Colours:** the sphere's cells use a teal → blue → violet range, the pyramid is sandstone, and path lines run teal → green → yellow. None of them use red, which is reserved for errors.

## Controls

| Action | Input |
|---|---|
| Rotate | drag, freely in every direction on all three boards |
| Straighten the cube | double-tap or double-click the background: flies square-on to the nearest face, numbers upright |
| Place the pen number | click an empty cell |
| Build on from a number | click it; **click it again** to flip between building up (+) and down (−). The **+ / −** buttons or keys work too |
| Erase one cell | long-press (mouse or touch), right-click, or Shift-click |
| Erase every wrong number | **Shift-click Eraser** (Shift+E), +10 s per number. Undo brings them back, but the penalty stays |
| Type a number | select a cell, then type digits |
| Move the selection | arrow keys, which follow the direction you see on screen |
| Hint | **H**, +30 s. It fixes one of your wrong numbers first (a red one if there is one) and says why. Otherwise it reveals the next number |
| Peek at the solution | **Shift-click Hint** (Shift+H): 3 s, +60 s. Your wrong cells glow orange |
| Pause | **P** or ❚❚ Pause. The clock stops and the board is blacked out. Switching tabs pauses automatically |
| Fly to your chain end | **F** |

**Rule check:** red cells break a rule right now, and the Rule check box explains each one in plain words: two numbers that don't touch, a duplicate, a number boxed in with no free neighbour, or a broken chute. A number can also be wrong without breaking a rule yet; Hint and Shift-erase check against the solution.

## First-run tutorial

On first visit a guided mini puzzle opens: a flat 3×4 board (givens 1, 5, 12 and a chute 9–10, which make the path unique). It takes about a minute. The player places numbers, continues from a given, erases a deliberately wrong 6 (it boxes in a corner), uses the chute, and switches to counting down from the house. The clock stays paused until **Start playing**. **Skip** or Escape closes it. You can replay it from *How to play → Replay the tutorial*, and "Show this at every start" suits a kiosk.

## Difficulty rating

Every puzzle is graded by a **rating solver** that only uses human-style techniques, in tiers:

| Tier | Technique | Points per step |
|---|---|---|
| 1 | **Next in line:** only one free neighbour of *k* can hold *k*±1, or a chute forces the move | 1 |
| 2 | **Link logic:** every cell uses exactly 2 of its sides (1 at the ends), so a cell with only 2 usable sides must use both, and links then pin down numbers | 2 |
| 3 | **Range reasoning:** a value can only sit within reach of the placed numbers on both sides, so a value with one possible cell (or a cell with one possible value) is placed | 4 |
| 4 | **Trial and error:** of 2–4 options, all but one lead to a contradiction | 10 |
| 5 | **Deep search:** none of the above makes progress | 20 |

- **Rating:** the sum of points over every step, so bigger boards and harder techniques both raise it.
- **Level:** the harder of two measures: how heavy the average step is (Easy under 2 points per step, Medium under 2.8, Hard under 3.8), and how often trial and error or deep search is needed.
- **Beginner:** below Easy, defined by technique rather than average. Every step is next in line or a chute, with at most a few link-logic steps (max(2, 4% of N)) and no range reasoning, trial or deep search, so the tutorial's moves are enough. Each pack starts with 6 Beginner puzzles, and a new player's first puzzle is one. After two Beginner solves, the win screen offers the step up to Easy.
- **Generation:** the generator aims for the requested level. Below Expert, it never removes a given if that would push the puzzle past the requested level. A puzzle is always labelled with its **actual** rating, and if a requested level isn't found in time, the game says so.

## Scoring

```
score   = base × speed × assists
base    = rating × 10
own     = 1 − (sum of all assist costs), never below 0     (the share you solved yourself)
pace    = par ÷ your time, kept between 0.3 and 2           (par = 5 s per rating point)
speed   = 1 + (pace − 1) × own                              (the bonus counts only for your own share)
assists = own; ×1.1 if rule highlights were off
```

| Assist | Cost | Why |
|---|---|---|
| Hint | the share of difficulty it removed, 4–30% | The remaining puzzle is rated before and after the hint. A hint on the key step costs a lot, one on the last cell almost nothing |
| Check (C) | 10% + 2% per wrong number, **also when everything is correct** | "You're on track" is real information |
| Peek (Shift+Hint) | 50% the first time, 15% after that | It shows the whole solution |
| Rule-conflict highlights | free, or a +10% bonus if they're off before your first move | They only show what the rules already imply |

- **Costs add up:** each hint costs its share of the puzzle's difficulty, at least 4%, so hints that solve the whole puzzle add up to 100% or more and leave 0 points. Light use is almost unchanged from the old multiplied costs (two 4% hints cost 8% either way).
- **No speed bonus for hinting:** a hint-through is fast, but the speed factor only applies to the share you solved yourself.
- **Assists stick to the puzzle:** they survive Restart, so you can't peek and then restart for a clean run.
- **Only first solves score:** only your **first** solve of a puzzle counts towards your total. Replays are recorded as practice, since by then you know the answer.
- **Win screen:** shows the formula graphically. Base has a bar coloured by the techniques the puzzle needed, Speed has a gauge against par, and Assists shows one chip per kind of assist (hints, checks, peeks) with its count and total cost; hover for each single use.
- **Storage:** scores are kept per player, in this browser.
- **Tuning:** `PAR_PER_POINT`, `NET_BONUS` and the speed limits are at the top of the scoring code in `index.html`. Tier weights and level thresholds are in `rikudo-core.js` (`TIER_W`, `levelOf`).

## Generating puzzles

**In the game:** pick a board, size and difficulty, then press **New puzzle**. Generation runs in a background Web Worker and takes up to about 3 s.

**As packs (CLI):**

```bash
node generate.js                                   # 40 cube puzzles, easy → expert  -> puzzles.js/json
node generate.js --board sphere --mixed-holes      # 36 sphere puzzles, all sizes   -> puzzles-sphere.js/json
node generate.js --board pyramid                   # 36 pyramid puzzles, all sizes  -> puzzles-pyramid.js/json
node generate.js --board pyramid --size 74 -d expert -n 10 -o weekly
```

`index.html` loads `puzzles.js`, `puzzles-sphere.js` and `puzzles-pyramid.js` automatically and lists the pack for the current board. Run `node generate.js --help` for all options.

### How it works (`rikudo-core.js`)

1. **Board geometry:**
   - The cube is 54 stickers.
   - The sphere is a Goldberg polyhedron (GP(2,0), GP(2,1), GP(3,0)), built by subdividing an icosahedron and taking the dual.
   - The pyramid is a regular tetrahedron with each face cut into m² small triangles. Each triangle is a cell, and neighbours share a side.
2. **Path:** a random path through every cell, built by a randomised search with Warnsdorff ordering plus connectivity and dead-end pruning.
3. **Chutes:** some of the path's steps become chutes, with no two chutes sharing a cell.
4. **Removing givens:** the generator removes given numbers in random order. A removal is kept only if the solver still finds **exactly one** solution. On Expert, chutes that aren't needed for uniqueness are dropped too.
5. **Solver:** a depth-first search with reachability checks, a distance bound to the next given, a dead-end check and chute forcing. It only needs a neighbour list (`createEngine(neigh)`), so a new board shape only needs a geometry builder.

### Puzzle format

```json
{ "id": "p64-hard-1r1ok0s", "seed": 123, "difficulty": "hard",
  "board": { "type": "pyramid", "size": 64, "holes": false },
  "cells":    [N ints, 0 = blank],
  "chutes":   [[a, b], ...],
  "solution": [N ints] }
```

Cell ids index the playable cells of `RikudoCore.boardFor(board)`. On the sphere, `holes: true` means the 12 pentagons are blocked. Difficulty presets for the pyramid are in `triangleDifficulties()`.

## Files

- `index.html`: the game, with all three boards.
- `science-content.js`: the article "The science behind Rikudo³" (text, diagrams, formulas). The game shows it on the pause screen, and `science.html` shows it as a page of its own. Edit it here and both update. Formulas use KaTeX from the CDN.
- `science.html`: the article as a standalone page (linked from *How to play*, the win screen and the tutorial).
- `rikudo-core.js`: boards, solver and generator (browser and Node).
- `generate.js`: the CLI pack generator.
- `puzzles*.js` and `puzzles*.json`: puzzle packs.
- `sphere.html`: redirects to `index.html?board=sphere`.
- `legacy/`: the previous separate cube and sphere pages, kept for comparison.
