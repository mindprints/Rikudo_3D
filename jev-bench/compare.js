#!/usr/bin/env node
/**
 * Put every run side by side: all results*.jsonl in this folder → compare.md (and printed).
 *   node compare.js
 * Rows: each run, plus the "next to X±1" shortcut and chance, on the same items.
 * Accuracy is over the items each run answered; runs on a subset (--per) are marked with their n.
 */
const fs = require('fs'), path = require('path');
const dir = __dirname;
const TIERS = ['', 'Next in line', 'Link logic', 'Range reasoning', 'Trial and error', 'Deep search'];
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const pc = (x) => (Number.isFinite(x) ? (100 * x).toFixed(0) + '%' : '–');
const load = (f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// items (plain and local share ids, answers and options)
const items = {};
for (const f of ['items.jsonl', 'items-local.jsonl']) if (fs.existsSync(path.join(dir, f))) for (const it of load(f)) items[it.id] = items[it.id] || it;

// the shortcut and chance, per item
const parse = (it) => { const val = {}, nb = {};
  for (const line of it.state.split('\n')) { const m = line.match(/^(c\d+): (\d+|empty); neighbours ([^;]+)/); if (!m) continue;
    val[m[1]] = m[2] === 'empty' ? 0 : +m[2]; nb[m[1]] = m[3].replace(/\([^)]*\)/g, '').trim().split(/\s+/); }
  const pos = {}; for (const c in val) if (val[c]) pos[val[c]] = c; return { val, nb, pos }; };
const shortcut = {};
for (const it of Object.values(items)) { const g = parse(it), adj = new Set();
  for (const k of [it.number - 1, it.number + 1]) if (g.pos[k]) g.nb[g.pos[k]].forEach((c) => { if (!g.val[c]) adj.add(c); });
  shortcut[it.id] = adj.has(it.answer) ? 1 / adj.size : 0; }

const runs = fs.readdirSync(dir).filter((f) => /^results.*\.jsonl$/.test(f)).sort().map((f) => {
  const R = load(f), r0 = R[0] || {};
  const enc = /local/.test(f) ? 'contents shown' : 'plain';
  const label = r0.effort ? `${r0.model} (${r0.effort}, ${enc})` : `${r0.model || f} (${enc})`;
  return { f, label, R };
}).filter(({ R }) => R.length); // skip runs that haven't answered anything yet
const L = ['# Rikudo³: one-pass decisions vs reasoning', '',
  'Accuracy on "Which empty cell must hold the number X?", by the technique the move needs. Full runs share the same 589 items; a partial run is compared on its own questions further down.', '',
  '| Run | n | ' + TIERS.slice(1).join(' | ') + ' | All | Cost |', '|---|---|' + '---|'.repeat(7)];
for (const { label, R } of runs) {
  const row = [label, R.length];
  for (let t = 1; t <= 5; t++) row.push(pc(mean(R.filter((r) => r.tier === t).map((r) => +r.correct))));
  row.push(pc(mean(R.map((r) => +r.correct))), '$' + R.reduce((s, r) => s + (r.cost || 0), 0).toFixed(2));
  L.push('| ' + row.join(' | ') + ' |');
}
const ids = Object.keys(items);
const base = (fn) => { const row = []; for (let t = 1; t <= 5; t++) row.push(pc(mean(ids.filter((i) => items[i].tier === t).map(fn)))); return row; };
L.push('| *Shortcut: guess next to X±1* | ' + ids.length + ' | ' + base((i) => shortcut[i]).join(' | ') + ' | ' + pc(mean(ids.map((i) => shortcut[i]))) + ' | |');
L.push('| *Chance* | ' + ids.length + ' | ' + base((i) => items[i].chance).join(' | ') + ' | ' + pc(mean(ids.map((i) => items[i].chance))) + ' | |', '');

