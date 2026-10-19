import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { argsOf, inside, extractTurns, tokens, capture, retryGuard, benchmarkEnv, resetRunResults, normalizeBenchmarkConfig, normalizeRuntime, fingerprint, contextModeRouting } from './bench-lib.mjs';
import { campaignFirstArm, runArmOrder } from './bench-lib.mjs';

test('three configurations rotate through every position without duplicate runs', () => {
  const arms = ['off', 'on', 'on-no-routing'];
  for (const first of ['off', 'on']) {
    const orders = [0, 1, 2].map(index => runArmOrder(first, index, arms));
    assert.equal(orders[0][0], first);
    for (const order of orders) assert.deepEqual([...order].sort(), [...arms].sort());
    for (let position = 0; position < arms.length; position++) {
      assert.equal(new Set(orders.map(order => order[position])).size, arms.length);
    }
    assert.deepEqual(runArmOrder(first, 3, arms), orders[0]);
  }
});

test('campaign starts alternate across launches, independently of pair count', () => {
  assert.equal(campaignFirstArm(null), 'off');
  assert.equal(campaignFirstArm({ runs: [1, 2] }), 'on');
  assert.equal(campaignFirstArm({ runs: [0] }), 'off');
  for (const runs of [[0], [1], [1, 2], [1, 2, 3]]) {
    let previous;
    for (const expected of ['off', 'on', 'off', 'on']) {
      const firstArm = campaignFirstArm(previous);
      assert.equal(firstArm, expected);
      assert.deepEqual(runArmOrder(firstArm, 0), firstArm === 'off' ? ['off', 'on'] : ['on', 'off']);
      assert.deepEqual(runArmOrder(firstArm, 1), runArmOrder(firstArm, 0).toReversed());
      assert.deepEqual(runArmOrder(firstArm, 2), runArmOrder(firstArm, 0));
      previous = { firstArm, runs };
    }
  }
});

test('plugin and routing instructions form the treatment; other differences stay visible', (t) => {
  const off = { instructions: ['.opencode/instructions.md'] };
  const on = { instructions: [...off.instructions, contextModeRouting], plugin: ['context-mode'] };
  assert.deepEqual(normalizeBenchmarkConfig(on), normalizeBenchmarkConfig(off));
  assert.equal(on.instructions.length, 2);
  assert.deepEqual(normalizeRuntime(on, { tools: { read: true, context_mode_ctx_execute: true } }),
    normalizeRuntime(off, { tools: { read: true } }));
  for (const changed of [
    { ...on, instructions: [...on.instructions, '.opencode/other.md'] },
    { ...on, model: 'other/model' },
    { ...on, plugin: [...on.plugin, 'other-plugin'] },
  ]) assert.notDeepEqual(normalizeBenchmarkConfig(changed), normalizeBenchmarkConfig(off));

  const repo = mkdtempSync(join(tmpdir(), 'traccar-routing-'));
  mkdirSync(join(repo, '.opencode'));
  writeFileSync(join(repo, '.opencode/instructions.md'), 'common');
  writeFileSync(join(repo, 'opencode.json'), JSON.stringify(off));
  writeFileSync(join(repo, 'app.js'), 'original');
  const env = { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: repo.replaceAll('\\', '/') };
  // Git checks Windows ownership even for temporary repositories created here.
  for (const key of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) {
    const previous = process.env[key];
    process.env[key] = env[key];
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, stdio: 'pipe' });
  git('init'); git('add', '.');
  const suite = { prompts: [] };
  const before = fingerprint(repo, off, suite, repo);
  writeFileSync(join(repo, contextModeRouting), 'routing v1');
  writeFileSync(join(repo, 'opencode.json'), JSON.stringify(on));
  git('add', '.');
  const after = fingerprint(repo, on, suite, repo);
  assert.equal(after.applicationSha, before.applicationSha);
  assert.equal(after.configSha, before.configSha);
  assert.equal(before.contextModeRoutingSha, null);
  assert.ok(after.contextModeRoutingSha);
  writeFileSync(join(repo, contextModeRouting), 'routing v2');
  assert.notEqual(fingerprint(repo, on, suite, repo).contextModeRoutingSha, after.contextModeRoutingSha);
  writeFileSync(join(repo, 'app.js'), 'changed');
  assert.notEqual(fingerprint(repo, on, suite, repo).applicationSha, before.applicationSha);
});
test('overwrite removes all traces of the selected run and preserves other numbers', () => {
  const root = mkdtempSync(join(tmpdir(), 'traccar-overwrite-'));
  for (const name of ['run-1.json', 'run-1.export.json', 'run-1.P7.process.json', 'run-10.json', 'run-2.json', 'notes.txt']) writeFileSync(join(root, name), 'old');
  resetRunResults(root, 1);
  for (const name of ['run-1.json', 'run-1.export.json', 'run-1.P7.process.json']) assert.equal(existsSync(join(root, name)), false);
  for (const name of ['run-10.json', 'run-2.json', 'notes.txt']) assert.equal(readFileSync(join(root, name), 'utf8'), 'old');
  assert.throws(() => resetRunResults(root, '../1'));
});
const user = () => ({ info: { role: 'user' }, parts: [] });
const assistant = (finish = 'stop', parts = [{ type: 'text', text: 'Audit terminé' }], extra = {}) => ({ info: {
  role: 'assistant', finish, providerID: 'test', modelID: 'model', variant: 'medium', time: { completed: 123 }, tokens: { total: 69, input: 10, output: 20, reasoning: 7, cache: { read: 30, write: 2 } }, cost: .12, ...extra }, parts });
