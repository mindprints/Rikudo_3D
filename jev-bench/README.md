# Jev on Rikudo³

Can a one-pass "System 1" decision model solve Rikudo? This benchmark asks Jev (TypeSafe, via OpenRouter) one question at a time:
**"Which empty cell must hold the number X?"**, taken from real moments in real solves.

Each question is labelled with the technique the game's rating solver needed to make that move:

| Tier | Technique | What it takes |
|---|---|---|
| 1 | Next in line | One cell's neighbours: only one empty neighbour of k can hold k ± 1, or a chute forces it |
| 2 | Link logic | A path uses exactly 2 sides of every cell: count the open sides around a cell or two |
| 3 | Range reasoning | Graph distances: X must be within reach of the placed numbers on both sides of it |
| 4 | Trial and error | Assume a placement and follow it to a contradiction |
| 5 | Deep search | Nothing simpler works |

**Hypothesis:** Jev is near-perfect on tiers 1–2 (local evidence, one pass) and drops towards chance from tier 3 on, where the answer depends on what many cells imply together. That's the limit described in *What Can't Jev Decide?* (arXiv 2610.24929). Beginner puzzles use tiers 1–2 only, so they should be Jev-solvable. Easy and above shouldn't be.

## Design

- **Items:** `make-items.js` replays every pack puzzle with the rating solver (`ratePuzzle(p, null, { trace })`) and logs each placement with its tier. It samples up to 40 per board × tier, spread across puzzles. That gives 589 items: the sphere pack has only 29 deep-search moves.
- **Options are every empty cell**, so the list gives nothing away. Chance = 1 ÷ options, and the report shows lift over chance. Later moves have fewer empty cells, so the report also compares tiers within the same option-count band.
- **State** is plain text: the rules, then each cell with its contents, neighbours and chutes. Cell names (`c01`…) are reshuffled for every item, so numbering can't leak position.
- **The answer is always unique**: the solver deduced it from exactly that board, so every item has one right cell.

## Run it

Needs Node 18 or newer and an OpenRouter API key. The whole run costs about $0.03.

Windows PowerShell, in this folder:

```powershell
$env:OPENROUTER_API_KEY = "sk-or-..."
node run.js --dry          # shows the first request, sends nothing
node run.js --limit 3      # smoke test: 3 items, prints the first raw response
node run.js                # the rest (resumable: re-run to continue after an interruption)
node analyze.js            # writes report.md
```

On macOS or Linux, use `export OPENROUTER_API_KEY=sk-or-...` instead of the `$env:` line.

Options: `--model ~typesafe/jev-latest` (default `typesafe/jev-1.14`), `--concurrency 4`, `-o results.jsonl`.
To compare models later, give each run its own output, for example `node run.js --model typesafe/jev-1.13 -o results-1.13.jsonl`, then `node analyze.js -i results-1.13.jsonl -o report-1.13.md`.

## Results so far

**Run 1** (26 Nov 2026, Jev 1.14, plain encoding, 589 items, $0.05) didn't match the hypothesis:

| Tier | Jev | Shortcut* | Chance |
|---|---|---|---|
| Next in line | 68% | 88% | 13% |
| Link logic | 36% | 44% | 7% |
| Range reasoning | 30% | 28% | 4% |
| Trial and error | 39% | 43% | 5% |
| Deep search | 36% | 41% | 3% |

\*Shortcut: guess at random among the empty cells next to X−1 or X+1.

- 76% of Jev's picks are next to X−1 or X+1, and it got 0 of the 28 items whose answer isn't. It matches the shortcut and doesn't beat it, even on the simplest moves.
- Above tier 1, accuracy is flat (36–39%). Jev doesn't use any tier's technique, so the tier makes no difference.
- Confidence flags its own errors on simple moves (AUROC 0.76) but not on hard ones (0.44).

**Reading:** in the plain encoding even "next in line" is a join. Find the cell holding X−1, read its neighbour names, then look up each neighbour's line to see if it is empty. Jev gets as far as "near X−1" and stops, which is the multi-record limit described in arXiv 2610.24929.

**Run 2: test that reading.** `items-local.jsonl` holds the same 589 items, with the same cell names, options and answers, but each neighbour's contents are written inline (`c39: 7; neighbours c03 (8) c05 (22) …`). This makes the simplest moves single-line decisions.
- If the limit is joining records, next-in-line accuracy should jump towards 100% while tiers 2–5 stay near the shortcut.
- If it doesn't jump, the limit is something else.

```powershell
node run.js --items items-local.jsonl -o results-local.jsonl
node analyze.js -i results-local.jsonl        # writes report-local.md
```

**Run 2 result** (26 Nov 2026, $0.07). Same items, compared pair by pair with run 1:

| Tier | Plain | Local | Gained / lost | p (sign test) |
|---|---|---|---|---|
| Next in line | 68% | **82%** | 24 / 7 | 0.003 |
| Link logic | 36% | 38% | 22 / 20 | 0.88 |
| Range reasoning | 30% | 37% | 19 / 11 | 0.20 |
| Trial and error | 39% | 45% | 21 / 14 | 0.31 |
| Deep search | 36% | 36% | 17 / 17 | 1.0 |

