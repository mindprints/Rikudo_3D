# Rikudo³: one-pass decisions vs reasoning

Accuracy on "Which empty cell must hold the number X?", by the technique the move needs. Full runs share the same 589 items; a partial run is compared on its own questions further down.

| Run | n | Next in line | Link logic | Range reasoning | Trial and error | Deep search | All | Cost |
|---|---|---|---|---|---|---|---|---|
| deepseek/deepseek-v4.1-flash-1017 (medium, plain) | 589 | 100% | 98% | 95% | 83% | 24% | 81% | $4.06 |
| typesafe/jev-1.14 (contents shown) | 589 | 82% | 38% | 37% | 45% | 36% | 48% | $0.07 |
| typesafe/jev-router (medium, plain) — partial, see below | 107 | 100% | 100% | 100% | 95% | 55% | 91% | $6.52 |
| typesafe/jev-1.14 (plain) | 589 | 68% | 36% | 30% | 39% | 36% | 42% | $0.05 |
| *Shortcut: guess next to X±1* | 589 | 88% | 44% | 28% | 43% | 41% | 49% | |
| *Chance* | 589 | 13% | 7% | 4% | 5% | 3% | 6% | |

## Same questions as typesafe/jev-router (medium, plain)

100 questions (cube). Every run below is scored on exactly these.

| Run | Next in line | Link logic | Range reasoning | Trial and error | Deep search | All | Cost per question |
|---|---|---|---|---|---|---|---|
| deepseek/deepseek-v4.1-flash-1017 (medium, plain) | 100% (n=20) | 95% (n=20) | 100% (n=20) | 85% (n=20) | 20% (n=20) | 80% | $0.0076 |
| typesafe/jev-1.14 (contents shown) | 85% (n=20) | 45% (n=20) | 30% (n=20) | 45% (n=20) | 35% (n=20) | 48% | $0.0001 |
| typesafe/jev-router (medium, plain) | 100% (n=20) | 100% (n=20) | 100% (n=20) | 95% (n=20) | 55% (n=20) | 90% | $0.0643 |
| typesafe/jev-1.14 (plain) | 75% (n=20) | 30% (n=20) | 40% (n=20) | 45% (n=20) | 40% (n=20) | 46% | $0.0001 |
| *Shortcut* | 92% | 44% | 28% | 45% | 40% | 50% | |
| *Chance* | 13% | 8% | 4% | 5% | 3% | 7% | |

## How much thinking each move took

Mean reasoning tokens per item (right answers / wrong answers).

| Run | Next in line | Link logic | Range reasoning | Trial and error | Deep search |
|---|---|---|---|---|---|
| deepseek/deepseek-v4.1-flash-1017 (medium, plain) | 1773 / – | 7923 / 32000 | 7937 / 29838 | 12735 / 31695 | 19751 / 31438 |
| typesafe/jev-router (medium, plain) | 769 / – | 1402 / – | 2372 / – | 5982 / 10105 | 13466 / 25545 |

## Wrong answer, or no answer?

A reasoning model can fail two ways: answer wrongly, or run out of thinking before it answers (no valid answer, counted as wrong above).

| Run | Next in line: answered / right when answered | Link logic: answered / right when answered | Range reasoning: answered / right when answered | Trial and error: answered / right when answered | Deep search: answered / right when answered |
|---|---|---|---|---|---|
| deepseek/deepseek-v4.1-flash-1017 (medium, plain) | 100% / 100% | 98% / 100% | 95% / 100% | 83% / 100% | 24% / 100% |
|  | 477 answers given, 0 wrong; 112 with no answer (113 hit the token limit) | | | | |
| typesafe/jev-router (medium, plain) | 100% / 100% | 100% / 100% | 100% / 100% | 95% / 100% | 65% / 85% |
|  | 99 answers given, 2 wrong; 8 with no answer (7 hit the token limit) | | | | |

## Where Jev Router sent each move: typesafe/jev-router (medium, plain)

| Tier | Models chosen (count) |
|---|---|
| Next in line | openai/gpt-6.2-sol (9), google/gemini-4-hydrogen (9), google/gemini-4-neon (3), anthropic/claude-sonnet-5.5 (2), deepseek/deepseek-v4.1-flash-1017 (2), openai/gpt-6.2-astra (1), anthropic/claude-opus-5.5 (1) |
| Link logic | openai/gpt-6.2-sol (8), google/gemini-4-hydrogen (4), anthropic/claude-sonnet-5.5 (4), google/gemini-4-neon (3), anthropic/claude-opus-5.5 (1) |
| Range reasoning | openai/gpt-6.2-sol (7), google/gemini-4-hydrogen (7), anthropic/claude-sonnet-5.5 (4), openai/gpt-6.2-astra (1), google/gemini-4-neon (1) |
| Trial and error | google/gemini-4-hydrogen (9), openai/gpt-6.2-sol (5), anthropic/claude-sonnet-5.5 (2), google/gemini-4-neon (2), openai/gpt-6.2-astra (1), anthropic/claude-opus-5.5 (1) |
| Deep search | google/gemini-4-hydrogen (10), anthropic/claude-sonnet-5.5 (4), google/gemini-4-neon (4), openai/gpt-6.2-sol (1), openai/gpt-6.2-astra (1) |