test('arguments preserve = and Windows path boundaries', () => {
  assert.equal(argsOf(['--model=a=b']).model, 'a=b');
  const root = 'C:\\Users\\name\\OneDrive - Accenture\\project';
  assert.equal(inside(root, 'src\\main.js'), root + '\\src\\main.js');
  for (const path of ['..\\project-evil\\file', 'C:\\Users\\name.name\\file', 'D:\\file']) assert.throws(() => inside(root, path));
});
test('only a final stop with text, completion and settled tools is valid', () => {
  for (const finish of ['tool-calls', 'length', 'error', 'cancelled', undefined]) {
    const m = assistant(); m.info.finish = finish;
    assert.equal(extractTurns({ messages: [user(), m] })[0].valid, false);
  }
  assert.equal(extractTurns({ messages: [user(), assistant()] })[0].valid, true);
  assert.equal(extractTurns({ messages: [user(), assistant('stop', [])] })[0].valid, false);
  assert.equal(extractTurns({ messages: [user(), assistant('stop', [{ type: 'tool', tool: 'read', state: { status: 'running' } }, { type: 'text', text: 'done' }])] })[0].valid, false);
});
test('permission errors can recover, otherwise downstream context is invalid', () => {
  for (const tool of ['read', 'grep']) {
    const denied = assistant('tool-calls', [{ type: 'tool', tool, state: { status: 'error', input: { path: 'bad' }, error: 'The user rejected permission to use this specific tool call.', time: { end: 123 } } }]);
    const turns = extractTurns({ messages: [user(), denied, user(), assistant()] });
    assert.equal(turns[0].permissionEvents.length, 1); assert.equal(turns[0].valid, false);
    assert.equal(turns[1].valid, true); assert.equal(turns[1].comparable, false); assert.equal(turns[1].contextDiverged, true);
    assert.equal(extractTurns({ messages: [user(), denied, assistant()] })[0].valid, true);
  }
});
test('ctx success/failure and raw costs/tokens remain distinct', () => {
  const parts = ['completed', 'error'].map(status => ({ type: 'tool', tool: 'context-mode_ctx_execute', state: { status } }));
  const t = extractTurns({ messages: [user(), assistant('tool-calls', parts), assistant()] })[0];
  assert.equal(t.ctxToolCalls, 2); assert.equal(t.ctxSucceeded, 1); assert.equal(t.ctxFailed, 1);
  assert.equal(t.ctxProcessingSucceeded, 1);
  assert.equal(t.cost, .24); assert.equal(t.calls.length, 2); assert.equal(tokens(t), 138); assert.equal(t.reasoning, 14);
  const included = structuredClone(t); included.calls.forEach(c => { c.tokens.total = 62; });
  assert.equal(tokens(included), 124);
  included.calls[0].tokens.total = 999; assert.throws(() => tokens(included));
});
test('permission overlay denies external paths and retry guard is bounded', () => {
  const env = JSON.parse(benchmarkEnv().OPENCODE_CONFIG_CONTENT);
  assert.equal(env.permission.external_directory, 'deny'); assert.equal(env.agent.build.permission.edit, 'deny');
  const guard = retryGuard();
  for (let n = 0; n < 3; n++) {
    const event = { part: { id: String(n), type: 'tool', tool: 'read', state: { status: 'error', error: 'permission denied' } } };
    assert.equal(guard(event), n === 2 ? 'retry-limit:read:permission' : null);
    assert.equal(guard(event), null);
  }
  guard({ part: { type: 'tool', tool: 'read', state: { status: 'completed' } } });
  assert.equal(guard({ part: { id: 'fresh', type: 'tool', tool: 'read', state: { status: 'error', error: 'permission denied' } } }), null);
});
test('process timeout terminates and records timeout', async () => {
  const r = await capture(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 });
  assert.equal(r.timedOut, true); assert.notEqual(r.code, 0);
});

