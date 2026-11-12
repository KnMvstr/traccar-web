const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const core = require('./core.cjs');

async function simulate(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'traccar-benchmark-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const handlers = new Map();
  const events = [];
  const errors = [];
  let run = 0;
  let requests = [];
  const commands = ['workbench.action.chat.open', 'workbench.action.chat.newLocalChat', 'workbench.action.chat.export'];
  const vscode = {
    version: '1.146.0',
    workspace: { isTrusted: true, workspaceFolders: [{ uri: { scheme: 'file', fsPath: root } }] },
    lm: { selectChatModels: async () => [{ id: 'model', name: 'Model', vendor: 'copilot' }] },
    Uri: { file: file => file },
    ProgressLocation: { Notification: 1 },
    window: {
      showInputBox: async () => '2', showQuickPick: async items => items[0],
      showErrorMessage: async message => errors.push(message),
      showInformationMessage: async (_, ...buttons) => buttons.length && options.finishApproval ? 'Réponse terminée' : undefined,
      createOutputChannel: () => ({ show() {}, appendLine() {} }),
      withProgress: async (_, callback) => callback({ report() {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    },
    commands: {
      getCommands: async () => commands,
      registerCommand: (name, fn) => { handlers.set(name, fn); return { dispose() {} }; },
      executeCommand: async (name, args) => {
        if (name === 'workbench.action.chat.newLocalChat') { run++; requests = []; events.push(`new:${run}`); }
        if (name === 'workbench.action.chat.open' && args.query) {
          events.push(`send:${run}:${requests.length + 1}`);
          requests.push({ requestId: `r${run}-${requests.length}`, message: { text: args.query }, modelId: 'copilot/model',
            response: [{ value: 'Done' }], modelState: { value: 1, completedAt: Date.now() } });
          if (options.approval) return { type: 'confirmation', kind: 'toolInvocation' };
          if (options.cancelled) requests.at(-1).modelState.value = 2;
          return {};
        }
        if (name === 'workbench.action.chat.export') fs.writeFileSync(args, JSON.stringify({ requests }));
      },
    },
  };
  const sandbox = {
    require: name => name === 'vscode' ? vscode : name === './core.cjs' ? {
      ...core,
      git: (_, ...args) => args[0] === 'branch' ? 'vscode-gthb-copilot-off' : args[0] === 'rev-parse' ? 'commit' : '',
      loadSuite: () => [{ id: 'P0', text: 'Inventory' }, { id: 'P1', text: 'Audit' }],
    } : require(name),
    module: { exports: {} }, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'extension.cjs'), 'utf8'), sandbox);
  sandbox.module.exports.activate({ extensionPath: __dirname, extension: { packageJSON: { version: 'test' } }, subscriptions: [] });
  await handlers.get('traccarBenchmark.start')();
  const campaignRoot = path.join(root, '.bench-work', 'vscode-copilot');
  const stamp = fs.readdirSync(campaignRoot)[0];
  const campaign = JSON.parse(fs.readFileSync(path.join(campaignRoot, stamp, 'off', 'campaign.json')));
  return { events, campaign, errors };
}

test('two runs open separate conversations and complete each ordered prompt', async t => {
  const { events, campaign, errors } = await simulate(t);
  assert.deepEqual(events, ['new:1', 'send:1:1', 'send:1:2', 'new:2', 'send:2:1', 'send:2:2']);
  assert.equal(campaign.complete, true);
  assert.equal(campaign.executionValid, true);
  assert.equal(campaign.metricsComparable, false);
  assert.equal(campaign.runs.length, 2);
  assert.deepEqual(errors, []);
});

test('pending approval stops before the next prompt and preserves an invalid campaign', async t => {
  const { events, campaign, errors } = await simulate(t, { approval: true });
  assert.deepEqual(events, ['new:1', 'send:1:1']);
  assert.equal(campaign.complete, false);
  assert.equal(campaign.executionValid, false);
  assert.match(errors[0], /Manual approval wait/);
});

test('manual approval continues the same turn without replaying it or creating a new chat', async t => {
  const { events, campaign, errors } = await simulate(t, { approval: true, finishApproval: true });
  assert.deepEqual(events, ['new:1', 'send:1:1', 'send:1:2', 'new:2', 'send:2:1', 'send:2:2']);
  assert.equal(campaign.complete, true);
  assert.deepEqual(errors, []);
  assert.equal(typeof campaign.runs[0].turns[0].manualApprovalWaitMs, 'number');
});

test('cancelled response does not start the next prompt or mark the campaign complete', async t => {
  const { events, campaign, errors } = await simulate(t, { cancelled: true });
  assert.deepEqual(events, ['new:1', 'send:1:1']);
  assert.equal(campaign.complete, false);
  assert.match(errors[0], /not successfully completed/);
});
