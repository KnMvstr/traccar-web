import { readFileSync, mkdirSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { tokens } from '../../bench-lib.mjs';

export const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const number = n => Number.isFinite(n) && n >= 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// The exported total reveals whether OpenCode's output already includes reasoning.
export function estimateCall(call, pricing, category = 'total') {
  const t = call.tokens;
  if (!t || ![t.total, t.input, t.output, t.reasoning ?? 0, t.cache?.read ?? 0, t.cache?.write ?? 0].every(number)) throw Error('Missing token accounting');
  const readTokens = t.cache?.read ?? 0, writeTokens = t.cache?.write ?? 0;
  const base = t.input + t.output + readTokens + writeTokens;
  if (t.total !== base && t.total !== base + (t.reasoning ?? 0)) throw Error('Unreconciled tokens');
  const long = t.input + readTokens + writeTokens > pricing.longContextThreshold;
  const breakdown = tokenCategories(call);
  const inputRate = (long ? pricing.longInputMultiplier : 1) / 1e6;
  const outputRate = pricing.output * (long ? pricing.longOutputMultiplier : 1) / 1e6;
  const costs = { input: breakdown.input * pricing.input * inputRate,
    output: breakdown.output * outputRate, reasoning: breakdown.reasoning * outputRate,
    cacheRead: readTokens * pricing.cacheRead * inputRate, cacheWrite: writeTokens * pricing.cacheWrite * inputRate };
  costs.cache = costs.cacheRead + costs.cacheWrite;
  return category === 'total' ? costs.input + costs.output + costs.reasoning + costs.cache : costs[category];
}

export function tokenCategories(call) {
  const t = call.tokens, cacheRead = t.cache?.read ?? 0, cacheWrite = t.cache?.write ?? 0;
  const reasoning = t.reasoning ?? 0;
  const included = t.total === t.input + t.output + cacheRead + cacheWrite;
  const output = t.output - (included ? reasoning : 0);
  if (output < 0) throw Error('Reasoning exceeds included output');
  return { input: t.input, output, reasoning, cacheRead, cacheWrite, cache: cacheRead + cacheWrite };
}

export function normalizeCampaign(manifest, runs, pricing, source) {
  if (!Array.isArray(manifest.runs) || !manifest.runs.length || !manifest.runs.every(n => Number.isInteger(n) && n > 0) || new Set(manifest.runs).size !== manifest.runs.length) throw Error('Measured run numbers required; pilots excluded');
  if (!manifest.model || !Number.isFinite(Date.parse(manifest.createdAt))) throw Error('Campaign model/date missing');
  const prompts = runs[0]?.expectedPrompts;
  if (!Array.isArray(prompts) || !prompts.length || new Set(prompts.map(p => p.id)).size !== prompts.length) throw Error('Prompt protocol missing');
  const arms = Object.keys(manifest.branches ?? {});
  if (!arms.length || runs.length !== arms.length * manifest.runs.length) throw Error('Incomplete campaign');
  const variant = runs[0].variant ?? null;
  const normalized = [];
  for (const arm of arms) for (const n of manifest.runs) {
    const matches = runs.filter(r => r.arm === arm && r.run === n);
    if (matches.length !== 1) throw Error('Missing or duplicate run');
    const r = matches[0];
    if (r.valid !== true || r.workingTreeChanged !== false || r.model !== manifest.model || (r.variant ?? null) !== variant || (manifest.variant != null && manifest.variant !== variant)
      || r.commit !== manifest.refs?.[arm] || !same(r.expectedPrompts, prompts) || !Number.isFinite(Date.parse(r.finishedAt)) || !Number.isFinite(Date.parse(r.startedAt)) || Date.parse(r.finishedAt) < Date.parse(manifest.createdAt) || !number(r.durationMs)
      || !Array.isArray(r.turns) || r.turns.length !== prompts.length) throw Error(`Incomplete or inconsistent ${arm} run ${n}`);
    const turns = r.turns.map((t, i) => {
      if (t.id !== prompts[i].id || t.valid !== true || t.comparable !== true || t.contextDiverged || !number(t.durationMs)) throw Error('Invalid prompt');
      const total = tokens(t);
      const supported = manifest.model === `${pricing.provider}/${pricing.model}`;
      const categories = ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'cache'];
      const tokenBreakdown = Object.fromEntries(categories.map(key => [key, t.calls.reduce((sum, c) => sum + tokenCategories(c)[key], 0)]));
      const costBreakdown = Object.fromEntries(categories.map(key => [key, supported ? t.calls.reduce((sum, c) => sum + estimateCall(c, pricing, key), 0) : null]));
      const estimate = supported ? t.calls.reduce((sum, c) => sum + estimateCall(c, pricing), 0) : null;
      return { id: t.id, tokens: total, tokenBreakdown, costBreakdown, durationMs: t.durationMs, estimatedCost: estimate, providerCost: t.costKnown && number(t.cost) ? t.cost : null };
    });
    normalized.push({ arm, run: n, durationMs: r.durationMs, turns });
  }
  const finishedAt = new Date(Math.max(...runs.map(r => Date.parse(r.finishedAt)))).toISOString();
  return { id: hash({ manifest, runs: runs.map(r => [r.arm, r.run, r.finishedAt]) }), source, model: manifest.model, variant,
    startedAt: manifest.createdAt, finishedAt, prompts: prompts.map(p => ({ id: p.id, name: p.name, measure: p.measure })),
    setups: arms.map(id => ({ id, name: id === 'off' ? 'Context Mode OFF' : id === 'on' ? 'ON · with routing' : id === 'on-no-routing' ? 'ON · without routing' : manifest.branches[id] })),
    runs: normalized, pricing };
}