test('runner stops after incomplete P0 and saves export; successful run reaches P7', () => {
  const base = mkdtempSync(join(tmpdir(), 'traccar-test-')), repo = join(base, 'repo'), tools = join(base, 'tools');
  mkdirSync(join(repo, '.opencode'), { recursive: true }); mkdirSync(tools);
  writeFileSync(join(repo, '.opencode/instructions.md'), '# Définitions');
  writeFileSync(join(repo, 'opencode.json'), JSON.stringify({ instructions: ['.opencode/instructions.md'] }));
  const testEnv = { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: repo.replaceAll('\\', '/') };
  const git = (...args) => execFileSync('git', args, { cwd: repo, env: testEnv, stdio: 'pipe' });
  git('init'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture');
  for (const f of ['run.mjs', 'bench-lib.mjs', 'prompts.json', 'prompts']) cpSync(new URL(f, import.meta.url), join(tools, f), { recursive: true });
  const fake = join(base, 'fake.mjs');
  writeFileSync(fake, `import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const cmd=process.argv[1];
if(cmd?.endsWith('debug')) { console.log(JSON.stringify(process.argv[2]==='config'?{plugin:[],instructions:['.opencode/instructions.md']}:{tools:{read:true}})); process.exit(0); }
if(cmd?.endsWith('run')||cmd?.endsWith('export')) {
 const file=process.env.FAKE_STATE;
 let data=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{messages:[]};
 if(cmd.endsWith('run')) {
 data.messages.push({info:{role:'user'},parts:[]},{info:{role:'assistant',finish:process.env.FAKE_STOP==='yes'?'stop':'tool-calls',time:{completed:123},tokens:{total:3,input:1,output:2},cost:0},parts:[{type:'text',text:'Done'}]});
 writeFileSync(file,JSON.stringify(data)); console.log(JSON.stringify({sessionID:'test-session',type:'step_finish'}));
 }else console.log(JSON.stringify(data)); process.exit(0);
}`);
  for (const stop of ['no', 'yes']) {
    const results = join(base, stop), state = join(base, stop + '.state.json');
    const r = spawnSync(process.execPath, [join(tools, 'run.mjs'), '--arm=off', `--dir=${repo}`, '--model=test/model', `--results=${results}`], {
      env: { ...testEnv, OPENCODE_BIN: process.execPath, NODE_OPTIONS: `--import=${pathToFileURL(fake).href}`, FAKE_STATE: state, FAKE_STOP: stop }, encoding: 'utf8' });
    assert.equal(r.status, stop === 'yes' ? 0 : 2, r.stderr);
    const summary = JSON.parse(readFileSync(join(results, 'off/run-1.json'), 'utf8'));
    assert.equal(summary.valid, stop === 'yes'); assert.equal(summary.turns.length, stop === 'yes' ? 8 : 1);
  }
});

test('comparison reports paired complete runs and rejects an interrupted branch', () => {
  const root = mkdtempSync(join(tmpdir(), 'traccar-compare-'));
  const turn = extractTurns({ messages: [user(), assistant()] })[0];
  for (const arm of ['off', 'on']) {
    mkdirSync(join(root, arm));
    for (const run of [1, 2]) {
      const r = { schemaVersion: 2, valid: true, suite: 'fixture', arm, run, model: 'test/model', variant: 'medium', ocVersion: 'fixture',
        commit: arm, sessionId: `${arm}-${run}`, pluginIdentity: { version: 'fixture' }, workingTreeChanged: false, expectedPrompts: [{ id: 'P0' }],
        turns: [{ ...turn, id: 'P0', measure: 'marginal', durationMs: 1000, ctxProcessingSucceeded: arm === 'on' ? 1 : 0, ctxSucceeded: arm === 'on' ? 1 : 0, ctxToolCalls: arm === 'on' ? 1 : 0 }] };
      for (const key of ['commonSha', 'applicationSha', 'configSha', 'suiteSha', 'runtimeSha', 'protocol', 'environmentSha', 'cachePolicy', 'timeoutMs']) r[key] = 'same';
      writeFileSync(join(root, arm, `run-${run}.json`), JSON.stringify(r));
    }
  }
  // fileURLToPath preserves spaces and Windows drive names.
  const invoke = () => spawnSync(process.execPath, [fileURLToPath(new URL('./compare.mjs', import.meta.url)), `--results=${root}`], { encoding: 'utf8' });
  const good = invoke(); assert.equal(good.status, 0, good.stderr);
  const summary = JSON.parse(readFileSync(join(root, 'compare.json'), 'utf8'));
  assert.equal(summary.S.off.marginal.med, 69); assert.equal(summary.S.off.n, 2); assert.equal(summary.ctxUsed, true);
  assert.equal(existsSync(join(root, 'summary.json')), false);
  assert.equal(existsSync(join(root, 'summary.md')), false);
  cpSync(join(root, 'on'), join(root, 'on-no-routing'), { recursive: true });
  for (const run of [1, 2]) {
    const file = join(root, 'on-no-routing', `run-${run}.json`);
    const result = JSON.parse(readFileSync(file, 'utf8'));
    result.arm = 'on-no-routing'; result.commit = 'no-routing'; result.sessionId = `no-routing-${run}`;
    writeFileSync(file, JSON.stringify(result));
  }
  const withoutRouting = spawnSync(process.execPath, [fileURLToPath(new URL('./compare.mjs', import.meta.url)), `--results=${root}`, '--on=on-no-routing'], { encoding: 'utf8' });
  assert.equal(withoutRouting.status, 0, withoutRouting.stderr);
  const noRoutingSummary = JSON.parse(readFileSync(join(root, 'compare-no-routing.json'), 'utf8'));
  assert.equal(noRoutingSummary.onArm, 'on-no-routing');
  assert.equal(noRoutingSummary.S.on.n, 2);
  assert.equal(existsSync(join(root, 'validity-no-routing.json')), true);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'compare.json'), 'utf8')), summary);
  const badFile = join(root, 'on/run-2.json'), bad = JSON.parse(readFileSync(badFile, 'utf8'));
  bad.valid = false; bad.turns[0].valid = false; writeFileSync(badFile, JSON.stringify(bad));
  assert.notEqual(invoke().status, 0);
  assert.equal(JSON.parse(readFileSync(join(root, 'compare.json'), 'utf8')).valid, false);
});

