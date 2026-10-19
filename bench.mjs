#!/usr/bin/env node
// Usage : node bench.mjs --model=github-copilot/gpt-5.6-luna [--runs=5] [--pilot]
// À lancer depuis le dépôt, sur la branche benchmark/opencode-runner.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { argsOf, stable, promptFile, resetRunResults, normalizeBenchmarkConfig, contextModeRouting, benchmarkExcludedFiles, campaignFirstArm, runArmOrder } from './bench-lib.mjs';

const a = argsOf();
const repo = resolve(a.repo ?? dirname(fileURLToPath(import.meta.url)));
const work = resolve(repo, process.env.BENCH_WORK ?? '.bench-work');
const RUNNER = a.runner ?? "benchmark/opencode-runner";
const OFF = a.off ?? "benchmark/opencode-off";
const ON = a.on ?? "benchmark/opencode-on-plus-routing";
const branches = { off: OFF, on: ON, 'on-no-routing': a['on-no-routing'] ?? 'benchmark/opencode-on-no-routing' };
const arms = Object.keys(branches);
const armOrder = (first, index) => runArmOrder(first, index, arms);
const model = a.model;
const variant = a.variant;
const pilot = "pilot" in a;
if (!model) throw new Error('--model explicite requis');
if (!Number.isInteger(Number(a.runs ?? 5)) || Number(a.runs ?? 5) < 1) throw new Error('--runs invalide');
const runs = pilot ? [0] : Array.from({ length: Number(a.runs ?? 5) }, (_, i) => i + 1);

const g = (...args) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const show = (branch, path) => {
  try {
    return execFileSync("git", ["show", `${branch}:${path}`], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
    });
  } catch { return null; }
};
const die = (m) => { console.error(`BENCH: ${m}`); process.exit(1); };

// ---------- Contrôles avant de toucher à quoi que ce soit ----------
if (g("rev-parse", "--abbrev-ref", "HEAD") !== RUNNER) die(`lancez ce script depuis la branche ${RUNNER}`);
// Le runner peut être modifié : les branches mesurées sont exécutées dans un worktree isolé.

const hashes = {};
const trees = {}, configs = {};
for (const [arm, branch] of Object.entries(branches)) {
  const cfgBuf = show(branch, "opencode.json");
  if (!cfgBuf) die(`${branch}: opencode.json introuvable`);
  if (cfgBuf[0] === 0xef) die(`${branch}: opencode.json commence par un BOM`);
  const cfg = JSON.parse(cfgBuf.toString("utf8"));
  configs[arm] = normalizeBenchmarkConfig(cfg);
  const routing = (cfg.instructions ?? []).includes(contextModeRouting);
  if (routing !== (arm === 'on')) die(`${branch}: routage context-mode incohérent pour ${arm}`);
  trees[arm] = g('ls-tree', '-r', branch).split('\n').filter(line => !benchmarkExcludedFiles.includes(line.split('\t')[1])).join('\n');
  if ((cfg.instructions ?? []).includes(contextModeRouting)) {
    if (arm === 'off') die(`${branch}: règles context-mode référencées dans OFF`);
    if (!show(branch, contextModeRouting)) die(`${branch}: ${contextModeRouting} introuvable`);
  }
  const plugin = (cfg.plugin ?? []).some((p) => String(p).includes("context-mode"));
  if (arm !== "off" && !plugin) die(`${branch}: plugin context-mode absent`);
  if (arm === "off" && plugin) die(`${branch}: plugin context-mode présent`);
  const ins = show(branch, ".opencode/instructions.md");
  if (!ins) die(`${branch}: .opencode/instructions.md introuvable`);
  hashes[arm] = createHash("sha256").update(ins).digest("hex");
}
for (const arm of arms.filter(arm => arm !== 'off')) {
  if (hashes.off !== hashes[arm]) die(`instructions.md différent entre OFF et ${arm}`);
  if (trees.off !== trees[arm]) {
    const differences = g('diff', '--name-status', branches.off, branches[arm], '--', '.', ...benchmarkExcludedFiles.map(file => `:!${file}`));
    die(`fichiers versionnés différents entre OFF et ${arm} (hors ${benchmarkExcludedFiles.join(', ')})\n${differences}`);
  }
  if (JSON.stringify(stable(configs.off)) !== JSON.stringify(stable(configs[arm]))) die(`configuration ${arm} différente hors plugin et règles de routage context-mode`);
}

// ---------- Copie immuable par campagne, hors du worktree mesuré ----------
const campaign = join(work, new Date().toISOString().replace(/[:.]/g, '-'));
const tools = join(campaign, 'tools');
mkdirSync(tools, { recursive: true });
const toolHashes = {};
for (const f of ['bench-lib.mjs', 'diagnose.mjs', 'audit.mjs', "run.mjs", "compare.mjs", "prompts.json"]) {
  cpSync(join(repo, f), join(tools, f));
  toolHashes[f] = createHash('sha256').update(readFileSync(join(tools, f))).digest('hex');
}
cpSync(join(repo, "prompts"), join(tools, "prompts"), { recursive: true });
const suite = JSON.parse(readFileSync(join(tools, "prompts.json"), "utf8"));
for (const p of suite.prompts) {
  promptFile(tools, p.file);
}