- **Removing the join helps exactly where predicted.** Only next-in-line improves significantly. With 2–8 options it reaches 96%.
- **A second limit appears with board size.** Even as a single-line lookup, next-in-line falls with the number of empty cells: 96% with 2–8 options, 86% with 9–20, 76% with 21–40, 55% with 41 or more. Finding the right line among 50–100 and choosing among that many options degrades a one-pass decision.
- **Tiers 2–5 don't move.** Jev now picks a cell next to X−1 or X+1 89% of the time and scores 48%, against the shortcut's 49%. It never performs link logic, range reasoning or trial and error. The 28 answers that aren't next to X±1 are still 0 of 28.
- **Conclusion:** two limits, cleanly separated. Joins across records cost about 14 points on the simplest moves and can be removed by re-encoding the state. Multi-step deduction can't be removed that way: from tier 2 on, Jev's best is the neighbourhood heuristic. In Rikudo terms, Jev plays at Beginner level on small boards and nowhere above it.

## Run 3: the System 2 side

The same items (plain encoding, the harder one) go to models that reason before answering. They use OpenRouter's Chat Completions API: the model thinks, then ends with `ANSWER: <cell>`. Reasoning tokens are recorded, so the report shows how much thinking each tier took.

```powershell
node reason.js --limit 3                                   # smoke test, default model deepseek/deepseek-v4.1-flash-1017, effort medium
node reason.js                                             # all 589 items; stops at --max-cost (default $5)
node reason.js --model typesafe/jev-router --per 20        # Jev picks a model and effort itself: 300 items
node compare.js                                            # every run side by side → compare.md
```

- `--model`: any OpenRouter chat model, for example `qwen/qwen4-max` or `openai/gpt-6.1-terra`. Each model and effort gets its own results file.
- `--effort low|medium|high`: for Jev Router this is only a hint.
- `--per 20`: 20 items per board × tier, for expensive models.
- `--max-cost`: stops the run at this many dollars. Re-run the same command to continue where it stopped.

Predictions: a reasoning model stays high through range reasoning and bends at trial and error and deep search, and its reasoning tokens grow with the tier. Jev Router should send easy moves to cheap models and hard ones to stronger models or higher effort. Whether it judges this correctly is itself a test of a one-pass decision.

**Run 3 result** (26 Nov 2026).

*DeepSeek V4.1 Flash, medium effort, plain encoding, all 589 items, $4.06:*

| Tier | Answered | Right when answered | Overall | Jev (plain) | Shortcut |
|---|---|---|---|---|---|
| Next in line | 100% | 100% | 100% | 68% | 88% |
| Link logic | 98% | 100% | 98% | 36% | 44% |
| Range reasoning | 95% | 100% | 95% | 30% | 28% |
| Trial and error | 83% | 100% | 83% | 39% | 43% |
| Deep search | 24% | 100% | 24% | 36% | 41% |

- **It never gave a wrong answer: 477 of 477 right.** All 112 misses were runs that hit the 32,000-token thinking limit without answering. Jev fails the opposite way: it always answers, often wrongly, and its confidence doesn't flag the hard cases.
- **Thinking grows with difficulty**, from a median of about 1,400 tokens (next in line) to the 32,000 limit (deep search). Link logic took more thinking than range reasoning: for the model, counting sides is harder than measuring distances, the reverse of our human-based tier order.
- **On deep search the fast guess wins**, 41% to 24%: reasoning that can't finish scores nothing.
- **Tentatively, the pyramid is hardest for the model.** That's the reverse of human players and the solver: about twice the thinking on range reasoning and trial and error, and 78% on trial and error against 85% on the other boards. With 40 items per cell, treat this as a lead, not a result.

*Jev Router (it picks the model and effort), medium effort hint, cube only: 100 items, $6.43.* The run stopped at its cost cap after the cube, and the cube is the agreed scope. The comparison is on the same 100 questions:

| Tier | Jev Router | DeepSeek | Cost per question: router / DeepSeek |
|---|---|---|---|
| Next in line | 100% | 100% | $0.012 / $0.001 |
| Link logic | 100% | 95% | $0.022 / $0.006 |
| Range reasoning | 100% | 100% | $0.033 / $0.005 |
| Trial and error | 95% | 85% | $0.062 / $0.009 |
| Deep search | 55% | 20% | $0.19 / $0.017 |

- **Tiers 1–4:** no real difference (n = 20 per tier).
- **Deep search:** the router solved 7 questions DeepSeek didn't, and DeepSeek solved none the router missed (sign test p = 0.016, cube only).
- **Overall:** 90% against 80%, at about 8.5× the cost per question.
- **The router's choice of model hardly follows difficulty.** GPT-6.2 Sol and Gemini 4 Hydrogen dominate at every tier, including moves DeepSeek solves for $0.001; only deep search leans towards Gemini. Cost rises with difficulty, but this run can't show whether Jev raised the effort or the chosen models simply thought longer, because the routing metadata wasn't recorded. `reason.js` now keeps it for future runs.
- **It gave the first wrong answers of any reasoning run:** 2 Expert cube moves, by Claude Sonnet 5.5 and GPT-6.2 Astra. "Never wrong" belongs to DeepSeek at its budget, not to reasoning in general.

## Files

- `make-items.js`: builds `items.jsonl` (plain) and, with `--encoding local`, `items-local.jsonl`. Both are already built and rebuild identically with `--seed 7`
- `run.js`: sends items to the Decisions API (`POST https://openrouter.ai/api/alpha/decisions`), appends to `results.jsonl`
- `reason.js`: the same items for reasoning models or Jev Router (Chat Completions), with reasoning tokens and the model that answered
- `compare.js`: all `results*.jsonl` side by side, with the shortcut and chance, reasoning tokens per tier, and Jev Router's choices → `compare.md`
- `analyze.js`: accuracy by tier and board, with 95% intervals, lift over chance, option-count bands, confidence AUROC, and the shortcut comparison