test('historical audit propagates divergence and refresh cannot rehabilitate an invalid run', () => {
  const root = mkdtempSync(join(tmpdir(), 'traccar-audit-'));
  const raw = JSON.stringify({ messages: [user(), assistant('tool-calls'), user(), assistant()] });
  const file = join(root, 'run-1.export.json'); writeFileSync(file, raw);
  const turns = extractTurns(JSON.parse(raw)).map((t, i) => ({ ...t, id: `P${i}`, name: `P${i}`, measure: 'marginal', cost: 999 }));
  writeFileSync(join(root, 'run-1.json'), JSON.stringify({ schemaVersion: 2, valid: false, turns, expectedPrompts: Array(8).fill({}) }));
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./audit.mjs', import.meta.url)), `--results=${root}`, '--refresh-metrics'], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  const audit = JSON.parse(readFileSync(join(root, 'audit.json'), 'utf8'))[0];
  assert.equal(audit.turns[0].valid, false); assert.equal(audit.turns[1].valid, true); assert.equal(audit.turns[1].comparable, false); assert.equal(audit.turns[7].reason, 'missing');
  const refreshed = JSON.parse(readFileSync(join(root, 'run-1.json'), 'utf8'));
  assert.equal(refreshed.valid, false); assert.equal(refreshed.turns[0].cost, .12); assert.equal(readFileSync(file, 'utf8'), raw);
});
