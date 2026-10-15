#!/usr/bin/env node
// Usage : node bench.mjs --model=github-copilot/gpt-5.6-luna [--runs=5] [--pilot]
// À lancer depuis le dépôt, sur la branche benchmark/runner.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const a = Object.fromEntries(
  process.argv.slice(2).map((x) => x.replace(/^--/, "").split("=")),
);
const repo = resolve(a.repo ?? dirname(fileURLToPath(import.meta.url)));
const work = resolve(process.env.BENCH_WORK ?? "C:\\work\\traccar-bench-run");
const RUNNER = a.runner ?? "benchmark/runner";
const OFF = a.off ?? "benchmark/opencode-off";
const ON = a.on ?? "benchmark/opencode-on";
const model = a.model;
const variant = a.variant;
const pilot = "pilot" in a;
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
if (g("status", "--porcelain", "--untracked-files=no")) die("modifications non commitées : commitez-les d'abord");

const hashes = {};
for (const [arm, branch] of [["off", OFF], ["on", ON]]) {
  const cfgBuf = show(branch, "opencode.json");
  if (!cfgBuf) die(`${branch}: opencode.json introuvable`);
  if (cfgBuf[0] === 0xef) die(`${branch}: opencode.json commence par un BOM`);
  const cfg = JSON.parse(cfgBuf.toString("utf8"));
  const plugin = (cfg.plugin ?? []).some((p) => String(p).includes("context-mode"));
  if (arm === "on" && !plugin) die(`${branch}: plugin context-mode absent`);
  if (arm === "off" && plugin) die(`${branch}: plugin context-mode présent`);
  const ins = show(branch, ".opencode/instructions.md");
  if (!ins) die(`${branch}: .opencode/instructions.md introuvable`);
  hashes[arm] = createHash("sha256").update(ins).digest("hex");
}
if (hashes.off !== hashes.on) die("instructions.md différent entre OFF et ON");

// ---------- Copie de l'outillage hors du dépôt ----------
mkdirSync(work, { recursive: true });
for (const f of ["run.mjs", "compare.mjs", "prompts.json"]) cpSync(join(repo, f), join(work, f));
cpSync(join(repo, "prompts"), join(work, "prompts"), { recursive: true });
const suite = JSON.parse(readFileSync(join(work, "prompts.json"), "utf8"));
for (const p of suite.prompts) {
  if (!existsSync(join(work, p.file))) die(`prompt introuvable : ${p.file}`);
}

// ---------- Exécution ----------
const node = process.execPath;
try {
  for (const n of runs) {
    const order = n % 2 ? [["off", OFF], ["on", ON]] : [["on", ON], ["off", OFF]];
    for (const [arm, branch] of order) {
      console.error(`\n=== run ${n} · ${arm} · ${branch} ===`);
      g("switch", branch);
      const r = spawnSync(
        node,
        ["run.mjs", `--arm=${arm}`, `--dir=${repo}`, `--run=${n}`, ...(model ? [`--model=${model}`] : []),
        ...(variant ? [`--variant=${variant}`] : [])],
        { cwd: work, stdio: "inherit" },
      );
      if (r.status !== 0) throw new Error(`run ${n} ${arm} en échec (code ${r.status})`);
    }
  }
  if (!pilot) spawnSync(node, ["compare.mjs"], { cwd: work, stdio: "inherit" });
} finally {
  try { g("switch", RUNNER); } catch (e) { console.error(`Retour sur ${RUNNER} impossible : ${e.message}`); }
}
console.error(`\nRésultats : ${join(work, "results")}`);