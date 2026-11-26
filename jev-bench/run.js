#!/usr/bin/env node
/**
 * Ask Jev each benchmark item through OpenRouter's Decisions API and log the answers.
 *
 *   OPENROUTER_API_KEY=sk-or-... node run.js [--model typesafe/jev-1.14] [--limit 5] [--dry]
 *                                           [--concurrency 4] [--items items.jsonl] [-o results.jsonl]
 * --dry    print the first request and stop (no key needed, nothing sent)
 * --limit  only the first N items not yet answered (try --limit 3 first)
 * Resumable: items already in the results file are skipped, so you can stop and restart.
 * Needs Node 18 or newer (built-in fetch). Costs roughly $0.03 for all ~600 items at $0.042/M input tokens.
 */
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const MODEL = arg('--model', 'typesafe/jev-1.14');
const ITEMS = arg('--items', path.join(__dirname, 'items.jsonl'));
const OUT = arg('-o', path.join(__dirname, 'results.jsonl'));
const LIMIT = +arg('--limit', 1e9), CONC = +arg('--concurrency', 4), DRY = args.includes('--dry');
const URL_ = 'https://openrouter.ai/api/alpha/decisions';

const items = fs.readFileSync(ITEMS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
const todo = items.filter((it) => !done.has(it.id)).slice(0, LIMIT);

const request = (it) => ({
  model: MODEL,
  state: it.state,
  questions: {
    cell: {
      type: 'choice',
      instructions: it.question,
      criteria: Object.fromEntries(it.options.map((o) => [o, null])), // the options are the keys
    },
  },
});

if (DRY) {
  const r = request(todo[0] || items[0]);
  console.log(JSON.stringify({ ...r, state: r.state.slice(0, 600) + ' …' }, null, 2));
  console.log(`\n${todo.length} items to send to ${MODEL} (${done.size} already answered).`);
  process.exit(0);
}
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY first (see README.md).'); process.exit(1); }

// find the answer for our question wherever the response nests it
function findAnswer(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.cell && typeof obj.cell === 'object' && 'choice' in obj.cell) return obj.cell;
  for (const v of Object.values(obj)) { const f = findAnswer(v); if (f) return f; }
  return null;
}

let sent = 0, ok = 0, failed = 0, cost = 0, rawShown = false;
const out = fs.createWriteStream(OUT, { flags: 'a' });
async function ask(it) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const t0 = Date.now();
    let res, body;
    try {
      res = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/mindprints/Rikudo_3D', 'X-Title': 'Rikudo3 Jev benchmark' }, body: JSON.stringify(request(it)) });
      body = await res.text();
    } catch (e) { body = String(e); }
    if (res && res.ok) {
      const json = JSON.parse(body);
      if (!rawShown) { rawShown = true; console.log('First response (raw):\n' + JSON.stringify(json, null, 2).slice(0, 1500) + '\n'); }
      const a = findAnswer(json);
      if (!a) { console.error(`${it.id}: no answer for "cell" in response`); failed++; return; }
      const probs = a.probabilities || {};
      const rec = {
        id: it.id, board: it.board, size: it.size, level: it.level, tier: it.tier, tierName: it.tierName,
        options: it.options.length, chance: it.chance, filled: it.filled, answer: it.answer,
        choice: a.choice, correct: a.choice === it.answer, pCorrect: probs[it.answer] ?? null,
        confidence: a.confidence ?? null, cost: json.usage?.cost ?? null, ms: Date.now() - t0, model: MODEL,
      };
      cost += rec.cost || 0; ok++;
      out.write(JSON.stringify(rec) + '\n');
      return;
    }
    const status = res ? res.status : 'network';
    if (status === 429 || status === 'network' || status >= 500) { await new Promise((r) => setTimeout(r, 1500 * attempt ** 2)); continue; }
    console.error(`${it.id}: HTTP ${status} ${String(body).slice(0, 400)}`); failed++;
    if (status === 400 || status === 401 || status === 402 || status === 403) process.exitCode = 1;
    return;
  }
  console.error(`${it.id}: gave up after 5 attempts`); failed++;
}

(async () => {
  console.log(`Sending ${todo.length} items to ${MODEL} (${done.size} already answered)…`);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, todo.length) }, async () => {
    while (next < todo.length) {
      const it = todo[next++]; await ask(it); sent++;
      if (sent % 25 === 0 || sent === todo.length) process.stdout.write(`  ${sent}/${todo.length} sent, ${ok} answered, ${failed} failed, $${cost.toFixed(4)}\n`);
      if (process.exitCode === 1 && failed >= 3) { console.error('Stopping: repeated request errors (see above).'); process.exit(1); }
    }
  }));
  out.end();
  console.log(`Done: ${ok} answered, ${failed} failed, cost $${cost.toFixed(4)}. Results in ${OUT}. Now run: node analyze.js`);
})();
