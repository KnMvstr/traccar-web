import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { normalizeCampaign, publishSource, estimateCall, tokenCategories, webRoot } from './prepare-data.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
const pricing = JSON.parse(readFileSync(resolve(webRoot, 'config/pricing.json'), 'utf8'));
function fixture() {
  const manifest = { model: 'github-copilot/gpt-5.6-luna', runs: [1], branches: { off: 'off', on: 'on', 'on-no-routing': 'without' }, refs: { off: 'a', on: 'b', 'on-no-routing': 'c' }, createdAt: '2026-11-09T00:00:00Z' };
  const runs = Object.keys(manifest.branches).map(arm => ({ arm, run: 1, valid: true, workingTreeChanged: false, model: manifest.model, variant: null, commit: manifest.refs[arm], expectedPrompts: [{ id: 'P0', name: 'Inventory', measure: 'setup' }], startedAt: '2026-11-09T00:00:01Z', finishedAt: '2026-11-09T00:01:00Z', durationMs: 1000,
    turns: [{ id: 'P0', valid: true, comparable: true, durationMs: 1000, costKnown: false, calls: [{ tokens: { total: 140, input: 100, output: 20, reasoning: 10, cache: { read: 10, write: 0 } } }] }] }));
  return { manifest, runs };
}
test('reconciles reasoning exactly once and applies long-context pricing per call', () => {
  const call = total => ({ tokens: { total, input: 100, output: 20, reasoning: 10, cache: { read: 10, write: 0 } } });
  close(estimateCall(call(140), pricing), (100*.2+10*.02+30*1.2)/1e6);
  close(estimateCall(call(130), pricing), (100*.2+10*.02+20*1.2)/1e6);
  assert.throws(() => estimateCall(call(999), pricing));
  close(estimateCall({ tokens: { total: 300020, input: 300000, output: 20, cache: {} } }, pricing), (300000*.2*2+20*1.2*1.5)/1e6);
});
test('normalizes public metrics without raw messages or local paths', () => {
  const { manifest, runs } = fixture(); runs[0].workspace = 'secret-path';
  const c = normalizeCampaign(manifest, runs, pricing, 'opencode');
  assert.equal(c.runs.length, 3); assert.equal(c.runs[0].turns[0].tokens, 140);
  assert.equal(JSON.stringify(c).includes('secret-path'), false);
  assert.deepEqual(c.runs[0].turns[0].tokenBreakdown, { input: 100, output: 20, reasoning: 10, cacheRead: 10, cacheWrite: 0, cache: 10 });
});

test('categories reconcile included reasoning and cost uses the full request tier', () => {
  const call = { tokens: { total: 200040, input: 190000, output: 40, reasoning: 10, cache: { read: 10000, write: 0 } } };
  assert.deepEqual(tokenCategories(call), { input: 190000, output: 30, reasoning: 10, cacheRead: 10000, cacheWrite: 0, cache: 10000 });
  const standard = estimateCall(call, pricing);
  call.tokens.input++; call.tokens.total++;
  close(estimateCall(call, pricing, 'reasoning'), 10*1.8/1e6);
  assert.ok(estimateCall(call, pricing) > standard);
  close(['input','output','reasoning','cacheRead','cacheWrite'].reduce((sum,key) => sum+estimateCall(call,pricing,key),0), estimateCall(call,pricing));
});

test('a model from another provider does not inherit Copilot rates', () => {
  const { manifest, runs } = fixture();
  manifest.model = 'openai/gpt-5.6-luna'; runs.forEach(r => r.model = manifest.model);
  const c = normalizeCampaign(manifest, runs, pricing, 'opencode');
  assert.equal(c.runs[0].turns[0].estimatedCost, null);
});
test('rejects partial, invalid, duplicate, pilot and mixed-model campaigns', () => {
  for (const change of [
    f => f.runs.pop(), f => f.runs[0].valid = false, f => f.runs[0].turns[0].comparable = false,
    f => f.manifest.runs = [0], f => f.runs[0].model = 'other', f => f.runs[0].variant = 'medium',
    f => f.runs[0].finishedAt = '2020-01-01', f => f.runs[0].turns = [], f => f.runs[1] = f.runs[0],
  ]) { const f = fixture(); change(f); assert.throws(() => normalizeCampaign(f.manifest, f.runs, pricing, 'opencode')); }
});
test('publication is atomic, idempotent, retains history and survives failed or stale reports', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'benchmark-web-'));
  const input = resolve(dir, 'input'), output = resolve(dir, 'output'); mkdirSync(input);
  const write = (name, value) => writeFileSync(resolve(input, name), JSON.stringify(value));
  const save = f => {
    write('manifest.json', f.manifest);
    for (const arm of ['off','on','on-no-routing']) {
      mkdirSync(resolve(input, arm), { recursive: true });
      write(`${arm}/run-1.json`, f.runs.find(r => r.arm === arm));
    }
    write('compare-with-routing.json', { valid: true, onArm: 'on', individualRuns: f.runs.filter(r => r.arm !== 'on-no-routing') });
    write('compare-no-routing.json', { valid: true, onArm: 'on-no-routing', individualRuns: f.runs.filter(r => r.arm !== 'on') });
  };
  try {
    const f = fixture(); save(f);
    assert.equal(publishSource('opencode', input, output, pricing).updated, true);
    const path = resolve(output, 'opencode.json'), before = readFileSync(path, 'utf8');
    assert.equal(publishSource('opencode', input, output, pricing).updated, false);
    write('compare-no-routing.json', { valid: false, reason: 'campaign-in-progress' });
    assert.equal(publishSource('opencode', input, output, pricing).updated, false);
    assert.equal(readFileSync(path,'utf8'), before);
    save(f); f.runs[0].turns[0].durationMs = 2000; write('off/run-1.json', f.runs[0]);
    assert.equal(publishSource('opencode', input, output, pricing).updated, false);
    assert.equal(readFileSync(path,'utf8'), before);
    f.manifest.createdAt = '2026-11-10T00:00:00Z'; f.runs.forEach(r => { r.finishedAt = '2026-11-10T00:01:00Z'; r.startedAt = '2026-11-10T00:00:01Z'; }); save(f);
    assert.equal(publishSource('opencode', input, output, pricing).updated, true);
    assert.equal(JSON.parse(readFileSync(path,'utf8')).campaigns.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('VSCode completion gate preserves its snapshot independently', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'copilot-web-'));
  try {
    const { manifest, runs } = fixture();
    writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(manifest));
    const completed = resolve(dir, 'completed.json');
    writeFileSync(completed, JSON.stringify({ complete: true, valid: true, runs }));
    const out = resolve(dir, 'out');
    assert.equal(publishSource('vscode-copilot', dir, out, pricing).updated, true);
    const before = readFileSync(resolve(out,'vscode-copilot.json'),'utf8');
    writeFileSync(completed, JSON.stringify({ complete: false, valid: true, runs }));
    assert.equal(publishSource('vscode-copilot', dir, out, pricing).updated, false);
    assert.equal(readFileSync(resolve(out,'vscode-copilot.json'),'utf8'), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