// runs that covered only part of the set: compare every run on exactly those questions,
// limited to the boards the partial run covered fully (so a few stray items don't skew it)
const full = ids.length;
for (const part of runs.filter(({ R }) => R.length < full)) {
  const perBoard = {}; part.R.forEach((r) => { perBoard[r.board] = (perBoard[r.board] || 0) + 1; });
  const most = Math.max(...Object.values(perBoard));
  const boards = Object.keys(perBoard).filter((b) => perBoard[b] >= 0.9 * most);
  const keep = new Set(part.R.filter((r) => boards.includes(r.board)).map((r) => r.id));
  L.push(`## Same questions as ${part.label}`, '', `${keep.size} questions (${boards.join(', ')}). Every run below is scored on exactly these.`, '',
    '| Run | ' + TIERS.slice(1).join(' | ') + ' | All | Cost per question |', '|---|' + '---|'.repeat(7));
  for (const { label, R } of runs) {
    const s = R.filter((r) => keep.has(r.id)); if (s.length < keep.size) continue;
    const row = [label];
    for (let t = 1; t <= 5; t++) { const x = s.filter((r) => r.tier === t); row.push(x.length ? `${pc(mean(x.map((r) => +r.correct)))} (n=${x.length})` : '–'); }
    row.push(pc(mean(s.map((r) => +r.correct))), '$' + (s.reduce((a, r) => a + (r.cost || 0), 0) / s.length).toFixed(4));
    L.push('| ' + row.join(' | ') + ' |');
  }
  const kid = [...keep];
  const brow = (fn) => { const row = []; for (let t = 1; t <= 5; t++) row.push(pc(mean(kid.filter((i) => items[i].tier === t).map(fn)))); return row; };
  L.push('| *Shortcut* | ' + brow((i) => shortcut[i]).join(' | ') + ' | ' + pc(mean(kid.map((i) => shortcut[i]))) + ' | |');
  L.push('| *Chance* | ' + brow((i) => items[i].chance).join(' | ') + ' | ' + pc(mean(kid.map((i) => items[i].chance))) + ' | |', '');
}
// mark partial runs in the main table
const mainEnd = L.findIndex((l) => l.startsWith('## '));
for (let i = 0; i < mainEnd; i++) for (const { label, R } of runs) if (R.length < full && L[i].startsWith('| ' + label + ' |')) L[i] = L[i].replace('| ' + label + ' |', '| ' + label + ' — partial, see below |');

const thinking = runs.filter(({ R }) => R.some((r) => r.reasoningTokens != null));
if (thinking.length) {
  L.push('## How much thinking each move took', '', 'Mean reasoning tokens per item (right answers / wrong answers).', '',
    '| Run | ' + TIERS.slice(1).join(' | ') + ' |', '|---|' + '---|'.repeat(5));
  for (const { label, R } of thinking) {
    const row = [label];
    for (let t = 1; t <= 5; t++) { const s = R.filter((r) => r.tier === t && r.reasoningTokens != null);
      const a = mean(s.filter((r) => r.correct).map((r) => r.reasoningTokens)), b = mean(s.filter((r) => !r.correct).map((r) => r.reasoningTokens));
      row.push(s.length ? `${Number.isFinite(a) ? Math.round(a) : '–'} / ${Number.isFinite(b) ? Math.round(b) : '–'}` : '–'); }
    L.push('| ' + row.join(' | ') + ' |');
  }
  L.push('');
  L.push('## Wrong answer, or no answer?', '', 'A reasoning model can fail two ways: answer wrongly, or run out of thinking before it answers (no valid answer, counted as wrong above).', '',
    '| Run | ' + TIERS.slice(1).map((t) => t + ': answered / right when answered').join(' | ') + ' |', '|---|' + '---|'.repeat(5));
  for (const { label, R } of thinking) {
    const row = [label];
    for (let t = 1; t <= 5; t++) { const s = R.filter((r) => r.tier === t), a = s.filter((r) => r.valid);
      row.push(s.length ? `${pc(a.length / s.length)} / ${pc(a.filter((r) => r.correct).length / a.length)}` : '–'); }
    L.push('| ' + row.join(' | ') + ' |');
    const given = R.filter((r) => r.valid), wrong = given.filter((r) => !r.correct).length;
    L.push(`|  | ${given.length} answers given, ${wrong} wrong; ${R.length - given.length} with no answer (${R.filter((r) => r.finish === 'length').length} hit the token limit) | | | | |`);
  }
  L.push('');
}

for (const { label, R } of runs.filter(({ R }) => R.some((r) => /jev-router/.test(r.model || '')))) {
  L.push(`## Where Jev Router sent each move: ${label}`, '', '| Tier | Models chosen (count) |', '|---|---|');
  for (let t = 1; t <= 5; t++) { const c = {}; R.filter((r) => r.tier === t).forEach((r) => { c[r.servedBy] = (c[r.servedBy] || 0) + 1; });
    L.push(`| ${TIERS[t]} | ${Object.entries(c).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} (${n})`).join(', ') || '–'} |`); }
  L.push('');
}
fs.writeFileSync(path.join(dir, 'compare.md'), L.join('\n'));
console.log(L.join('\n'));
console.log('→ compare.md');
