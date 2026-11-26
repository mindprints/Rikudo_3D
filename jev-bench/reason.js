#!/usr/bin/env node
/**
 * The System 2 side: ask a reasoning model (or Jev Router) the same benchmark items through
 * OpenRouter's Chat Completions API. The model thinks, then ends with "ANSWER: <cell>".
 *
 *   OPENROUTER_API_KEY=sk-or-... node reason.js [--model deepseek/deepseek-v4.1-flash-1017] [--effort medium]
 *        [--items items.jsonl] [--per 40] [--limit 3] [--max-cost 5] [--concurrency 8] [--dry] [-o results-<model>-<effort>.jsonl]
 *
 * --model     any OpenRouter chat model; typesafe/jev-router lets Jev pick the model and effort itself
 * --effort    reasoning effort sent as reasoning.effort: low | medium | high (a hint only for Jev Router)
 * --per       at most N items per board × tier (for expensive models: --per 20 → ~300 items)
 * --max-cost  stop once the run has cost this many US dollars (default 5)
 * --limit     only the first N items not yet answered (try --limit 3 first)
 * Resumable: items already in the output file are skipped.
 * Records: the choice, right/wrong, reasoning tokens, cost, time, and the model that actually answered.
 */
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const MODEL = arg('--model', 'deepseek/deepseek-v4.1-flash-1017');
const EFFORT = arg('--effort', 'medium');
const ITEMS = arg('--items', path.join(__dirname, 'items.jsonl'));
const slug = MODEL.replace(/^~/, '').replace(/[^a-z0-9.]+/gi, '-');
const OUT = arg('-o', path.join(__dirname, `results-${slug}-${EFFORT}.jsonl`));
const PER = +arg('--per', 1e9), LIMIT = +arg('--limit', 1e9), MAXCOST = +arg('--max-cost', 5);
const CONC = +arg('--concurrency', 8), DRY = args.includes('--dry');
const URL_ = 'https://openrouter.ai/api/v1/chat/completions';
const IS_ROUTER = /jev-router/.test(MODEL);

let items = fs.readFileSync(ITEMS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (PER < 1e9) { const seen = {}; items = items.filter((it) => { const k = it.board + it.tier; seen[k] = (seen[k] || 0) + 1; return seen[k] <= PER; }); }
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
const todo = items.filter((it) => !done.has(it.id)).slice(0, LIMIT);

const prompt = (it) => `${it.state}

Question: ${it.question}
The answer is one of these empty cells: ${it.options.slice().sort().join(', ')}.
Exactly one cell is correct, and it follows from the rules and the board as given.
Work it out, then end your reply with a final line of the form:
ANSWER: <cell name>`;

const request = (it) => ({
  model: MODEL,
  messages: [{ role: 'user', content: prompt(it) }],
  reasoning: { effort: EFFORT },
  max_tokens: 32000,
  usage: { include: true },
});

if (DRY) {
  const r = request(todo[0] || items[0]);
  console.log(JSON.stringify({ ...r, messages: [{ role: 'user', content: r.messages[0].content.slice(0, 400) + ' … ' + r.messages[0].content.slice(-330) }] }, null, 2));
  console.log(`\n${todo.length} items to send to ${MODEL} at effort ${EFFORT} (${done.size} already answered) → ${path.basename(OUT)}`);
  process.exit(0);
}
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY first (see README.md).'); process.exit(1); }

let sent = 0, ok = 0, failed = 0, cost = 0, shown = false, stop = false;
const out = fs.createWriteStream(OUT, { flags: 'a' });
async function ask(it) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const t0 = Date.now();
    let res, body;
    try {
      res = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/mindprints/Rikudo_3D', 'X-Title': 'Rikudo3 reasoning benchmark',
        ...(IS_ROUTER ? { 'X-OpenRouter-Metadata': 'enabled' } : {}) }, body: JSON.stringify(request(it)) });
      body = await res.text();
    } catch (e) { body = String(e); }
    if (res && res.ok) {
      const json = JSON.parse(body);
      const msg = json.choices?.[0]?.message || {};
      const text = typeof msg.content === 'string' ? msg.content : (msg.content || []).map((p) => p.text || '').join('');
      const m = [...text.matchAll(/ANSWER:\s*\**\s*(c\d+)/gi)].pop();
      const choice = m ? m[1].toLowerCase() : null;
      const u = json.usage || {};
      if (!shown) { shown = true; console.log(`First reply (model ${json.model}): …${text.slice(-300)}\nusage: ${JSON.stringify(u)}\n`); }
      const rec = {
        id: it.id, board: it.board, size: it.size, level: it.level, tier: it.tier, tierName: it.tierName,
        options: it.options.length, chance: it.chance, filled: it.filled, answer: it.answer,
        choice, correct: choice === it.answer, valid: !!choice && it.options.includes(choice), pCorrect: null, confidence: null,
        reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? u.reasoning_tokens ?? null,
        completionTokens: u.completion_tokens ?? null, promptTokens: u.prompt_tokens ?? null,
        cost: u.cost ?? null, ms: Date.now() - t0, model: MODEL, servedBy: json.model, effort: EFFORT,
        finish: json.choices?.[0]?.finish_reason ?? null,
        route: IS_ROUTER ? (json.openrouter_metadata ?? null) : undefined, // Jev Router's own account of its choice, kept whole
      };
      cost += rec.cost || 0; ok++;
      out.write(JSON.stringify(rec) + '\n');
      if (cost >= MAXCOST && !stop) { stop = true; console.log(`Reached --max-cost $${MAXCOST}; finishing requests in flight, then stopping.`); }
      return;
    }
    const status = res ? res.status : 'network';
    if (status === 429 || status === 'network' || status >= 500) { await new Promise((r) => setTimeout(r, 2000 * attempt ** 2)); continue; }
    console.error(`${it.id}: HTTP ${status} ${String(body).slice(0, 400)}`); failed++;
    if ([400, 401, 402, 403, 404].includes(status)) process.exitCode = 1;
    return;
  }
  console.error(`${it.id}: gave up after 5 attempts`); failed++;
}

(async () => {
  console.log(`Sending ${todo.length} items to ${MODEL} at effort ${EFFORT} (${done.size} already answered), max $${MAXCOST}…`);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, todo.length) }, async () => {
    while (next < todo.length && !stop) {
      const it = todo[next++]; await ask(it); sent++;
      if (sent % 10 === 0 || sent === todo.length) process.stdout.write(`  ${sent}/${todo.length} sent, ${ok} answered, ${failed} failed, $${cost.toFixed(3)}\n`);
      if (process.exitCode === 1 && failed >= 3) { console.error('Stopping: repeated request errors (see above).'); process.exit(1); }
    }
  }));
  out.end();
  console.log(`Done: ${ok} answered, ${failed} failed, cost $${cost.toFixed(3)}. Results in ${path.basename(OUT)}.`);
  console.log(`Re-run the same command to continue. Compare everything with: node compare.js`);
})();
