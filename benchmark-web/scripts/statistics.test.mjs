import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { makeRows, makeChartSeries, makeTableTotals, makeConsumptionComparison, makeBoxplotSeries, fiveNumberSummary } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const languageSource = readFileSync(new URL('../src/language.ts', import.meta.url), 'utf8');
const languageCode = ts.transpileModule(languageSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { metricDescription } = await import(`data:text/javascript;base64,${Buffer.from(languageCode).toString('base64')}`);
const turn = (id, tokens) => ({ id, tokens, durationMs: tokens*1000, estimatedCost: tokens/100, providerCost: null });
const campaign = { setups: [{ id: 'off', name: 'OFF' }], prompts: [{ id: 'P0', measure: 'setup' }, { id: 'P1', measure: 'marginal' }], runs: [
  { arm: 'off', turns: [turn('P0',1),turn('P1',100)] },
  { arm: 'off', turns: [turn('P0',50),turn('P1',50)] },
  { arm: 'off', turns: [turn('P0',100),turn('P1',1)] },
] };

test('tooltip descriptions identify filtered costs, per-run scope and unchanged time', () => {
  const context = { language: 'fr', time: false, cost: true, prompt: false, cumulative: false, tokenType: 'cache' };
  assert.equal(metricDescription(context), 'Coût estimé des tokens · Cache (lecture + écriture) · par run · prompts sélectionnés');
  assert.match(metricDescription({ ...context, language: 'en', tokenType: 'total' }), /Total tokens.*per run/);
  assert.match(metricDescription({ ...context, prompt: true }), /par prompt et par run/);
  assert.match(metricDescription({ ...context, prompt: true, cumulative: true }), /cumul des prompts sélectionnés par run/);
  const duration = metricDescription({ ...context, time: true, cost: false });
  assert.match(duration, /temps non filtré/);
  assert.doesNotMatch(duration, /Cache/);
  for (const tokenType of ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite']) {
    assert.notEqual(metricDescription({ ...context, tokenType }), metricDescription(context));
  }
});
test('setup median sums each run before aggregating, rather than summing prompt medians', () => {
  const [r] = makeRows(campaign, 'setup-tokens', 'off', 'median', 'all', false);
  assert.equal(r.tokens, 101); assert.equal(r.n,3); assert.equal(r.providerCost, null);
  assert.equal(r.min,100); assert.equal(r.max,101);
});
test('cumulative prompt median agrees with setup total and scopes filter before summing', () => {
  const rows = makeRows(campaign, 'prompt-tokens', 'off', 'median', 'all', true);
  assert.equal(rows[0].tokens,50); assert.equal(rows[1].tokens,101);
  const marginal = makeRows(campaign, 'prompt-tokens', 'off', 'median', 'marginal', true);
  assert.equal(marginal.length,1); assert.equal(marginal[0].tokens,50);
});
test('mean time remains distinct from median and ranges use selected metric', () => {
  const [r] = makeRows(campaign, 'setup-time', 'off', 'mean', 'all', false);
  assert.equal(r.durationMs,302000/3); assert.equal(r.min,100000); assert.equal(r.max,101000);
});

test('all-setup lines keep separate populations and cumulative costs', () => {
  const comparison = structuredClone(campaign);
  comparison.setups.push({ id: 'on', name: 'ON' });
  comparison.runs.push({ arm: 'on', turns: [turn('P0', 7), turn('P1', 13)] });
  const lines = makeChartSeries(comparison, 'prompt-tokens', 'all', 'median', 'all', true);
  assert.deepEqual(lines.map(s => s.id), ['off', 'on']);
  assert.deepEqual(lines.map(s => s.rows.map(r => r.label)), [['P0', 'P1'], ['P0', 'P1']]);
  assert.equal(lines[0].rows[1].tokens, 101);
  assert.equal(lines[0].rows[1].n, 3);
  assert.equal(lines[1].rows[1].tokens, 20);
  assert.equal(lines[1].rows[1].n, 1);
  assert.equal(lines[1].rows[1].estimatedCost, .2);
  const selected = makeChartSeries(comparison, 'prompt-time', 'on', 'mean', 'marginal', false);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].rows.length, 1);
  assert.equal(selected[0].rows[0].durationMs, 13000);
});

test('cost views aggregate complete prompt costs per run and preserve unknown costs', () => {
  const [total] = makeRows(campaign, 'setup-cost', 'off', 'median', 'all', false);
  assert.equal(total.estimatedCost, 1.01);
  assert.equal(total.min, 1);
  assert.equal(total.max, 1.01);
  const prompts = makeChartSeries(campaign, 'prompt-cost', 'all', 'median', 'all', true)[0].rows;
  assert.equal(prompts[0].estimatedCost, .5);
  assert.equal(prompts[1].estimatedCost, total.estimatedCost);
  const missing = structuredClone(campaign);
  missing.runs[0].turns[0].estimatedCost = null;
  const [unknown] = makeRows(missing, 'prompt-cost', 'off', 'median', 'all', false);
  assert.equal(unknown.estimatedCost, null);
  assert.equal(unknown.min, null);
  assert.equal(unknown.max, null);
});

