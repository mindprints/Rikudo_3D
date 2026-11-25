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

    /**
     * Generate a puzzle with exactly one solution. 1 and N are always given.
     * opts: { seed, difficulty, budget, config:{chutes,targetGivens,pruneChutes}, onProgress }
     */
    function generate(opts) {
      opts = opts || {};
      const difficulty = DIFF[opts.difficulty] ? opts.difficulty : 'medium';
      const cfg = opts.config || DIFF[difficulty];
      const seed = opts.seed != null ? opts.seed >>> 0 : Math.floor(Math.random() * 2 ** 32) >>> 0;
      const budget = opts.budget || cfg.budget || 150000;
      const rng = mulberry32(seed);

      const path = randomHamiltonianPath(rng);
      const solution = new Array(N).fill(0);
      path.forEach((node, idx) => (solution[node] = idx + 1));

      // chutes: random path edges, no two sharing a cell
      const chutes = [];
      const used = new Uint8Array(N);
      for (const i of shuffle(Array.from({ length: N - 1 }, (_, i) => i), rng)) {
        if (chutes.length >= cfg.chutes) break;
        const a = path[i], b = path[i + 1];
        if (used[a] || used[b]) continue;
        used[a] = used[b] = 1;
        chutes.push([a, b]);
      }

      const cells = solution.slice();
      const unique = (cand) => {
        const r = countSolutions(cand, { limit: 2, budget });
        return !r.aborted && r.count === 1;
      };

      // remove givens while the solution stays unique
      let givens = N;
      const order = shuffle(Array.from({ length: N }, (_, i) => i).filter((i) => solution[i] !== 1 && solution[i] !== N), rng);
      order.forEach((node, idx) => {
        if (givens <= cfg.targetGivens) return;
        const keep = cells[node];
        cells[node] = 0;
        if (unique({ cells, chutes })) givens--;
        else cells[node] = keep;
        if (opts.onProgress) opts.onProgress((idx + 1) / order.length);
      });

      let finalChutes = chutes;
      if (cfg.pruneChutes) {
        finalChutes = chutes.slice();
        for (const c of shuffle(chutes.slice(), rng)) {
          const trial = finalChutes.filter((x) => x !== c);
          if (trial.length >= 2 && unique({ cells, chutes: trial })) finalChutes = trial;
        }
      }

      return {
        id: (opts.idPrefix || '') + difficulty + '-' + seed.toString(36),
        seed, difficulty,
        givens: cells.filter((x) => x > 0).length,
        cells, chutes: finalChutes, solution,
      };
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

    return { N, NEIGH, isAdjacent, randomHamiltonianPath, countSolutions, generate, findConflicts, explainConflicts, isSolved, DIFFICULTIES: DIFF };
  }

  // Difficulty presets scaled by board size (tuned for the 5–6 neighbour sphere boards).
  function defaultDifficulties(N) {
    return {
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
      return { id: v, center: c, corners: ordered, pent: nb.size === 5, nb: [...nb] };
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
    const board = { size: +size, holes: !!holes, cells: g.cells, playable, indexOf, engine: createEngine(neigh) };
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

  return {
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
