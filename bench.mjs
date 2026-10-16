#!/usr/bin/env node
// Usage : node bench.mjs --model=github-copilot/gpt-5.6-luna [--runs=5] [--pilot]
// À lancer depuis le dépôt, sur la branche benchmark/runner.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { argsOf, stable, promptFile } from './bench-lib.mjs';

const a = argsOf();
const repo = resolve(a.repo ?? dirname(fileURLToPath(import.meta.url)));
const work = resolve(repo, process.env.BENCH_WORK ?? '.bench-work');
const RUNNER = a.runner ?? "benchmark/runner";
const OFF = a.off ?? "benchmark/opencode-off";
const ON = a.on ?? "benchmark/opencode-on";
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
for (const [arm, branch] of [["off", OFF], ["on", ON]]) {
  const cfgBuf = show(branch, "opencode.json");
  if (!cfgBuf) die(`${branch}: opencode.json introuvable`);
  if (cfgBuf[0] === 0xef) die(`${branch}: opencode.json commence par un BOM`);
  const cfg = JSON.parse(cfgBuf.toString("utf8"));
  configs[arm] = { ...cfg, plugin: (cfg.plugin ?? []).filter(p => !String(p).includes('context-mode')) };
  trees[arm] = g('ls-tree', '-r', branch).split('\n').filter(line => !line.endsWith('\topencode.json')).join('\n');
  const plugin = (cfg.plugin ?? []).some((p) => String(p).includes("context-mode"));
  if (arm === "on" && !plugin) die(`${branch}: plugin context-mode absent`);
  if (arm === "off" && plugin) die(`${branch}: plugin context-mode présent`);
  const ins = show(branch, ".opencode/instructions.md");
  if (!ins) die(`${branch}: .opencode/instructions.md introuvable`);
  hashes[arm] = createHash("sha256").update(ins).digest("hex");
}
if (hashes.off !== hashes.on) die("instructions.md différent entre OFF et ON");
if (trees.off !== trees.on) die('fichiers versionnés différents entre OFF et ON (hors opencode.json)');
if (JSON.stringify(stable(configs.off)) !== JSON.stringify(stable(configs.on))) die('configurations différentes hors plugin context-mode');

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
for (const arm of ['on', 'off']) {
  mkdirSync(join(results, arm), { recursive: true });
  for (const n of runs) {
    if (existsSync(join(results, arm, `run-${n}.json`))) die(`résultat déjà présent : results/${arm}/run-${n}.json ; archivez les résultats précédents avant une nouvelle campagne`);
  }
}
const project = join(campaign, 'project');
const pg = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const refs = { off: g('rev-parse', OFF), on: g('rev-parse', ON) };
const manifest = JSON.stringify({ refs, model, variant, runs, toolHashes, results, campaign, createdAt: new Date().toISOString() }, null, 2);
writeFileSync(join(campaign, 'manifest.json'), manifest);
writeFileSync(join(results, 'manifest.json'), manifest);
g('worktree', 'add', '--detach', project, refs.on);
console.error(`Campagne : ${campaign}`);
try {
  const diagnostic = spawnSync(node, ['diagnose.mjs', `--dir=${project}`, `--model=${model}`, `--results=${results}`,
    ...(variant ? [`--variant=${variant}`] : []), ...(a['timeout-ms'] ? [`--timeout-ms=${a['timeout-ms']}`] : [])], { cwd: tools, stdio: 'inherit' });
  if (diagnostic.status !== 0) throw new Error('Diagnostic ctx préalable non concluant ; consulter les traces');
  for (const n of runs) {
    const order = n % 2 ? [["off", OFF], ["on", ON]] : [["on", ON], ["off", OFF]];
    for (const [arm, branch] of order) {
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
    const comparison = spawnSync(node, ["compare.mjs", `--results=${results}`], { cwd: tools, stdio: "inherit" });
    if (comparison.status !== 0) throw new Error('Comparaison invalide');
  }
} finally {
  if (existsSync(results)) spawnSync(node, ['audit.mjs', `--results=${results}`], { cwd: tools, stdio: 'inherit' });
  // Sans --force : Git refuse de supprimer un worktree contenant des modifications.
  try { g('worktree', 'remove', project); } catch (error) {
    if (existsSync(project)) console.error(`Worktree conservé pour inspection : ${project}\n${error.message}`);
  }
}
console.error(`\nRésultats : ${results}`);
