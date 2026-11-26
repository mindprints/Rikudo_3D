#!/usr/bin/env node
/**
 * Summarise results.jsonl → report.md (and print it).
 *   node analyze.js [-i results.jsonl] [--items items.jsonl] [-o report.md]
 * For a run on items-local.jsonl: node analyze.js -i results-local.jsonl   (items and report names follow)
 * Accuracy is compared with chance (1 / number of empty cells). "Lift" = accuracy ÷ chance.
 * Because later moves have fewer empty cells, tiers are also compared within option-count bands.
 * Confidence AUROC: how well Jev's confidence separates its right answers from its wrong ones (0.5 = not at all).
 */
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const IN = arg('-i', path.join(__dirname, 'results.jsonl'));
const SUFFIX = (path.basename(IN).match(/^results(.*)\.jsonl$/) || [, ''])[1]; // results-local.jsonl → "-local"
const ITEMS = arg('--items', path.join(__dirname, `items${SUFFIX}.jsonl`));
const OUT = arg('-o', path.join(__dirname, `report${SUFFIX}.md`));
const R = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (!R.length) { console.error('No results yet.'); process.exit(1); }

const TIERS = ['', 'Next in line', 'Link logic', 'Range reasoning', 'Trial and error', 'Deep search'];
const BOARDS = ['cube', 'sphere', 'pyramid'];
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const pc = (x) => (Number.isFinite(x) ? (100 * x).toFixed(0) + '%' : '–');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');
// Wilson 95% interval for a proportion
const wilson = (k, n) => { if (!n) return [NaN, NaN]; const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return [c - h, c + h]; };
const auroc = (rows) => { const pos = rows.filter((r) => r.correct && r.confidence != null).map((r) => r.confidence),
  neg = rows.filter((r) => !r.correct && r.confidence != null).map((r) => r.confidence);
  if (!pos.length || !neg.length) return NaN; let s = 0; for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0; return s / (pos.length * neg.length); };
const cellOf = (rows) => { const k = rows.filter((r) => r.correct).length, n = rows.length, [lo, hi] = wilson(k, n);
  return { n, acc: n ? k / n : NaN, lo, hi, chance: mean(rows.map((r) => r.chance)), lift: n ? (k / n) / mean(rows.map((r) => r.chance)) : NaN,
    pCorrect: mean(rows.filter((r) => r.pCorrect != null).map((r) => r.pCorrect)), opts: mean(rows.map((r) => r.options)) }; };

const L = [];
const model = [...new Set(R.map((r) => r.model))].join(', ');
L.push(`# Jev on Rikudo³: accuracy by technique tier`, '', `Model: ${model} · ${R.length} answered items · cost $${R.reduce((s, r) => s + (r.cost || 0), 0).toFixed(4)}`, '');
L.push('Each item asks "Which empty cell must hold the number X?" at a real moment in a solve; the options are every empty cell.', '');

L.push('## Accuracy by tier (all boards)', '', '| Tier | n | Accuracy (95% CI) | Chance | Lift | P(correct cell) | Avg options |', '|---|---|---|---|---|---|---|');
for (let t = 1; t <= 5; t++) { const c = cellOf(R.filter((r) => r.tier === t)); if (!c.n) continue;
  L.push(`| ${t}. ${TIERS[t]} | ${c.n} | ${pc(c.acc)} (${pc(c.lo)}–${pc(c.hi)}) | ${pc(c.chance)} | ${f2(c.lift)}× | ${pc(c.pCorrect)} | ${c.opts.toFixed(1)} |`); }
L.push('');

L.push('## Accuracy by board and tier', '', '| Board | ' + TIERS.slice(1).join(' | ') + ' |', '|---|' + '---|'.repeat(5));
for (const b of BOARDS) { const row = [b];
  for (let t = 1; t <= 5; t++) { const c = cellOf(R.filter((r) => r.board === b && r.tier === t)); row.push(c.n ? `${pc(c.acc)} (n=${c.n}, chance ${pc(c.chance)})` : '–'); }
  L.push('| ' + row.join(' | ') + ' |'); }
L.push('');

