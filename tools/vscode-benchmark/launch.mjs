import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import core from './core.cjs';

const extension = path.dirname(fileURLToPath(import.meta.url));
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const options = {};
for (const arg of process.argv.slice(2)) {
  const match = /^--(arm|runs|timeout-ms)=(.+)$/.exec(arg);
  if (!match) throw Error(`Unknown option ${arg}. Use --arm=off|on --runs=5 --timeout-ms=900000`);
  options[match[1]] = match[2];
}
const branch = core.git(root, 'branch', '--show-current');
const arm = { 'vscode-gthb-copilot-off': 'off', 'vscode-gthb-copilot-on': 'on' }[branch];
if (!arm || (options.arm && options.arm !== arm)) throw Error('Branch does not match --arm');
const config = { arm, runs: core.positiveInteger(options.runs ?? 5, 'Runs'), timeoutMs: core.positiveInteger(options['timeout-ms'] ?? 900000, 'Timeout') };
fs.mkdirSync(path.join(root, '.bench-work'), { recursive: true });
fs.writeFileSync(path.join(root, '.bench-work', 'vscode-launch.json'), JSON.stringify(config, null, 2));
const args = [`--extensionDevelopmentPath=${extension}`, '--new-window', root];
// Invoke the Windows .cmd via its known CLI script, without shell interpolation of paths.
let child;
if (process.platform === 'win32') {
  const where = execFileSync('where.exe', ['code'], { encoding: 'utf8' }).trim().split(/\r?\n/);
  const cmd = where.find(file => file.toLowerCase().endsWith('.cmd'));
  if (!cmd) throw Error('VS Code code.cmd not found in PATH');
  const install = path.resolve(path.dirname(cmd), '..');
  const cliCandidates = [path.join(install, 'resources', 'app', 'out', 'cli.js')];
  for (const entry of fs.readdirSync(install, { withFileTypes: true })) {
    if (entry.isDirectory()) cliCandidates.push(path.join(install, entry.name, 'resources', 'app', 'out', 'cli.js'));
  }
  const cli = cliCandidates.find(file => fs.existsSync(file));
  if (!cli) throw Error('VS Code CLI script not found');
  child = spawn(path.join(install, 'Code.exe'), [cli, ...args], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: 'inherit' });
} else {
  child = spawn('code', args, { stdio: 'inherit' });
}
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { if (code) process.exitCode = code; });
console.log(`Prepared ${config.runs} runs (${arm}). In the new VS Code window: Ctrl+Shift+P > Traccar Benchmark: Start Campaign.`);
