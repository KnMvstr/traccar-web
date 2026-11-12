const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { positiveInteger, git, loadSuite, validateExport, summarizeTurn } = require('./core.cjs');

let active;
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

async function start(context, output) {
  if (active) throw Error('A campaign is already running');
  if (!vscode.workspace.isTrusted) throw Error('Open a trusted workspace first');
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length !== 1 || folders[0].uri.scheme !== 'file') throw Error('Open one local repository');
  const root = folders[0].uri.fsPath;
  const branch = git(root, 'branch', '--show-current');
  const arms = { 'vscode-gthb-copilot-off': 'off', 'vscode-gthb-copilot-on': 'on' };
  const arm = arms[branch];
  if (!arm) throw Error('Use vscode-gthb-copilot-off or vscode-gthb-copilot-on');
  if (git(root, 'status', '--porcelain', '--untracked-files=no')) throw Error('Commit tracked changes first');
  const configPath = path.join(root, '.bench-work', 'vscode-launch.json');
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  if (config.arm && config.arm !== arm) throw Error('Launch configuration arm does not match branch');
  const answer = await vscode.window.showInputBox({
    title: `Benchmark ${arm.toUpperCase()} — number of runs`, value: String(config.runs ?? 5),
    validateInput: value => { try { positiveInteger(value, 'Runs'); } catch (e) { return e.message; } },
  });
  if (answer === undefined) return;
  const runs = positiveInteger(answer, 'Runs');
  const timeoutMs = positiveInteger(config.timeoutMs ?? 900000, 'Timeout');
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  const selected = await vscode.window.showQuickPick(models.map(model => ({
    label: model.name, description: model.id, model,
  })), { title: 'Select the same explicit model for OFF and ON (no Auto)' });
  if (!selected) return;
  const model = selected.model;
  if (/\bauto\b/i.test(model.id)) throw Error('Auto model is not supported for controlled comparisons');
  const commands = await vscode.commands.getCommands(true);
  for (const command of ['workbench.action.chat.open', 'workbench.action.chat.newLocalChat', 'workbench.action.chat.export']) {
    if (!commands.includes(command)) throw Error(`VS Code command unavailable: ${command}`);
  }
  const prompts = loadSuite(context.extensionPath);
  if (!prompts.length) throw Error('Empty suite');
  const commit = git(root, 'rev-parse', 'HEAD');
  const folder = path.join(root, '.bench-work', 'vscode-copilot', new Date().toISOString().replace(/[:.]/g, '-'), arm);
  fs.mkdirSync(folder, { recursive: true });
  const token = { stopped: false };
  active = token;
  const manifest = {
    schemaVersion: 1, client: 'vscode-copilot-native-chat', vscodeVersion: vscode.version,
    extensionVersion: context.extension.packageJSON.version,
    arm, branch, commit, model: { id: model.id, name: model.name, vendor: model.vendor, family: model.family, version: model.version },
    runs, timeoutMs, createdAt: new Date().toISOString(),
    contextMode: { declaredByUser: arm === 'on', verified: false },
    prompts: prompts.map(({ text, ...p }) => p),
    caveat: 'Internal VS Code commands; raw usage is not validated as complete per-call token accounting.',
  };
  write(path.join(folder, 'manifest.json'), manifest);
  const campaign = { complete: false, executionValid: false, metricsComparable: false, runs: [] };
  let actualModel;
  const previousRunRequestIds = new Set();
  write(path.join(folder, 'campaign.json'), campaign);
  const assertState = () => {
    if (token.stopped) throw Error('Campaign stopped');
    if (git(root, 'rev-parse', 'HEAD') !== commit || git(root, 'branch', '--show-current') !== branch) throw Error('Branch or commit changed');
    if (git(root, 'status', '--porcelain', '--untracked-files=no')) throw Error('Tracked workspace files changed');
  };
  output.show(true);
  output.appendLine(`Campaign: ${folder}\nContext Mode declared ${arm.toUpperCase()}; configuration stays under your control.`);
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Benchmark Copilot ${arm.toUpperCase()}`, cancellable: true }, async (progress, cancellation) => {
      const sub = cancellation.onCancellationRequested(() => {
        token.stopped = true;
        void vscode.commands.executeCommand('workbench.action.chat.cancel');
      });
      try {
        for (let run = 1; run <= runs; run++) {
          assertState();
          await vscode.commands.executeCommand('workbench.action.chat.open', { mode: 'agent' });
          await vscode.commands.executeCommand('workbench.action.chat.newLocalChat');
          const result = { run, startedAt: new Date().toISOString(), turns: [], executionValid: false };
          campaign.runs.push(result);
          const expected = [];
          let requestIds = [];
          for (const prompt of prompts) {
            assertState();
            progress.report({ message: `Run ${run}/${runs} — ${prompt.id}` });
            output.appendLine(`Run ${run}/${runs} ${prompt.id}: sending`);
            const started = Date.now();
            // Common constraints are identical for OFF/ON, without requiring ctx tools.
            const query = `Benchmark d'audit en lecture seule. Travaille uniquement dans le dépôt courant. Ne modifie aucun fichier, ne crée aucun commit, ne lance aucun sous-agent. Ne lis pas .bench-work, results, tools/vscode-benchmark ni benchmark-web/dist. Termine cette étape puis attends la consigne suivante.\n\n${prompt.text}`;
            expected.push(query);
            let timer;
            let reply;
            try {
              reply = await Promise.race([
                vscode.commands.executeCommand('workbench.action.chat.open', {
                  mode: 'agent', query, blockOnResponse: true,
                  modelSelector: { vendor: model.vendor, id: model.id },
                }),
                new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Timeout at run ${run} ${prompt.id}`)), timeoutMs); }),
              ]);
            } finally { clearTimeout(timer); }
            const exportPath = path.join(folder, `run-${run}.${prompt.id}.export.json`);
            await vscode.commands.executeCommand('workbench.action.chat.export', vscode.Uri.file(exportPath));
            if (reply === undefined) throw Error('No blocking response returned: unsupported VS Code behavior');
            if (reply.type === 'confirmation') throw Error(`Approval required (${reply.kind}); campaign stopped. Review the chat and retry a new campaign.`);
            if (reply.errorDetails) throw Error('Copilot returned an error; inspect the raw export');
            const session = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
            // VS Code exports the internal model identifier (not always the public API id).
            if (!actualModel) actualModel = session.requests?.[0]?.modelId;
            const request = validateExport(session, expected, actualModel, requestIds);
            if (previousRunRequestIds.has(request.requestId)) throw Error('A run reused a previous conversation');
            requestIds = session.requests.map(r => r.requestId);
            assertState();
            result.turns.push(summarizeTurn(prompt, request, Date.now() - started));
            write(path.join(folder, `run-${run}.json`), result);
            write(path.join(folder, 'campaign.json'), campaign);
            output.appendLine(`Run ${run} ${prompt.id}: completed`);
          }
          result.executionValid = true;
          for (const id of requestIds) previousRunRequestIds.add(id);
          result.finishedAt = new Date().toISOString();
          write(path.join(folder, `run-${run}.json`), result);
          write(path.join(folder, 'campaign.json'), campaign);
        }
      } finally { sub.dispose(); }
    });
    assertState();
    campaign.complete = true;
    campaign.executionValid = true;
    output.appendLine('All runs completed. Raw metrics saved; token comparability remains unvalidated.');
    vscode.window.showInformationMessage(`Benchmark finished: ${runs} runs. Exports: ${folder}`);
  } catch (error) {
    campaign.error = error.message;
    await vscode.commands.executeCommand('workbench.action.chat.cancel').catch(() => {});
    output.appendLine(`STOPPED: ${error.message}`);
    throw error;
  } finally {
    campaign.finishedAt = new Date().toISOString();
    write(path.join(folder, 'campaign.json'), campaign);
    active = undefined;
  }
}

function activate(context) {
  const output = vscode.window.createOutputChannel('Traccar Benchmark');
  context.subscriptions.push(output,
    vscode.commands.registerCommand('traccarBenchmark.start', () => start(context, output).catch(error => vscode.window.showErrorMessage(`Benchmark: ${error.message}`))),
    vscode.commands.registerCommand('traccarBenchmark.stop', async () => {
      if (active) { active.stopped = true; await vscode.commands.executeCommand('workbench.action.chat.cancel'); }
    }),
  );
}
module.exports = { activate };
