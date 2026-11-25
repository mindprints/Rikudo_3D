#!/usr/bin/env node
/*
 * Generate a pack of 3D Rikudo puzzles, each verified to have exactly one solution.
 *
 * Cube (54 tiles):
 *   node generate.js                          # 40 puzzles, beginner -> expert ramp -> puzzles.js + puzzles.json
 *   node generate.js -n 20 -d hard            # 20 hard cube puzzles
 *
 * Sphere (Goldberg polyhedra, 42 / 72 / 92 cells):
 *   node generate.js --board sphere                          # 36 mixed sphere puzzles -> puzzles-sphere.js/json
 *   node generate.js --board sphere --size 72 -d hard -n 10
 *   node generate.js --board sphere --size 72 --holes        # pentagons blocked -> numbers 1-60
 *
 * Pyramid (tetrahedron tiled with triangles, 36 / 64 / 100 cells, 3 neighbours each):
 *   node generate.js --board pyramid                         # -> puzzles-pyramid.js/json
 *   node generate.js --board pyramid --size 64 -d expert -n 10
 *
 * Options
 *   -b, --board <b>        cube | sphere | pyramid (default cube)
 *   -n, --count <n>        number of puzzles (default 40 cube, 36 sphere)
 *   -d, --difficulty <d>   beginner | easy | medium | hard | expert | mixed (default mixed)
 *       --size <s>         sphere: 42 | 72 | 92, pyramid: 36 | 64 | 100, or mixed (default mixed)
 *       --holes            sphere only: block the 12 pentagons
 *       --mixed-holes      alternate blocked on/off
 *   -s, --seed <n>         base seed for a reproducible pack (default: random)
 *   -o, --out <name>       output basename (default "puzzles" / "puzzles-sphere")
 *
 * index.html loads puzzles.js, puzzles-sphere.js and puzzles-pyramid.js automatically
 * (it works when opened straight from disk).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./rikudo-core.js');

function parseArgs(argv) {
  const o = { board: 'cube', count: null, difficulty: 'mixed', size: 'mixed', holes: false, mixedHoles: false, seed: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '-b' || a === '--board') { o.board = v; i++; }
    else if (a === '-n' || a === '--count') { o.count = parseInt(v, 10); i++; }
    else if (a === '-d' || a === '--difficulty') { o.difficulty = v; i++; }
    else if (a === '--size') { o.size = v; i++; }
    else if (a === '--holes') o.holes = true;
    else if (a === '--mixed-holes') o.mixedHoles = true;
    else if (a === '-s' || a === '--seed') { o.seed = parseInt(v, 10); i++; }
    else if (a === '-o' || a === '--out') { o.out = v; i++; }
    else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(0); }
    else { console.error('Unknown option: ' + a); process.exit(1); }
  }
  const fail = (m) => { console.error(m); process.exit(1); };
  if (!['cube', 'sphere', 'pyramid'].includes(o.board)) fail('board must be cube, sphere or pyramid');
  if (!['beginner', 'easy', 'medium', 'hard', 'expert', 'mixed'].includes(o.difficulty)) fail('difficulty must be beginner, easy, medium, hard, expert or mixed');
  const okSizes = o.board === 'pyramid' ? ['36', '64', '100', 'mixed'] : ['42', '72', '92', 'mixed'];
  if (o.board !== 'cube' && !okSizes.includes(String(o.size))) fail('size must be one of ' + okSizes.join(', '));
  if (o.count == null) o.count = o.board === 'cube' ? 40 : 36;
  if (!(o.count > 0)) fail('count must be a positive number');
  if (o.out == null) o.out = o.board === 'cube' ? 'puzzles' : 'puzzles-' + o.board;
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const baseSeed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9);
const rng = C.mulberry32(baseSeed);
const LEVELS = ['beginner', 'easy', 'medium', 'hard', 'expert'];
const SIZES = opts.board === 'pyramid' ? [36, 64, 100] : [42, 72, 92];

const pack = [];
const seen = new Set();
const t0 = Date.now();
while (pack.length < opts.count) {
  const k = pack.length, frac = k / opts.count;
  const difficulty = opts.difficulty === 'mixed' ? LEVELS[Math.min(4, Math.floor(frac * 5))] : opts.difficulty;
  const seed = Math.floor(rng() * 2 ** 32) >>> 0;
  const board = opts.board === 'cube' ? { type: 'cube' } : {
    type: opts.board,
    size: opts.size === 'mixed' ? SIZES[k % 3] : +opts.size,
    holes: opts.mixedHoles ? k % 2 === 1 : opts.holes,
  };
  const p = C.generatePuzzle({ seed, difficulty, board });
  const eng = C.boardFor(p.board).engine;
  if (seen.has(p.id)) continue;

  // Independent full check (no node budget): exactly one solution, and it is the stored one.
  const r = eng.countSolutions(p, { limit: 2 });
  if (r.count !== 1 || r.solution.some((v, i) => v !== p.solution[i])) {
    console.warn(`  skipped ${p.id}: not unique`);
    continue;
  }
  seen.add(p.id);
  pack.push(p);
  const tag = p.board.type === 'cube' ? 'cube' : `${p.board.size}${p.board.holes ? 'h' : ' '}`;
  console.log(`  ${String(pack.length).padStart(3)}/${opts.count}  ${tag.padEnd(4)} ${p.difficulty.padEnd(8)} givens=${String(p.givens).padStart(2)} chutes=${p.chutes.length}`);
}

const outBase = path.resolve(process.cwd(), opts.out);
const globalName = { cube: 'RIKUDO_PUZZLES', sphere: 'RIKUDO_SPHERE_PUZZLES', pyramid: 'RIKUDO_PYRAMID_PUZZLES' }[opts.board];
fs.writeFileSync(outBase + '.json', JSON.stringify(pack, null, 1));
fs.writeFileSync(outBase + '.js',
  `// Generated by generate.js — ${pack.length} ${opts.board} puzzles, base seed ${baseSeed}, ${new Date().toISOString()}\n` +
  `window.${globalName} = ${JSON.stringify(pack)};\n`);
console.log(`Wrote ${path.basename(outBase)}.js and ${path.basename(outBase)}.json in ${((Date.now() - t0) / 1000).toFixed(1)}s (base seed ${baseSeed}).`);