// ---------- Exécution ----------
const node = process.execPath;
const results = join(repo, 'results');
mkdirSync(results, { recursive: true });
const previousManifest = join(results, 'manifest.json');
const firstArm = campaignFirstArm(existsSync(previousManifest) ? JSON.parse(readFileSync(previousManifest, 'utf8')) : null);
// Remove reports from previous analyses before replacing their source data.
for (const file of ['summary.json', 'summary.md', 'compare.json', 'validity.json', 'compare-no-routing.json', 'validity-no-routing.json']) {
  rmSync(join(results, file), { force: true });
}
writeFileSync(join(results, 'compare.json'), JSON.stringify({ valid: false, reason: pilot ? 'pilot-excluded' : 'campaign-in-progress' }, null, 2));
writeFileSync(join(results, 'compare-no-routing.json'), JSON.stringify({ valid: false, reason: pilot ? 'pilot-excluded' : 'campaign-in-progress' }, null, 2));
for (const arm of arms) {
  mkdirSync(join(results, arm), { recursive: true });
  for (const n of runs) {
    resetRunResults(join(results, arm), n);
  }
}
const project = join(campaign, 'project');
const pg = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const refs = Object.fromEntries(Object.entries(branches).map(([arm, branch]) => [arm, g('rev-parse', branch)]));
const manifest = JSON.stringify({ refs, branches, model, variant, runs, firstArm, toolHashes, results, campaign, createdAt: new Date().toISOString() }, null, 2);
writeFileSync(join(campaign, 'manifest.json'), manifest);
writeFileSync(join(results, 'manifest.json'), manifest);
g('worktree', 'add', '--detach', project, refs.on);
console.error(`Campagne : ${campaign}`);
console.error(`Ordre initial : ${armOrder(firstArm, 0).join(' → ').toUpperCase()}`);
try {
  for (const arm of arms.filter(arm => arm !== 'off')) {
    pg('switch', '--detach', refs[arm]);
    const diagnostic = spawnSync(node, ['diagnose.mjs', `--dir=${project}`, `--model=${model}`, `--results=${arm === 'on' ? results : join(results, arm)}`,
      ...(variant ? [`--variant=${variant}`] : []), ...(a['timeout-ms'] ? [`--timeout-ms=${a['timeout-ms']}`] : [])], { cwd: tools, stdio: 'inherit' });
    if (diagnostic.status !== 0) throw new Error('Diagnostic ctx préalable non concluant ; consulter les traces');
  }
  for (const [index, n] of runs.entries()) {
    for (const arm of armOrder(firstArm, index)) {
      const branch = branches[arm];
      console.error(`\n=== run ${n} · ${arm} · ${branch} ===`);
      if (pg('status', '--porcelain')) throw new Error('Worktree modifié : conservé pour inspection');
      pg('switch', '--detach', refs[arm]);
      const r = spawnSync(
        node,
        ["run.mjs", `--arm=${arm}`, `--dir=${project}`, `--run=${n}`, ...(model ? [`--model=${model}`] : []),
        ...(variant ? [`--variant=${variant}`] : []), `--results=${results}`,
        ...(a['timeout-ms'] ? [`--timeout-ms=${a['timeout-ms']}`] : [])],
        { cwd: tools, stdio: "inherit" },
      );
      if (r.status !== 0) throw new Error(`run ${n} ${arm} en échec (code ${r.status})`);
    }
  }
  if (!pilot) {
    for (const arm of arms.filter(arm => arm !== 'off')) {
      const comparison = spawnSync(node, ['compare.mjs', `--results=${results}`, `--runs=${runs.join(',')}`, `--on=${arm}`], { cwd: tools, stdio: 'inherit' });
      if (comparison.status !== 0) throw new Error('Comparaison invalide ; consulter compare.json et validity.json');
    }
  }
} catch (error) {
  writeFileSync(join(results, 'compare.json'), JSON.stringify({ valid: false, reason: 'campaign-failed', error: error.message }, null, 2));
  writeFileSync(join(results, 'compare-no-routing.json'), JSON.stringify({ valid: false, reason: 'campaign-failed', error: error.message }, null, 2));
  throw error;
} finally {
  if (existsSync(results)) spawnSync(node, ['audit.mjs', `--results=${results}`], { cwd: tools, stdio: 'inherit' });
  // Sans --force : Git refuse de supprimer un worktree contenant des modifications.
  try { g('worktree', 'remove', project); } catch (error) {
    if (existsSync(project)) console.error(`Worktree conservé pour inspection : ${project}\n${error.message}`);
  }
}
console.error(`\nRésultats : ${results}`);