test('category selection updates tokens and costs without changing time or inventing provider costs', () => {
  const c = structuredClone(campaign);
  c.runs.forEach(r => r.turns.forEach(t => {
    t.tokenBreakdown = { input: 3, output: 4, reasoning: 2, cacheRead: 1, cacheWrite: 0, cache: 1 };
    t.costBreakdown = { input: .003, output: .004, reasoning: .002, cacheRead: .001, cacheWrite: 0, cache: .001 };
  }));
  const [row] = makeRows(c, 'setup-cost', 'off', 'median', 'all', false, 'reasoning');
  assert.equal(row.tokens, 4);
  assert.equal(row.estimatedCost, .004);
  assert.equal(row.min, .004);
  assert.equal(row.durationMs, 101000);
  assert.equal(row.providerCost, null);
  const [zero] = makeRows(c, 'prompt-tokens', 'off', 'median', 'all', false, 'cacheWrite');
  assert.equal(zero.tokens, 0);
  assert.equal(zero.estimatedCost, 0);
});

test('table totals separate per-run statistics from the sum of all measured runs', () => {
  const totals = makeTableTotals(campaign, 'prompt-cost', 'all', 'median', 'all');
  assert.equal(totals.perSetup[0].tokens, 101);
  assert.equal(totals.overall.tokens, 302);
  assert.equal(totals.overall.n, 3);
  assert.ok(Math.abs(totals.overall.estimatedCost - 3.02) < 1e-12);
  assert.equal(totals.overall.providerCost, null);
  assert.equal(makeTableTotals(campaign, 'setup-cost', 'all', 'mean', 'all').perSetup.length, 0);
});

test('table totals respect setup and prompt scope without multiplying runs by prompts', () => {
  const c = structuredClone(campaign);
  c.setups.push({ id: 'on', name: 'ON' });
  c.runs.push({ arm: 'on', turns: [turn('P0', 10), turn('P1', 20)] });
  const totals = makeTableTotals(c, 'prompt-tokens', 'on', 'median', 'marginal');
  assert.equal(totals.overall.n, 1);
  assert.equal(totals.overall.tokens, 20);
  assert.equal(totals.perSetup.length, 1);
  const all = makeTableTotals(c, 'prompt-tokens', 'all', 'median', 'all');
  assert.equal(all.overall.tokens, 332);
  assert.equal(all.overall.n, 4);
});

test('boxplot quartiles interpolate sorted samples and handle small samples', () => {
  assert.deepEqual(fiveNumberSummary([100,1,50]), [1,25.5,50,75,100]);
  assert.deepEqual(fiveNumberSummary([4,1,3,2]), [1,1.75,2.5,3.25,4]);
  assert.deepEqual(fiveNumberSummary([7]), [7,7,7,7,7]);
  assert.equal(fiveNumberSummary([]), null);
});

test('boxplots use individual run totals, not prompt medians, and preserve setup grouping', () => {
  const setups = makeBoxplotSeries(campaign, 'setup-tokens', 'all', 'all', false);
  assert.deepEqual(setups[0].rows[0].summary, [100,100.5,101,101,101]);
  const prompts = makeBoxplotSeries(campaign, 'prompt-tokens', 'all', 'all', true);
  assert.deepEqual(prompts[0].rows[0].summary, [1,25.5,50,75,100]);
  assert.deepEqual(prompts[0].rows[1].summary, setups[0].rows[0].summary);
  assert.equal(prompts[0].rows[1].n, 3);
  const c = structuredClone(campaign);
  c.setups.push({ id: 'on', name: 'ON' });
  c.runs.push({ arm: 'on', turns: [turn('P0', 10),turn('P1',20)] });
  const selected = makeBoxplotSeries(c, 'prompt-cost', 'on', 'marginal', false);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].rows.length, 1);
  assert.deepEqual(selected[0].rows[0].summary, [.2,.2,.2,.2,.2]);
  c.runs[3].turns[1].estimatedCost = null;
  assert.equal(makeBoxplotSeries(c,'prompt-cost','on','marginal',false)[0].rows[0].summary, null);
});

test('setup colors stay stable when a configuration is isolated or reordered', async () => {
  const source = readFileSync(new URL('../src/chartColors.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const { setupStyle } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  assert.equal(setupStyle('off').color, '#24735b');
  assert.equal(setupStyle('on').color, '#bc9251');
  assert.equal(setupStyle('on-no-routing').color, '#788cb2');
  for (const id of ['off','on','on-no-routing']) {
    assert.deepEqual(setupStyle(id,0), setupStyle(id,2));
  }
});

test('consumption changes compare per-run totals to OFF in requested order, with signed increases', () => {
  const c = structuredClone(campaign);
  for (const [arm, factor] of [['on-no-routing', .5], ['on', 2]]) {
    c.setups.push({ id: arm, name: arm });
    for (const r of campaign.runs) c.runs.push({ ...structuredClone(r), arm, turns: r.turns.map(t => ({ ...t, tokens: t.tokens*factor, estimatedCost: t.estimatedCost*factor })) });
  }
  const rows = makeConsumptionComparison(c, 'median', 'all');
  assert.deepEqual(rows.map(r => r.arm), ['on-no-routing', 'on']);
  assert.equal(rows[0].tokenChange, -50);
  assert.equal(rows[0].costChange, -50);
  assert.equal(rows[1].tokenChange, 100);
  assert.equal(rows[1].costChange, 100);
  c.runs.find(r => r.arm === 'on').turns[0].estimatedCost = null;
  assert.equal(makeConsumptionComparison(c,'median','all')[1].costChange, null);
  assert.equal(makeConsumptionComparison(c,'median','marginal')[1].costChange, 100);
});

test('consumption changes stay unavailable when baseline is zero or a comparison setup is missing', () => {
  const c = structuredClone(campaign);
  c.runs.forEach(r => r.turns.forEach(t => { t.tokens = 0; t.estimatedCost = 0; }));
  const rows = makeConsumptionComparison(c,'mean','all');
  assert.ok(rows.every(r => r.tokenChange === null && r.costChange === null));
});