L.push('## Same number of options, different tier', '', 'Later moves have fewer empty cells and so a higher chance rate. Within each band the comparison between tiers is fair.', '',
  '| Options | ' + TIERS.slice(1).join(' | ') + ' |', '|---|' + '---|'.repeat(5));
for (const [lo, hi] of [[2, 8], [9, 20], [21, 40], [41, 99]]) { const row = [`${lo}–${hi}`];
  for (let t = 1; t <= 5; t++) { const c = cellOf(R.filter((r) => r.tier === t && r.options >= lo && r.options <= hi)); row.push(c.n ? `${pc(c.acc)} (n=${c.n})` : '–'); }
  L.push('| ' + row.join(' | ') + ' |'); }
L.push('');

L.push('## Does Jev know when it is wrong?', '', '| Tier | Mean confidence when right | when wrong | AUROC |', '|---|---|---|---|');
for (let t = 1; t <= 5; t++) { const rows = R.filter((r) => r.tier === t); if (!rows.length) continue;
  L.push(`| ${TIERS[t]} | ${f2(mean(rows.filter((r) => r.correct && r.confidence != null).map((r) => r.confidence)))} | ${f2(mean(rows.filter((r) => !r.correct && r.confidence != null).map((r) => r.confidence)))} | ${f2(auroc(rows))} |`); }
L.push(`| All | | | ${f2(auroc(R))} |`, '');

// ---- shortcut baselines: is Jev reasoning, or just looking near X−1 and X+1?
if (fs.existsSync(ITEMS)) {
  const items = Object.fromEntries(fs.readFileSync(ITEMS, 'utf8').split('\n').filter(Boolean).map((l) => { const d = JSON.parse(l); return [d.id, d]; }));
  const parse = (it) => { const val = {}, nb = {};
    for (const line of it.state.split('\n')) { const m = line.match(/^(c\d+): (\d+|empty); neighbours ([^;]+)/); if (!m) continue;
      val[m[1]] = m[2] === 'empty' ? 0 : +m[2]; nb[m[1]] = m[3].replace(/\([^)]*\)/g, '').trim().split(/\s+/); }
    const pos = {}; for (const c in val) if (val[c]) pos[val[c]] = c; return { val, nb, pos }; };
  const B = R.filter((r) => items[r.id]).map((r) => { const it = items[r.id], g = parse(it), X = it.number, adj = new Set();
    for (const k of [X - 1, X + 1]) if (g.pos[k]) g.nb[g.pos[k]].forEach((c) => { if (!g.val[c]) adj.add(c); });
    return { tier: r.tier, ok: r.correct, ansAdj: adj.has(it.answer), jevAdj: adj.has(r.choice), guess: adj.has(it.answer) ? 1 / adj.size : 0 }; });
  L.push('## Reasoning or a shortcut?', '', 'Shortcut: guess at random among the empty cells next to X−1 or X+1 (whichever are placed). If Jev were using the tier\'s technique it would beat this; if it only looks near the neighbouring numbers it would match it.', '',
    '| Tier | Jev | Shortcut | Answer next to X±1 | Jev\'s pick next to X±1 |', '|---|---|---|---|---|');
  for (let t = 1; t <= 5; t++) { const s = B.filter((b) => b.tier === t); if (!s.length) continue;
    L.push(`| ${TIERS[t]} | ${pc(mean(s.map((b) => +b.ok)))} | ${pc(mean(s.map((b) => b.guess)))} | ${pc(mean(s.map((b) => +b.ansAdj)))} | ${pc(mean(s.map((b) => +b.jevAdj)))} |`); }
  L.push(`| All | ${pc(mean(B.map((b) => +b.ok)))} | ${pc(mean(B.map((b) => b.guess)))} | ${pc(mean(B.map((b) => +b.ansAdj)))} | ${pc(mean(B.map((b) => +b.jevAdj)))} |`, '');
  const far = B.filter((b) => !b.ansAdj);
  if (far.length) L.push(`When the answer is not next to X−1 or X+1 (${far.length} items): Jev ${pc(mean(far.map((b) => +b.ok)))} correct.`, '');
}

fs.writeFileSync(OUT, L.join('\n'));
console.log(L.join('\n'));
console.log(`\n→ ${OUT}`);
