const { test } = require('node:test');
const assert = require('node:assert/strict');
const { positiveInteger, loadSuite, validateExport, summarizeTurn } = require('./core.cjs');

const request = (text = 'P0', id = 'r0') => ({
  requestId: id, message: { text }, modelId: 'copilot/model',
  modelState: { value: 1, completedAt: 1234 },
  response: [{ value: 'Audit completed.' }],
});

test('rejects invalid run counts and timeouts', () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, '', 'five']) assert.throws(() => positiveInteger(value, 'Runs'));
  assert.equal(positiveInteger('5', 'Runs'), 5);
});

test('the copied audit suite contains all eight distinct prompts', () => {
  const suite = loadSuite(__dirname);
  assert.deepEqual(suite.map(p => p.id), ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
  assert.equal(new Set(suite.map(p => p.sha256)).size, 8);
});

test('accepts consecutive turns in the same conversation', () => {
  const first = request(); const second = request('P1', 'r1');
  assert.equal(validateExport({ requests: [first, second] }, ['P0', 'P1'], 'copilot/model', ['r0']), second);
});

test('rejects interrupted, failed, empty or unknown export states', () => {
  for (const value of [0, 2, 3, 4, undefined]) {
    const r = request(); r.modelState.value = value;
    assert.throws(() => validateExport({ requests: [r] }, ['P0'], 'copilot/model'));
  }
  for (const patch of [{ result: { errorDetails: { message: 'quota' } } }, { response: [] }, { modelState: { value: 1 } }]) {
    assert.throws(() => validateExport({ requests: [{ ...request(), ...patch }] }, ['P0'], 'copilot/model'));
  }
});

test('rejects wrong chat, missing turn, model changes and replaced history', () => {
  assert.throws(() => validateExport({ requests: [request('other')] }, ['P0'], 'copilot/model'));
  assert.throws(() => validateExport({ requests: [] }, ['P0'], 'copilot/model'));
  assert.throws(() => validateExport({ requests: [request()] }, ['P0'], 'another-model'));
  assert.throws(() => validateExport({ requests: [request()] }, ['P0'], 'copilot/model', ['replaced']));
});

test('preserves raw usage without inventing totals or validating token comparability', () => {
  const r = { ...request(), promptTokens: 500, completionTokens: 30 };
  const turn = summarizeTurn({ id: 'P0' }, r, 100);
  assert.deepEqual(turn.rawUsage, { promptTokens: 500, completionTokens: 30 });
  assert.equal(turn.metricsComparable, false);
  assert.equal(turn.calls, undefined);
});