export function publishSource(source, input, output, pricing) {
  const destination = resolve(output, `${source}.json`);
  try {
    const manifest = read(resolve(input, 'manifest.json'));
    let runs;
    if (source === 'opencode') {
      const a = read(resolve(input, 'compare-with-routing.json')), b = read(resolve(input, 'compare-no-routing.json'));
      if (a.valid !== true || b.valid !== true || a.onArm !== 'on' || b.onArm !== 'on-no-routing') throw Error('Both comparisons must be validated');
      runs = Object.keys(manifest.branches).flatMap(arm => manifest.runs.map(n => read(resolve(input, arm, `run-${n}.json`))));
      for (const [report, arm] of [[a, 'on'], [b, 'on-no-routing']]) {
        const expected = runs.filter(r => r.arm === 'off' || r.arm === arm);
        if (report.individualRuns?.length !== expected.length || !expected.every(r => report.individualRuns.some(v => same(v, r)))) throw Error('Comparison does not match current campaign');
      }
    } else {
      const completed = read(resolve(input, 'completed.json'));
      if (completed.complete !== true || completed.valid !== true) throw Error('VSCode campaign not complete and validated');
      runs = completed.runs;
    }
    const campaign = normalizeCampaign(manifest, runs, pricing, source);
    const previous = existsSync(destination) ? read(destination) : { schemaVersion: 1, campaigns: [] };
    if (previous.campaigns.some(c => c.id === campaign.id && same(c, campaign))) return { source, updated: false, reason: 'Already published' };
    const campaigns = [...previous.campaigns.filter(c => c.id !== campaign.id), campaign].sort((a,b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
    mkdirSync(output, { recursive: true });
    const temp = `${destination}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ schemaVersion: 1, campaigns }, null, 2) + '\n');
    renameSync(temp, destination);
    return { source, updated: true, reason: 'Completed campaign saved' };
  } catch (error) {
    // Deliberately do not touch the last successful snapshot on any read/validation failure.
    return { source, updated: false, reason: error.message };
  }
}

export function prepareData(options = {}) {
  const pricing = read(resolve(webRoot, 'config/pricing.json'));
  const output = options.output ?? resolve(webRoot, 'public/data');
  return [publishSource('opencode', options.opencode ?? process.env.OPENCODE_RESULTS ?? resolve(webRoot, '../results'), output, pricing),
    publishSource('vscode-copilot', options.copilot ?? process.env.COPILOT_RESULTS ?? resolve(webRoot, '../results/vscode-copilot'), output, pricing)];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(prepareData(), null, 2));
