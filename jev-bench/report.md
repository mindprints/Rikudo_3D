# Jev on Rikudo³: accuracy by technique tier

Model: typesafe/jev-1.14 · 589 answered items · cost $0.0496

Each item asks "Which empty cell must hold the number X?" at a real moment in a solve; the options are every empty cell.

## Accuracy by tier (all boards)

| Tier | n | Accuracy (95% CI) | Chance | Lift | P(correct cell) | Avg options |
|---|---|---|---|---|---|---|
| 1. Next in line | 120 | 68% (59%–75%) | 13% | 5.26× | 41% | 21.3 |
| 2. Link logic | 120 | 36% (28%–45%) | 7% | 5.06× | 26% | 24.4 |
| 3. Range reasoning | 120 | 30% (23%–39%) | 4% | 7.98× | 19% | 36.9 |
| 4. Trial and error | 120 | 39% (31%–48%) | 5% | 8.09× | 25% | 31.9 |
| 5. Deep search | 109 | 36% (27%–45%) | 3% | 13.49× | 26% | 44.3 |

## Accuracy by board and tier

| Board | Next in line | Link logic | Range reasoning | Trial and error | Deep search |
|---|---|---|---|---|---|
| cube | 65% (n=40, chance 15%) | 30% (n=40, chance 9%) | 33% (n=40, chance 4%) | 38% (n=40, chance 5%) | 40% (n=40, chance 3%) |
| sphere | 68% (n=40, chance 14%) | 38% (n=40, chance 8%) | 28% (n=40, chance 4%) | 43% (n=40, chance 7%) | 31% (n=29, chance 3%) |
| pyramid | 70% (n=40, chance 10%) | 40% (n=40, chance 4%) | 30% (n=40, chance 3%) | 38% (n=40, chance 3%) | 35% (n=40, chance 2%) |

## Same number of options, different tier

Later moves have fewer empty cells and so a higher chance rate. Within each band the comparison between tiers is fair.

| Options | Next in line | Link logic | Range reasoning | Trial and error | Deep search |
|---|---|---|---|---|---|
| 2–8 | 83% (n=23) | 47% (n=19) | 0% (n=5) | 40% (n=5) | – |
| 9–20 | 81% (n=36) | 38% (n=34) | 40% (n=15) | 41% (n=34) | 20% (n=5) |
| 21–40 | 57% (n=46) | 25% (n=51) | 36% (n=55) | 48% (n=48) | 36% (n=53) |
| 41–99 | 27% (n=11) | 50% (n=16) | 22% (n=45) | 24% (n=33) | 37% (n=51) |

## Does Jev know when it is wrong?

| Tier | Mean confidence when right | when wrong | AUROC |
|---|---|---|---|
| Next in line | 0.50 | 0.30 | 0.76 |
| Link logic | 0.40 | 0.34 | 0.62 |
| Range reasoning | 0.37 | 0.26 | 0.70 |
| Trial and error | 0.37 | 0.34 | 0.56 |
| Deep search | 0.38 | 0.40 | 0.44 |
| All | | | 0.64 |

## Reasoning or a shortcut?

Shortcut: guess at random among the empty cells next to X−1 or X+1 (whichever are placed). If Jev were using the tier's technique it would beat this; if it only looks near the neighbouring numbers it would match it.

| Tier | Jev | Shortcut | Answer next to X±1 | Jev's pick next to X±1 |
|---|---|---|---|---|
| Next in line | 68% | 88% | 100% | 73% |
| Link logic | 36% | 44% | 100% | 77% |
| Range reasoning | 30% | 28% | 78% | 60% |
| Trial and error | 39% | 43% | 98% | 80% |
| Deep search | 36% | 41% | 100% | 89% |
| All | 42% | 49% | 95% | 76% |

When the answer is not next to X−1 or X+1 (28 items): Jev 0% correct.
