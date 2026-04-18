# Japanese Baseball Scorebook Notation Reference

This is the notation vocabulary seeded into the few-shot prompt for scorebook OCR. Keep it synced with `experiments/ocr-baseline/prompts/system.ts`.

## Position numbers

| Num | Position |
|-----|----------|
| 1 | Pitcher (投) |
| 2 | Catcher (捕) |
| 3 | First baseman (一) |
| 4 | Second baseman (二) |
| 5 | Third baseman (三) |
| 6 | Shortstop (遊) |
| 7 | Left fielder (左) |
| 8 | Center fielder (中) |
| 9 | Right fielder (右) |

## Batting outcomes

| Symbol | Meaning |
|--------|---------|
| `1B` / `—` or filled diamond side | Single |
| `2B` / double slash | Double |
| `3B` / triple slash | Triple |
| `HR` / fully filled diamond | Home run |
| `BB` | Walk (base on balls) |
| `HBP` / `死球` | Hit by pitch |
| `K` | Strikeout (swinging) |
| `Kc` / 逆K | Strikeout (looking / called) |
| `SAC` / `犠打` | Sacrifice bunt |
| `SF` / `犠飛` | Sacrifice fly |
| `FC` | Fielder's choice |
| `E{n}` | Error by position n (e.g., `E5` = 3B error) |

## Out notations (combination of positions)

Read as "ball went to the first number, then thrown through any intermediate, to the last number":

| Notation | Meaning |
|----------|---------|
| `4-3` | Grounder to 2B, thrown to 1B (2B→1B out) |
| `6-3` | Grounder to SS, thrown to 1B |
| `5-4-3` | Grounder to 3B → 2B → 1B (double play) |
| `6-4-3` | Grounder to SS → 2B → 1B (double play) |
| `F7` / `L7` | Flyout / liner to LF |
| `F8` / `L8` | Flyout / liner to CF |
| `F9` / `L9` | Flyout / liner to RF |
| `P2` | Pop-up caught by catcher |
| `IF` | Infield fly rule |

## Pitcher result marks (per inning)

| Symbol | Meaning |
|--------|---------|
| `○` | Batter reached base (offense) |
| `●` | Batter made out (defense) |
| `△` | Runner advanced but not out |

## Diamond shading (basepath progression)

A small diamond in each at-bat cell:
- **Upper-right filled** — reached 1B
- **Lower-right filled** — reached 2B
- **Lower-left filled** — reached 3B
- **Upper-left filled / full center dot** — scored

## Runs / RBI tally

Usually small circles or digits in the corner of the cell showing:
- Runs scored (often top of cell)
- RBI credited to the batter

## Notes for OCR prompts

1. Cells are dense and spatial — ask Claude to describe the **grid location (inning × batting order)** with each extracted event.
2. Request **confidence per cell** so downstream UI can surface uncertain reads.
3. Emit both **raw notation** and **structured interpretation** (e.g., `{ raw: "4-3", outcome: "ground_out", fielded_by: 4, thrown_to: 3 }`).
4. When a cell is blank (future inning, not yet played), say `null` rather than guessing.
