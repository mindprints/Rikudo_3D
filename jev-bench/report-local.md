# Jev on Rikudo³: accuracy by technique tier

Model: typesafe/jev-1.14 · 589 answered items · cost $0.0695

Each item asks "Which empty cell must hold the number X?" at a real moment in a solve; the options are every empty cell.

## Accuracy by tier (all boards)

| Tier | n | Accuracy (95% CI) | Chance | Lift | P(correct cell) | Avg options |
|---|---|---|---|---|---|---|
| 1. Next in line | 120 | 82% (74%–88%) | 13% | 6.37× | 55% | 21.3 |
| 2. Link logic | 120 | 38% (29%–46%) | 7% | 5.30× | 32% | 24.4 |
| 3. Range reasoning | 120 | 37% (29%–46%) | 4% | 9.75× | 28% | 36.9 |
| 4. Trial and error | 120 | 45% (36%–54%) | 5% | 9.29× | 33% | 31.9 |
| 5. Deep search | 109 | 36% (27%–45%) | 3% | 13.49× | 29% | 44.3 |

## Accuracy by board and tier

| Board | Next in line | Link logic | Range reasoning | Trial and error | Deep search |
|---|---|---|---|---|---|
| cube | 85% (n=40, chance 15%) | 40% (n=40, chance 9%) | 30% (n=40, chance 4%) | 43% (n=40, chance 5%) | 33% (n=40, chance 3%) |
| sphere | 78% (n=40, chance 14%) | 33% (n=40, chance 8%) | 48% (n=40, chance 4%) | 43% (n=40, chance 7%) | 38% (n=29, chance 3%) |
| pyramid | 83% (n=40, chance 10%) | 40% (n=40, chance 4%) | 33% (n=40, chance 3%) | 50% (n=40, chance 3%) | 38% (n=40, chance 2%) |

## Same number of options, different tier

Later moves have fewer empty cells and so a higher chance rate. Within each band the comparison between tiers is fair.

| Options | Next in line | Link logic | Range reasoning | Trial and error | Deep search |
|---|---|---|---|---|---|
| 2–8 | 96% (n=23) | 37% (n=19) | 40% (n=5) | 40% (n=5) | – |
| 9–20 | 86% (n=36) | 38% (n=34) | 53% (n=15) | 38% (n=34) | 0% (n=5) |
| 21–40 | 76% (n=46) | 39% (n=51) | 33% (n=55) | 50% (n=48) | 42% (n=53) |
| 41–99 | 55% (n=11) | 31% (n=16) | 36% (n=45) | 45% (n=33) | 33% (n=51) |

## Does Jev know when it is wrong?

| Tier | Mean confidence when right | when wrong | AUROC |
|---|---|---|---|
| Next in line | 0.60 | 0.35 | 0.82 |
| Link logic | 0.49 | 0.46 | 0.56 |
| Range reasoning | 0.54 | 0.34 | 0.83 |
| Trial and error | 0.48 | 0.46 | 0.54 |
| Deep search | 0.47 | 0.48 | 0.50 |
| All | | | 0.67 |

## Reasoning or a shortcut?

Shortcut: guess at random among the empty cells next to X−1 or X+1 (whichever are placed). If Jev were using the tier's technique it would beat this; if it only looks near the neighbouring numbers it would match it.

| Tier | Jev | Shortcut | Answer next to X±1 | Jev's pick next to X±1 |
|---|---|---|---|---|
| Next in line | 82% | 88% | 100% | 87% |
| Link logic | 38% | 44% | 100% | 93% |
| Range reasoning | 37% | 28% | 78% | 74% |
| Trial and error | 45% | 43% | 98% | 96% |
| Deep search | 36% | 41% | 100% | 95% |
| All | 48% | 49% | 95% | 89% |

When the answer is not next to X−1 or X+1 (28 items): Jev 0% correct.
