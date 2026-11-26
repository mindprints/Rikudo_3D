#!/usr/bin/env node
/**
 * Build benchmark items: "Where must number X go?" asked at real moments of real solves.
 *
 * The rating solver replays each pack puzzle the way a person would (simplest technique first)
 * and logs every placement with the technique tier it needed:
 *   1 next in line · 2 link logic · 3 range reasoning · 4 trial and error · 5 deep search
 * Each placement becomes one item: the board just before it, the number X, and the one correct cell.
 * The options are EVERY empty cell, so the option list gives nothing away; chance = 1 / options.
 * Cell names are reshuffled for each item.
 *
 *   node make-items.js [--per 40] [--seed 7] [--encoding plain|local] [-o items.jsonl]
 * --per: items per board × tier (fewer where the packs don't have that many)
 * --encoding plain: neighbours by name only (finding an empty neighbour means looking up other lines)
 *            local: each neighbour's contents written inline, e.g. "c05 (empty) c09 (18)", so the
 *                   simplest moves become a single-line decision. Same items, same order, same names.
 */
const fs = require('fs'), path = require('path');
const C = require('../rikudo-core.js');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PER = +arg('--per', 40), ENC = arg('--encoding', 'plain');
const OUT = arg('-o', path.join(__dirname, ENC === 'local' ? 'items-local.jsonl' : 'items.jsonl'));
let seed = +arg('--seed', 7) >>> 0;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const PACKS = { cube: 'puzzles.json', sphere: 'puzzles-sphere.json', pyramid: 'puzzles-pyramid.json' };
const TIERS = ['', 'next in line', 'link logic', 'range reasoning', 'trial and error', 'deep search'];
const BOARD_TEXT = {
  cube: (N) => `a cube board with ${N} cells (square cells, 9 on each face; neighbours continue over the cube's edges)`,
  sphere: (N) => `a sphere board with ${N} cells (hexagons and pentagons)`,
  pyramid: (N) => `a pyramid board with ${N} cells (triangles; every cell has 3 neighbours)`,
};

function stateText(type, eng, chutes, vals, name) {
  const N = eng.N, ch = Array.from({ length: N }, () => []);
  for (const [a, b] of chutes) { ch[a].push(b); ch[b].push(a); }
  const order = shuffle([...Array(N).keys()]);
  const lines = order.map((c) => {
    const nb = eng.NEIGH[c].map((w) => [name[w], w]).sort().map(([n, w]) => (ENC === 'local' ? `${n} (${vals[w] || 'empty'})` : n)).join(' ');
    return `${name[c]}: ${vals[c] ? vals[c] : 'empty'}; neighbours ${nb}${ch[c].length ? '; chute to ' + ch[c].map((w) => name[w]).join(' ') : ''}`;
  });
  return [
    `Rikudo puzzle on ${BOARD_TEXT[type](N)}.`,
    `Rules: each number from 1 to ${N} appears exactly once, one per cell. Each number's cell neighbours the cell of the next number, so 1, 2, ..., ${N} form a single path through every cell. A chute joins two neighbouring cells whose numbers are consecutive. The puzzle has exactly one solution.`,
    ENC === 'local' ? `Cells (name: contents; neighbours with their contents; chutes):` : `Cells (name: contents; neighbours; chutes):`,
    ...lines,
  ].join('\n');
}

// 1. log every placement in every pack puzzle
const pool = {}; // pool[type][tier] = [candidate items]
for (const [type, file] of Object.entries(PACKS)) {
  pool[type] = [[], [], [], [], [], []];
  const puzzles = JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  for (const p of puzzles) {
    const eng = C.boardFor(p.board || { type: 'cube' }).engine, trace = [];
    eng.ratePuzzle(p, null, { trace });
    trace.forEach((round, r) => round.placed.forEach(([cell, x]) =>
      pool[type][round.tier].push({ p, eng, before: round.before, cell, x, round: r })));
  }
}

// 2. sample up to PER per board × tier, spread across puzzles, and write the items
const out = fs.createWriteStream(OUT);
const summary = [];
let n = 0;
for (const type of Object.keys(PACKS)) {
  const row = [type];
  for (let t = 1; t <= 5; t++) {
    const cand = shuffle(pool[type][t].slice());
    // round-robin over puzzles so no single puzzle dominates a cell of the table
    const byPuzzle = new Map();
    for (const it of cand) { if (!byPuzzle.has(it.p.id)) byPuzzle.set(it.p.id, []); byPuzzle.get(it.p.id).push(it); }
    const picked = [], lists = [...byPuzzle.values()];
    for (let k = 0; picked.length < PER && lists.some((l) => k < l.length); k++) for (const l of lists) if (k < l.length && picked.length < PER) picked.push(l[k]);
    for (const it of picked) {
      const N = it.eng.N;
      const name = shuffle([...Array(N).keys()].map((i) => 'c' + String(i + 1).padStart(2, '0')));
      const empty = [...Array(N).keys()].filter((c) => !it.before[c]);
      const options = shuffle(empty.map((c) => name[c]));
      const item = {
        id: `${type}-${it.p.id}-r${it.round}-x${it.x}`, encoding: ENC,
        board: type, size: N, puzzle: it.p.id, level: it.p.difficulty, tier: t, tierName: TIERS[t],
        number: it.x, answer: name[it.cell], options, chance: 1 / options.length,
        filled: N - empty.length,
        state: stateText(type, it.eng, it.p.chutes, it.before, name),
        question: `Which empty cell must hold the number ${it.x}?`,
      };
      out.write(JSON.stringify(item) + '\n'); n++;
    }
    row.push(picked.length + '/' + pool[type][t].length);
  }
  summary.push(row);
}
out.end();
console.log(`${n} items → ${OUT}`);
console.log('board     ' + TIERS.slice(1).map((t) => t.padEnd(17)).join(''));
for (const r of summary) console.log(r[0].padEnd(10) + r.slice(1).map((c) => c.padEnd(17)).join(''));
console.log('(picked / available)');
