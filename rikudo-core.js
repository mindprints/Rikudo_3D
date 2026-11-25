/*
 * rikudo-core.js — boards, solver and puzzle generator for 3D Rikudo.
 *
 * Works in the browser (classic <script>, exposes window.RikudoCore) and in
 * Node (require('./rikudo-core.js')). No dependencies.
 *
 * Boards
 *   - Cube:   54 stickers of a 3x3x3 cube, 4 neighbours each (wrapping edges).
 *   - Sphere: Goldberg polyhedra — hexagons plus exactly 12 pentagons.
 *             42 = GP(2,0), 72 = GP(2,1), 92 = GP(3,0). Optional "holes" mode
 *             blocks the 12 pentagons (like Rikudo's blocked centre).
 *
 * The solver/generator only see a neighbour list, so any board works:
 *   const eng = RikudoCore.createEngine(neigh);  eng.generate({...})
 *
 * Puzzle format
 *   { id, seed, difficulty, board, cells:[N ints, 0=blank], chutes:[[a,b]...], solution:[N] }
 *   board: 'cube' | { type:'sphere', size:42|72|92, holes:bool }
 * Cube node id = face*9 + row*3 + col, faces ordered R, L, U, D, F, B.
 */
(function (root, factory) {
  const api = factory();
  // Keep the factory source so pages can spin up a Web Worker even from file://
  api.__source = '(' + factory.toString() + ')()';
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RikudoCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- small vector helpers ----------
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => mul(a, 1 / len(a));
  const dist = (a, b) => len(sub(a, b));

  // ---------- RNG ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // =====================================================================
  // Generic engine: Hamiltonian paths, solution counting, generation
  // =====================================================================
  function createEngine(NEIGH, difficulties) {
    const N = NEIGH.length;
    const ADJ = NEIGH.map((nb) => { const s = new Uint8Array(N); nb.forEach((j) => (s[j] = 1)); return s; });
    const isAdjacent = (a, b) => ADJ[a][b] === 1;
    const DIFF = difficulties || defaultDifficulties(N);

    function randomHamiltonianPath(rng) {
      const visited = new Uint8Array(N);
      const path = [];
      let steps = 0;
      const LIMIT = 200000;
      const freeDeg = (x) => { let c = 0; for (const y of NEIGH[x]) if (!visited[y]) c++; return c; };
      function ok(u) {
        const seen = new Uint8Array(N), q = [u];
        seen[u] = 1;
        let reached = 0;
        while (q.length) {
          const x = q.pop();
          for (const y of NEIGH[x]) if (!visited[y] && !seen[y]) { seen[y] = 1; reached++; q.push(y); }
        }
        if (reached !== N - path.length) return false;
        let ends = 0;
        for (let w = 0; w < N; w++) {
          if (visited[w]) continue;
          let f = 0;
          for (const y of NEIGH[w]) if (!visited[y] || y === u) f++;
          if (f < 2 && ++ends > 1) return false;
        }
        return true;
      }
      function dfs(u) {
        if (path.length === N) return true;
        if (++steps > LIMIT) return false;
        if (!ok(u)) return false;
        const keyed = NEIGH[u].filter((v) => !visited[v])
          .map((v) => [freeDeg(v) + rng() * 1.5, v]).sort((a, b) => a[0] - b[0]);
        for (const [, v] of keyed) {
          visited[v] = 1; path.push(v);
          if (dfs(v)) return true;
          visited[v] = 0; path.pop();
          if (steps > LIMIT) return false;
        }
        return false;
      }
      for (let attempt = 0; attempt < 80; attempt++) {
        visited.fill(0); path.length = 0; steps = 0;
        const s = Math.floor(rng() * N);
        visited[s] = 1; path.push(s);
        if (dfs(s)) return path.slice();
      }
      throw new Error('could not build a Hamiltonian path');
    }

    /** Count solutions (stops at `limit`). Returns { count, aborted, solution, nodes }. */
    function countSolutions(puzzle, opts) {
      const limit = (opts && opts.limit) || 2;
      const budget = (opts && opts.budget) || Infinity;
      const none = { count: 0, aborted: false, solution: null, nodes: 0 };
      const val = puzzle.cells;
      const posOf = new Int16Array(N + 2).fill(-1);
      for (let i = 0; i < N; i++) if (val[i] > 0) {
        if (posOf[val[i]] >= 0) return none;
        posOf[val[i]] = i;
      }
      const chuteAdj = Array.from({ length: N }, () => []);
      for (const [a, b] of puzzle.chutes || []) { chuteAdj[a].push(b); chuteAdj[b].push(a); }
      for (let i = 0; i < N; i++) if (chuteAdj[i].length > 2) return none;
      for (const [a, b] of puzzle.chutes || []) {
        if (!isAdjacent(a, b)) return none;
        if (val[a] && val[b] && Math.abs(val[a] - val[b]) !== 1) return none;
      }
      for (let g = 1; g < N; g++)
        if (posOf[g] >= 0 && posOf[g + 1] >= 0 && !isAdjacent(posOf[g], posOf[g + 1])) return none;
      const givenVals = [];
      for (let g = 1; g <= N; g++) if (posOf[g] >= 0) givenVals.push(g);

      const visited = new Uint8Array(N);
      const assign = new Int16Array(N);
      const dst = new Int16Array(N);
      const queue = new Int16Array(N);
      let nodes = 0, count = 0, aborted = false, solution = null;

      function prune(u, k) {
        dst.fill(-1);
        let qh = 0, qt = 0;
        queue[qt++] = u; dst[u] = 0;
        let reached = 0;
        while (qh < qt) {
          const x = queue[qh++];
          for (const y of NEIGH[x]) if (!visited[y] && dst[y] < 0) { dst[y] = dst[x] + 1; reached++; queue[qt++] = y; }
        }
        if (reached !== N - k) return false;                 // unvisited cells stay connected
        for (const g of givenVals) if (g > k && dst[posOf[g]] > g - k) return false; // givens reachable in time
        let ends = 0;
        const endNode = posOf[N];
        for (let w = 0; w < N; w++) {                        // at most one dead end, and only the end
          if (visited[w]) continue;
          let f = 0;
          for (const y of NEIGH[w]) if (!visited[y] || y === u) f++;
          if (f < 2) {
            if (endNode >= 0 && endNode !== w) return false;
            if (val[w] > 0 && val[w] !== N) return false;
            if (++ends > 1) return false;
          }
        }
        return true;
      }

      function dfs(u, k, p) {
        if (++nodes > budget) { aborted = true; return; }
        let req = -1;                                        // chute partner we must step to next
        for (const w of chuteAdj[u]) {
          if (w === p) continue;
          if (req !== -1) return;
          req = w;
        }
        if (k === N) {
          if (req !== -1) return;
          count++;
          if (!solution) solution = Array.from(assign);
          return;
        }
        if (req !== -1 && visited[req]) return;
        if (!prune(u, k)) return;
        const tgt = posOf[k + 1];
        for (const v of NEIGH[u]) {
          if (visited[v]) continue;
          if (tgt >= 0) { if (v !== tgt) continue; } else if (val[v] > 0) continue;
          if (req !== -1 && v !== req) continue;
          visited[v] = 1; assign[v] = k + 1;
          dfs(v, k + 1, u);
          visited[v] = 0; assign[v] = 0;
          if (aborted || count >= limit) return;
        }
      }

      const starts = posOf[1] >= 0 ? [posOf[1]] : Array.from({ length: N }, (_, i) => i).filter((i) => !val[i]);
      for (const s of starts) {
        visited[s] = 1; assign[s] = 1;
        dfs(s, 1, -1);
        visited[s] = 0; assign[s] = 0;
        if (aborted || count >= limit) break;
      }
      return { count, aborted, solution, nodes };
    }

    // =================================================================
    // Rating: grade a puzzle by the human techniques needed to solve it
    // =================================================================
    // 1 Next in line     - only one free neighbour of k can hold k±1; a chute forces the move
    // 2 Link logic       - every cell uses exactly 2 of its sides (1 for the ends); a cell with
    //                      only 2 usable sides must use both; links then pin down numbers
    // 3 Range reasoning  - where can x go? within reach of the placed numbers on both sides;
    //                      a value with one possible cell, or a cell with one possible value
    // 4 Trial and error  - assume one of 2-4 options, and all but one lead to a contradiction
    // 5 Deep search      - none of the above makes progress (needs deeper guessing)
    const TIER_W = [0, 1, 2, 4, 10, 20];
    const CONTRA = { contradiction: true };
    const ek = (a, b) => (a < b ? a * N + b : b * N + a);
    // Level = the harder of (a) how heavy the average deduction is and (b) how often
    // trial and error / deep search is needed. (b) only grows as solving goes on, so it
    // also serves as an early-exit bound while generating.
    // Levels: 0 beginner, 1 easy, 2 medium, 3 hard, 4 expert.
    // Beginner = nothing a newcomer hasn't been shown: next-in-line moves and chutes,
    // at most a few link-logic steps, no range reasoning, no trial and error.
    const BEGINNER_LINKS = Math.max(2, Math.round(N * 0.04));
    function levelOf(c, final) {
      let floor = 0;
      if (c[3] > 0 || c[2] > BEGINNER_LINKS) floor = 1;
      if (c[4] > 0) floor = 2;
      if (c[4] > 2 || c[5] > 0) floor = 3;
      if (c[5] > Math.max(2, N * 0.04) || c[4] > Math.max(6, N * 0.08)) floor = 4;
      if (!final) return floor;
      const n = c[1] + c[2] + c[3] + c[4] + c[5] || 1;
      const h = (c[1] * TIER_W[1] + c[2] * TIER_W[2] + c[3] * TIER_W[3] + c[4] * TIER_W[4] + c[5] * TIER_W[5]) / n;
      return Math.max(floor, h < 2 ? 0 : h < 2.8 ? 2 : h < 3.8 ? 3 : 4);
    }

    function rate(cells, chutes, solution, opts) {
      opts = opts || {};
      const CH = Array.from({ length: N }, () => []);
      for (const [a, b] of chutes || []) { CH[a].push(b); CH[b].push(a); }

      const newState = (vals) => {
        const v = Int16Array.from(vals), pos = new Int16Array(N + 2).fill(-1);
        for (let i = 0; i < N; i++) if (v[i]) pos[v[i]] = i;
        return { v, pos, forced: new Set(), free: v.reduce((n, x) => n + (x ? 0 : 1), 0) };
      };
      const clone = (st) => ({ v: st.v.slice(), pos: st.pos.slice(), forced: new Set(st.forced), free: st.free });
      function apply(st, list) {
        let n = 0;
        for (const [c, x] of list) {
          if (st.v[c] === x) continue;
          if (st.v[c] || st.pos[x] >= 0) throw CONTRA;
          st.v[c] = x; st.pos[x] = c; st.free--; n++;
          for (const y of [x - 1, x + 1]) if (y >= 1 && y <= N && st.pos[y] >= 0 && !isAdjacent(c, st.pos[y])) throw CONTRA;
          for (const w of CH[c]) if (st.v[w] && Math.abs(st.v[w] - x) !== 1) throw CONTRA;
        }
        return n;
      }

      function tier1(st) {
        const out = [], { v, pos } = st;
        for (let k = 1; k <= N; k++) {
          const u = pos[k];
          if (u < 0) continue;
          for (const d of [1, -1]) {
            const x = k + d;
            if (x < 1 || x > N || pos[x] >= 0) continue;
            let cand = NEIGH[u].filter((w) => !v[w]);
            const other = k - d;
            const chFree = CH[u].filter((w) => !v[w]);
            if (chFree.length && (other < 1 || other > N || pos[other] >= 0)) cand = chFree;
            if (!cand.length) throw CONTRA;
            if (cand.length === 1) out.push([cand[0], x]);
          }
        }
        return out;
      }

      // link logic: forced / dead sides
      function links(st) {
        const { v, pos, forced } = st;
        for (let k = 1; k < N; k++) if (pos[k] >= 0 && pos[k + 1] >= 0) {
          if (!isAdjacent(pos[k], pos[k + 1])) throw CONTRA;
          forced.add(ek(pos[k], pos[k + 1]));
        }
        for (let a = 0; a < N; a++) for (const b of CH[a]) forced.add(ek(a, b));
        const dead = new Set();
        const isDead = (c, w) => {
          const a = v[c], b = v[w];
          if (a && b) return Math.abs(a - b) !== 1;
          const k = a || b;
          if (!k) return false;
          return (k - 1 < 1 || pos[k - 1] >= 0) && (k + 1 > N || pos[k + 1] >= 0);
        };
        let changed = true;
        while (changed) {
          changed = false;
          for (let c = 0; c < N; c++) {
            const cap = v[c] === 1 || v[c] === N ? 1 : 2;
            let nf = 0; const avail = [];
            for (const w of NEIGH[c]) {
              const key = ek(c, w);
              if (forced.has(key)) { nf++; continue; }
              if (dead.has(key)) continue;
              if (isDead(c, w)) { dead.add(key); continue; }
              avail.push(w);
            }
            if (nf > cap || nf + avail.length < cap) throw CONTRA;
            if (!avail.length) continue;
            if (nf === cap) { avail.forEach((w) => dead.add(ek(c, w))); changed = true; }
            else if (nf + avail.length === cap) { avail.forEach((w) => forced.add(ek(c, w))); changed = true; }
          }
        }
        return dead;
      }
      function tier2(st) {
        const dead = links(st), out = [], { v, pos, forced } = st;
        for (let c = 0; c < N; c++) {
          if (v[c]) continue;
          let opts2 = null;
          for (const w of NEIGH[c]) {
            if (!v[w] || !forced.has(ek(c, w))) continue;
            const k = v[w];
            const o = [k - 1, k + 1].filter((x) => x >= 1 && x <= N && pos[x] < 0);
            opts2 = opts2 ? opts2.filter((x) => o.includes(x)) : o;
          }
          if (opts2 && !opts2.length) throw CONTRA;
          if (opts2 && opts2.length === 1) out.push([c, opts2[0]]);
        }
        // next-in-line again, now ignoring dead sides
        for (let k = 1; k <= N; k++) {
          const u = pos[k];
          if (u < 0) continue;
          for (const d of [1, -1]) {
            const x = k + d;
            if (x < 1 || x > N || pos[x] >= 0) continue;
            const cand = NEIGH[u].filter((w) => !v[w] && !dead.has(ek(u, w)));
            if (!cand.length) throw CONTRA;
            if (cand.length === 1) out.push([cand[0], x]);
          }
        }
        return out;
      }

      function candidates(st, dead) {
        const { v, pos } = st, cand = new Map();
        const bfs = (src) => {
          const d = new Int16Array(N).fill(9999), q = [src];
          d[src] = 0;
          for (let h = 0; h < q.length; h++) {
            const a = q[h];
            for (const b of NEIGH[a]) if (!v[b] && d[b] === 9999 && !dead.has(ek(a, b))) { d[b] = d[a] + 1; q.push(b); }
          }
          return d;
        };
        let lo = -1;
        for (let k = 1; k <= N; k++) {
          if (pos[k] < 0) continue;
          if (lo > 0 && k - lo > 1) {
            const dl = bfs(pos[lo]), dh = bfs(pos[k]);
            for (let x = lo + 1; x < k; x++) {
              const list = [];
              for (let c = 0; c < N; c++) if (!v[c] && dl[c] <= x - lo && dh[c] <= k - x) list.push(c);
              if (!list.length) throw CONTRA;
              cand.set(x, list);
            }
          }
          lo = k;
        }
        return cand;
      }
      function tier3(st) {
        const dead = links(st), cand = candidates(st, dead), out = [];
        const byCell = new Map();
        for (const [x, list] of cand) {
          if (list.length === 1) out.push([list[0], x]);
          for (const c of list) { if (!byCell.has(c)) byCell.set(c, []); byCell.get(c).push(x); }
        }
        for (let c = 0; c < N; c++) {
          if (st.v[c]) continue;
          const xs = byCell.get(c);
          if (!xs) throw CONTRA;
          if (xs.length === 1) out.push([c, xs[0]]);
        }
        return out;
      }
      function settle(st) {
        for (;;) {
          if (!st.free) return;
          let out = tier1(st);
          if (!out.length) out = tier2(st);
          if (!out.length) out = tier3(st);
          if (!out.length || !apply(st, out)) return;
        }
      }
      function tier4(st) {
        const dead = links(st);
        const list = [...candidates(st, dead).entries()].filter(([, cs]) => cs.length >= 2 && cs.length <= 4)
          .sort((a, b) => a[1].length - b[1].length).slice(0, 8);
        for (const [x, cs] of list) {
          const ok = cs.filter((c) => {
            const t = clone(st);
            try { apply(t, [[c, x]]); settle(t); return true; } catch (e) { if (e !== CONTRA) throw e; return false; }
          });
          if (!ok.length) throw CONTRA;
          if (ok.length === 1) return [[ok[0], x]];
        }
        return [];
      }

      const st = newState(cells);
      const counts = [0, 0, 0, 0, 0, 0];
      let score = 0, maxTier = 0;
      const tiers = [tier1, tier2, tier3, tier4];
      try {
        while (st.free > 0) {
          let n = 0, tier = 0;
          for (let t = 0; t < 4 && !n; t++) {
            const out = tiers[t](st);
            if (out.length) { n = apply(st, out); tier = t + 1; }
          }
          if (!n) {
            // deep search: reveal one value from the solution (lowest unplaced) and carry on
            let x = 1; while (st.pos[x] >= 0) x++;
            n = apply(st, [[solution.indexOf(x), x]]); tier = 5;
          }
          counts[tier] += n; score += TIER_W[tier] * n; maxTier = Math.max(maxTier, tier);
          if (opts.stopAbove != null && levelOf(counts, false) > opts.stopAbove) return { over: true, level: levelOf(counts, false) };
        }
      } catch (e) {
        if (e === CONTRA) return { error: 'contradiction' };
        throw e;
      }
      const level = levelOf(counts, true);
      if (opts.stopAbove != null && level > opts.stopAbove) return { over: true, level };
      return { score, counts, maxTier, level };
    }

    /**
     * Generate a puzzle with exactly one solution, aiming for a rated difficulty level.
     * 1 and N are always given. The puzzle is labelled with its ACTUAL rated level.
     * opts: { seed, difficulty, budget, timeBudget, onProgress }
     */
    const LEVELS = ['beginner', 'easy', 'medium', 'hard', 'expert'];
    function generate(opts) {
      opts = opts || {};
      const requested = DIFF[opts.difficulty] ? opts.difficulty : 'medium';
      const target = LEVELS.indexOf(requested);
      const cfg = opts.config || DIFF[requested];
      const baseSeed = opts.seed != null ? opts.seed >>> 0 : Math.floor(Math.random() * 2 ** 32) >>> 0;
      const budget = opts.budget || cfg.budget || 150000;
      const timeBudget = opts.timeBudget || [2500, 2500, 4000, 7000, 10000][target];
      const t0 = Date.now();
      const progress = (f) => opts.onProgress && opts.onProgress(Math.min(0.99, Math.max(f, (Date.now() - t0) / timeBudget)));
      const unique = (cand) => { const r = countSolutions(cand, { limit: 2, budget }); return !r.aborted && r.count === 1; };

      function candidate(seed) {
        const rng = mulberry32(seed);
        const path = randomHamiltonianPath(rng);
        const solution = new Array(N).fill(0);
        path.forEach((node, idx) => (solution[node] = idx + 1));
        let chutes = [];
        const used = new Uint8Array(N);
        for (const i of shuffle(Array.from({ length: N - 1 }, (_, i) => i), rng)) {
          if (chutes.length >= cfg.chutes) break;
          const a = path[i], b = path[i + 1];
          if (used[a] || used[b]) continue;
          used[a] = used[b] = 1;
          chutes.push([a, b]);
        }
        const cells = solution.slice();
        const order = shuffle(Array.from({ length: N }, (_, i) => i).filter((i) => solution[i] !== 1 && solution[i] !== N), rng);
        order.forEach((node, idx) => {
          const keep = cells[node];
          cells[node] = 0;
          if (!unique({ cells, chutes })) cells[node] = keep;
          // below Expert: never let the puzzle get harder than the requested level
          else if (target < 4 && rate(cells, chutes, solution, { stopAbove: target }).over) cells[node] = keep;
          progress(0);
        });
        if (cfg.pruneChutes) {
          for (const c of shuffle(chutes.slice(), rng)) {
            const trial = chutes.filter((x) => x !== c);
            if (trial.length >= 2 && unique({ cells, chutes: trial })) chutes = trial;
          }
        }
        return { seed, cells, chutes, solution, rating: rate(cells, chutes, solution) };
      }

      let best = null;
      const gap = (c) => Math.abs(c.rating.level - target);
      for (let attempt = 0; attempt < 500; attempt++) {
        const c = candidate((baseSeed + attempt * 0x9e3779b1) >>> 0);
        if (!best || gap(c) < gap(best) || (gap(c) === gap(best) && (target >= 3) === (c.rating.score > best.rating.score))) best = c;
        if (gap(best) === 0 || Date.now() - t0 > timeBudget) break;
      }
      const level = LEVELS[best.rating.level];
      return {
        id: (opts.idPrefix || '') + level + '-' + best.seed.toString(36),
        seed: best.seed, difficulty: level, requested,
        givens: best.cells.filter((x) => x > 0).length,
        cells: best.cells, chutes: best.chutes, solution: best.solution,
        rating: { score: best.rating.score, counts: best.rating.counts, level },
      };
    }

    /** Rate an existing puzzle (or a partly solved state). */
    function ratePuzzle(p, cells) {
      const r = rate(cells || p.cells, p.chutes, p.solution);
      return r.error ? r : { score: r.score, counts: r.counts, level: LEVELS[r.level] };
    }

    /**
     * Rule conflicts on a partial board, with reasons.
     * Returns [{ kind: 'duplicate'|'gap'|'boxed'|'chute', nodes:[...], msg }]
     */
    function explainConflicts(values, chutes) {
      const out = [];
      const posOf = new Map();
      for (let i = 0; i < N; i++) {
        const v = values[i];
        if (!v) continue;
        if (posOf.has(v)) out.push({ kind: 'duplicate', nodes: [posOf.get(v), i], msg: `${v} appears twice.` });
        else posOf.set(v, i);
      }
      for (const [v, i] of posOf) {
        const j = posOf.get(v + 1);
        if (j != null && !isAdjacent(i, j))
          out.push({ kind: 'gap', nodes: [i, j], msg: `${v} and ${v + 1} must touch, but they aren't neighbours.` });
        for (const need of [v - 1, v + 1]) {          // boxed in: no free neighbour can hold v±1
          if (need < 1 || need > N || posOf.has(need)) continue;
          if (NEIGH[i].every((n) => values[n] && values[n] !== need))
            out.push({ kind: 'boxed', nodes: [i], msg: `${v} is boxed in: every neighbour is filled, so there's nowhere for ${need}.` });
        }
      }
      for (const [a, b] of chutes) {
        if (values[a] && values[b] && Math.abs(values[a] - values[b]) !== 1)
          out.push({ kind: 'chute', nodes: [a, b], msg: `Chute: ${Math.min(values[a], values[b])} and ${Math.max(values[a], values[b])} are joined by a chute, so they must be consecutive.` });
      }
      return out;
    }

    /** Rule conflicts on a partial board: returns a Set of bad node ids. */
    function findConflicts(values, chutes) {
      const bad = new Set();
      for (const c of explainConflicts(values, chutes)) c.nodes.forEach((n) => bad.add(n));
      return bad;
    }

    function isSolved(values, chutes) {
      for (let i = 0; i < N; i++) if (!values[i]) return false;
      return findConflicts(values, chutes).size === 0;
    }

    return { N, NEIGH, isAdjacent, randomHamiltonianPath, countSolutions, generate, ratePuzzle, findConflicts, explainConflicts, isSolved, DIFFICULTIES: DIFF };
  }

  // Difficulty presets scaled by board size (tuned for the 5–6 neighbour sphere boards).
  function defaultDifficulties(N) {
    return {
      beginner: { chutes: Math.round(N / 6), targetGivens: Math.round(N * 0.4), budget: 150000 },
      easy:   { chutes: Math.round(N / 7),  targetGivens: Math.round(N * 0.33), budget: 150000 },
      medium: { chutes: Math.round(N / 9),  targetGivens: Math.round(N * 0.25), budget: 150000 },
      hard:   { chutes: Math.round(N / 12), targetGivens: 0, budget: 120000 },
      expert: { chutes: Math.round(N / 12), targetGivens: 0, budget: 120000, pruneChutes: true },
    };
  }

  // =====================================================================
  // Cube board (54 stickers)
  // =====================================================================
  const HALF = 1.5;
  // u x v = n for every face, so (u, v) are "right" and "up" seen from outside.
  const FACES = [
    { name: 'R', n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { name: 'L', n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { name: 'U', n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { name: 'D', n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { name: 'F', n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { name: 'B', n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  const NODES = [];
  FACES.forEach((f, fi) => {
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      const pos = add(add(mul(f.n, HALF), mul(f.u, col - 1)), mul(f.v, 1 - row));
      NODES.push({ id: fi * 9 + row * 3 + col, face: fi, row, col, pos });
    }
  });
  function borderPoint(a, b) {
    const A = NODES[a], B = NODES[b];
    if (A.face === B.face) return mul(add(A.pos, B.pos), 0.5);
    return A.pos.map((x, k) => (Math.abs(x) >= Math.abs(B.pos[k]) ? x : B.pos[k]));
  }
  function sideOf(a, b) {
    const A = NODES[a], f = FACES[A.face];
    const d = sub(borderPoint(a, b), A.pos);
    const du = dot(d, f.u), dv = dot(d, f.v);
    if (Math.abs(du) > Math.abs(dv)) return du > 0 ? 'R' : 'L';
    return dv > 0 ? 'U' : 'D';
  }
  const CUBE_NEIGH = NODES.map((A) =>
    NODES.filter((B) => B.id !== A.id && dist(A.pos, B.pos) < 1.01).map((B) => B.id));
  CUBE_NEIGH.forEach((nb, i) => { if (nb.length !== 4) throw new Error('cube graph broken at ' + i); });

  const CUBE_DIFFICULTIES = {
    beginner: { chutes: 10, targetGivens: 24 },
    easy:   { chutes: 9, targetGivens: 20 },
    medium: { chutes: 7, targetGivens: 13 },
    hard:   { chutes: 5, targetGivens: 0 },
    expert: { chutes: 5, targetGivens: 0, pruneChutes: true },
  };
  const cube = createEngine(CUBE_NEIGH, CUBE_DIFFICULTIES);

  // =====================================================================
  // Sphere boards (Goldberg polyhedra)
  // =====================================================================
  // Brute-force convex hull of points on a sphere (fine for <= ~100 points).
  function hullTriangles(P) {
    const n = P.length, tris = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
      let nrm = cross(sub(P[j], P[i]), sub(P[k], P[i]));
      const d0 = dot(nrm, P[i]);
      let pos = false, neg = false;
      for (let l = 0; l < n && !(pos && neg); l++) {
        if (l === i || l === j || l === k) continue;
        const s = dot(nrm, P[l]) - d0;
        if (s > 1e-9) pos = true; else if (s < -1e-9) neg = true;
      }
      if (pos && neg) continue;
      tris.push(dot(nrm, P[i]) > 0 ? [i, j, k] : [i, k, j]); // outward winding
    }
    return tris;
  }

  /** Goldberg polyhedron GP(m,n): returns { cells:[{center, corners, pent}], neigh } */
  function buildGoldberg(m, n) {
    const phi = (1 + Math.sqrt(5)) / 2;
    const ico = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      ico.push(norm([0, a, b * phi]), norm([a, b * phi, 0]), norm([b * phi, 0, a]));
    }
    const icoFaces = hullTriangles(ico);
    if (icoFaces.length !== 20) throw new Error('icosahedron hull failed');

    // Lattice points of the master triangle 0, v1=(m,n), v2=rot60(v1)=(-n,m+n), in basis e1, e2.
    const e = (i, j) => [i + j / 2, (j * Math.sqrt(3)) / 2];
    const P0 = [0, 0], P1 = e(m, n), P2 = e(-n, m + n);
    const det = (P1[0] - P0[0]) * (P2[1] - P0[1]) - (P2[0] - P0[0]) * (P1[1] - P0[1]);
    const bary = (p) => {
      const l1 = ((p[0] - P0[0]) * (P2[1] - P0[1]) - (P2[0] - P0[0]) * (p[1] - P0[1])) / det;
      const l2 = ((P1[0] - P0[0]) * (p[1] - P0[1]) - (p[0] - P0[0]) * (P1[1] - P0[1])) / det;
      return [1 - l1 - l2, l1, l2];
    };
    const pts = [], keys = new Map();
    const R = m + n + 1;
    for (const [a, b, c] of icoFaces) {
      const A = ico[a], B = ico[b], C = ico[c];
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
        const l = bary(e(i, j));
        if (l[0] < -1e-9 || l[1] < -1e-9 || l[2] < -1e-9) continue;
        const p = norm(add(add(mul(A, l[0]), mul(B, l[1])), mul(C, l[2])));
        const key = p.map((x) => Math.round(x * 1e5)).join(',');
        if (!keys.has(key)) { keys.set(key, pts.length); pts.push(p); }
      }
    }
    const T = m * m + m * n + n * n;
    if (pts.length !== 10 * T + 2) throw new Error(`GP(${m},${n}): expected ${10 * T + 2} cells, got ${pts.length}`);

    const tris = hullTriangles(pts);
    if (tris.length !== 2 * pts.length - 4) throw new Error('degenerate hull');

    const incident = pts.map(() => []);
    tris.forEach((t, ti) => t.forEach((v) => incident[v].push(ti)));
    const cells = pts.map((c, v) => {
      // order surrounding triangles by angle in the tangent plane
      const ref = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const tu = norm(cross(ref, c)), tv = cross(c, tu);
      const cents = incident[v].map((ti) => norm(tris[ti].reduce((s, k) => add(s, pts[k]), [0, 0, 0])));
      const ordered = cents.map((q) => [Math.atan2(dot(q, tv), dot(q, tu)), q]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      const nb = new Set();
      incident[v].forEach((ti) => tris[ti].forEach((k) => k !== v && nb.add(k)));
      return { id: v, center: c, corners: ordered, polygon: ordered, normal: c, pent: nb.size === 5, special: nb.size === 5, nb: [...nb] };
    });
    if (cells.filter((c) => c.pent).length !== 12) throw new Error('expected 12 pentagons');
    return { cells, neigh: cells.map((c) => c.nb) };
  }

  const SPHERE_SIZES = { 42: [2, 0], 72: [2, 1], 92: [3, 0] };
  const sphereCache = new Map();
  /**
   * Sphere board. With holes=true the 12 pentagons are blocked and the playable
   * graph has 10T cells (30 / 60 / 80).
   * Returns { size, holes, cells (all), playable:[cellIdx], indexOf:[cellIdx -> playIdx|-1], engine }
   */
  function sphereBoard(size, holes) {
    const key = size + (holes ? 'h' : '');
    if (sphereCache.has(key)) return sphereCache.get(key);
    const mn = SPHERE_SIZES[size];
    if (!mn) throw new Error('sphere size must be 42, 72 or 92');
    const g = buildGoldberg(mn[0], mn[1]);
    const playable = g.cells.filter((c) => !(holes && c.pent)).map((c) => c.id);
    const indexOf = g.cells.map(() => -1);
    playable.forEach((cid, i) => (indexOf[cid] = i));
    const neigh = playable.map((cid) => g.neigh[cid].map((x) => indexOf[x]).filter((x) => x >= 0));
    const board = {
      type: 'sphere', size: +size, holes: !!holes, cells: g.cells, playable, indexOf,
      engine: createEngine(neigh), specialName: 'pentagons', specialCount: 12,
    };
    sphereCache.set(key, board);
    return board;
  }

  /** Generate a sphere puzzle. opts: { size, holes, difficulty, seed, onProgress } */
  function generateSphere(opts) {
    const b = sphereBoard(opts.size || 72, !!opts.holes);
    const p = b.engine.generate(Object.assign({}, opts, { idPrefix: 's' + b.size + (b.holes ? 'h' : '') + '-' }));
    p.board = { type: 'sphere', size: b.size, holes: b.holes };
    return p;
  }

  // =====================================================================
  // Pyramid boards (regular tetrahedron tiled with triangles)
  // =====================================================================
  // Each face is cut into m^2 small triangles; every triangle is a cell, and two
  // cells are neighbours when they share a side, also across the pyramid's edges.
  // Every cell therefore has exactly 3 neighbours and lies flat on one face.
  const PYRAMID_SIZES = { 36: 3, 64: 4, 100: 5 };
  const PYRAMID_R = 3.3; // circumradius in world units

  function tetraFrame() {
    // regular tetrahedron with one vertex straight up and a horizontal base
    const raw = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(norm);
    const up = raw[0];
    const axis = cross(up, [0, 1, 0]), sinA = len(axis), cosA = dot(up, [0, 1, 0]);
    const k = norm(axis);
    const rot = (v) => add(add(mul(v, cosA), mul(cross(k, v), sinA)), mul(k, dot(k, v) * (1 - cosA)));
    const V = raw.map((v) => mul(rot(v), PYRAMID_R));
    const faces = [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]].map((f) => {
      const [a, b, c] = f.map((i) => V[i]);
      const verts = dot(cross(sub(b, a), sub(c, a)), a) > 0 ? f : [f[0], f[2], f[1]];
      const n = norm(cross(sub(V[verts[1]], V[verts[0]]), sub(V[verts[2]], V[verts[0]])));
      return { verts, n, d: dot(n, V[verts[0]]) };
    });
    return { V, faces };
  }

  function buildTetraTri(m) {
    const { V, faces } = tetraFrame();
    const key = (p) => p.map((x) => Math.round(x * 1e5)).join(',');
    const cells = [];
    faces.forEach((f, fi) => {
      const [A, B, C] = f.verts.map((i) => V[i]);
      const at = (i, j) => add(A, add(mul(sub(B, A), i / m), mul(sub(C, A), j / m)));
      const addTri = (pts) => cells.push({
        id: cells.length, polygon: pts, center: mul(pts.reduce((s, q) => add(s, q), [0, 0, 0]), 1 / 3),
        normal: f.n, faces: [fi], special: false,
      });
      for (let i = 0; i < m; i++) for (let j = 0; i + j < m; j++) {
        addTri([at(i, j), at(i + 1, j), at(i, j + 1)]);                       // pointing "up"
        if (i + j < m - 1) addTri([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]); // pointing "down"
      }
    });
    // neighbours share a side (two corners), also across the pyramid's edges
    const bySide = new Map();
    cells.forEach((c) => c.polygon.forEach((p, k) => {
      const q = c.polygon[(k + 1) % 3];
      const ks = [key(p), key(q)].sort().join('|');
      if (!bySide.has(ks)) bySide.set(ks, []);
      bySide.get(ks).push(c.id);
    }));
    const neigh = cells.map(() => []);
    for (const ids of bySide.values()) if (ids.length === 2) { neigh[ids[0]].push(ids[1]); neigh[ids[1]].push(ids[0]); }
    neigh.forEach((nb, i) => { if (nb.length !== 3) throw new Error('triangle pyramid: cell ' + i + ' has ' + nb.length + ' neighbours'); });
    cells.forEach((c) => (c.nb = neigh[c.id]));
    return { cells, neigh, faces, vertices: V };
  }

  // With only 3 neighbours the path is so constrained that very few givens are needed,
  // so the easier levels keep fewer givens than on the hex/square boards.
  function triangleDifficulties(N) {
    return {
      beginner: { chutes: Math.round(N / 7), targetGivens: Math.round(N * 0.25) },
      easy:   { chutes: Math.round(N / 8),  targetGivens: Math.round(N * 0.18) },
      medium: { chutes: Math.round(N / 10), targetGivens: Math.round(N * 0.1) },
      hard:   { chutes: Math.round(N / 13), targetGivens: 0 },
      expert: { chutes: Math.round(N / 13), targetGivens: 0, pruneChutes: true },
    };
  }

  const pyramidCache = new Map();
  /** Pyramid board: 4·m² triangles (36 / 64 / 100). There are no special cells. */
  function pyramidBoard(size) {
    if (pyramidCache.has(+size)) return pyramidCache.get(+size);
    const m = PYRAMID_SIZES[size];
    if (!m) throw new Error('pyramid size must be 36, 64 or 100');
    const g = buildTetraTri(m);
    const playable = g.cells.map((c) => c.id);
    const board = {
      type: 'pyramid', size: +size, holes: false, cells: g.cells, faces: g.faces, vertices: g.vertices,
      playable, indexOf: playable.slice(), engine: createEngine(g.neigh, triangleDifficulties(g.cells.length)),
      specialName: null, specialCount: 0,
    };
    pyramidCache.set(+size, board);
    return board;
  }

  // =====================================================================
  // Unified board / puzzle API
  // =====================================================================
  const BOARD_TYPES = {
    cube:    { label: 'Cube',    sizes: [54] },
    sphere:  { label: 'Sphere',  sizes: [42, 72, 92], specialName: 'pentagons', specialCount: 12 },
    pyramid: { label: 'Pyramid', sizes: [36, 64, 100], specialName: null, specialCount: 0 },
  };
  const cubeBoard = {
    type: 'cube', size: 54, holes: false, engine: cube,
    playable: NODES.map((n) => n.id), indexOf: NODES.map((n) => n.id),
  };
  /** Normalise a puzzle's board field: 'cube' | {type,size,holes} | undefined (old cube packs). */
  function normalizeSpec(spec) {
    if (!spec || spec === 'cube' || spec.type === 'cube') return { type: 'cube', size: 54, holes: false };
    return { type: spec.type, size: +spec.size, holes: spec.type === 'pyramid' ? false : !!spec.holes };
  }
  /** True if this board still exists (old saves may reference retired board sizes). */
  function isValidSpec(spec) {
    const s = normalizeSpec(spec), bt = BOARD_TYPES[s.type];
    return !!bt && bt.sizes.includes(s.size);
  }
  function boardFor(spec) {
    spec = normalizeSpec(spec);
    if (spec.type === 'sphere') return sphereBoard(spec.size, spec.holes);
    if (spec.type === 'pyramid') return pyramidBoard(spec.size);
    return cubeBoard;
  }
  /** Generate any board. opts: { board:{type,size,holes}, difficulty, seed, onProgress } */
  function generatePuzzle(opts) {
    const spec = normalizeSpec(opts.board);
    if (spec.type === 'cube') return Object.assign(cube.generate(opts), { board: spec });
    const b = boardFor(spec);
    const prefix = (spec.type === 'sphere' ? 's' : 'p') + spec.size + (spec.holes ? 'h' : '') + '-';
    const p = b.engine.generate(Object.assign({}, opts, { idPrefix: prefix }));
    p.board = spec;
    return p;
  }

  return {
    // unified
    BOARD_TYPES, normalizeSpec, isValidSpec, boardFor, generatePuzzle, pyramidBoard, PYRAMID_SIZES,
    // generic
    createEngine, mulberry32, buildGoldberg, sphereBoard, generateSphere, SPHERE_SIZES,
    // cube (backwards-compatible top-level API)
    N: cube.N, HALF, FACES, NODES, NEIGH: CUBE_NEIGH, borderPoint, sideOf,
    isAdjacent: cube.isAdjacent, randomHamiltonianPath: cube.randomHamiltonianPath,
    countSolutions: cube.countSolutions, findConflicts: cube.findConflicts, explainConflicts: cube.explainConflicts, isSolved: cube.isSolved,
    DIFFICULTIES: CUBE_DIFFICULTIES,
    generate: (opts) => Object.assign(cube.generate(opts), { board: 'cube' }),
  };
});
