#!/usr/bin/env node
// Usage: node run.mjs --arm=on|off --dir=C:\chemin\traccar-web --run=1 [--model=provider/model] [--variant=medium]
// run=0 : pilote, exclu des résumés. OPENCODE_BIN permet de pointer l'exécutable réel.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const BIN = process.env.OPENCODE_BIN ?? "opencode";
const a = Object.fromEntries(
  process.argv.slice(2).map((x) => x.replace(/^--/, "").split("=")),
);
const { arm, dir, run = "1", model, variant } = a;
if (!["on", "off"].includes(arm) || !dir) {
  throw new Error("--arm=on|off et --dir=<chemin> sont requis");
}
const cwd = resolve(dir);
const suite = JSON.parse(readFileSync("prompts.json", "utf8"));
const prompts = suite.prompts.filter((p) => !p.arms || p.arms.includes(arm));
const sh = (cmd, args) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const fail = (msg) => { throw new Error(`PRÉ-VOL: ${msg}`); };

// ---------- Pré-vol ----------
const dirty = sh("git", ["status", "--porcelain"]).trim();
if (dirty) fail(`working tree non propre :\n${dirty}`);

const commonPath = join(cwd, suite.commonInstructions);
if (!existsSync(commonPath)) fail(`${suite.commonInstructions} introuvable`);
const common = readFileSync(commonPath);
if (!common.toString("utf8").startsWith("# Définitions")) {
  fail("le fichier d'instructions ne contient pas le bloc commun");
}

const cfgPath = join(cwd, "opencode.json");
if (!existsSync(cfgPath)) fail("opencode.json absent à la racine");
const cfgRaw = readFileSync(cfgPath, "utf8");
if (cfgRaw.charCodeAt(0) === 0xfeff) fail("opencode.json commence par un BOM");
const cfg = JSON.parse(cfgRaw);
if (!(cfg.instructions ?? []).includes(suite.commonInstructions)) {
  fail("opencode.json ne référence pas le fichier d'instructions");
}
const hasPlugin = (cfg.plugin ?? []).some((p) => String(p).includes("context-mode"));
if (arm === "on" && !hasPlugin) fail("branche ON sans plugin context-mode");
if (arm === "off" && hasPlugin) fail("branche OFF avec plugin context-mode");
if (cfg.mcp && JSON.stringify(cfg.mcp).includes("context-mode")) {
  fail("context-mode déclaré aussi dans mcp (doublon)");
}

const ocDir = join(cwd, ".opencode");
const extra = existsSync(ocDir) ? readdirSync(ocDir).filter((f) => f !== "instructions.md") : [];
if (extra.length) fail(`fichiers inattendus dans .opencode/ : ${extra.join(", ")}`);

const commit = sh("git", ["rev-parse", "HEAD"]).trim();
const commonSha = createHash("sha256").update(common).digest("hex");
const ocVersion = sh(BIN, ["--version"]).trim();

// ---------- Un tour = un `opencode run` dans la même session ----------
function runTurn(prompt, sessionId) {
  return new Promise((ok, ko) => {
    const args = ["run", "--format", "json"];
    if (model) args.push("--model", model);
    if (variant) args.push("--variant", variant);
    if (sessionId) args.push("--session", sessionId);
    else args.push("--title", `bench-${arm}-run${run}`);
    args.push(prompt);

    const p = spawn(BIN, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", ko);
    p.on("close", (code) => {
      if (code !== 0) return ko(new Error(`opencode exit ${code}\n${err}`));
      let sid = sessionId;
      for (const line of out.split("\n")) {
        try {
          const o = JSON.parse(line);
          sid ??= o.sessionID ?? o.part?.sessionID; // VERIFY : nom du champ
        } catch { /* ligne non JSON */ }
      }
      ok(sid);
    });
  });
}

let sessionId;
const t0 = Date.now();
for (const p of prompts) {
  console.error(`[${arm} #${run}] ${p.id} ${p.name}`);
  sessionId = await runTurn(readFileSync(p.file, "utf8"), sessionId);
  if (!sessionId) throw new Error("sessionID introuvable (voir // VERIFY)");
}

// ---------- Export brut puis extraction par tour ----------
const exported = JSON.parse(sh(BIN, ["export", sessionId])); // VERIFY
mkdirSync(join("results", arm), { recursive: true });
writeFileSync(join("results", arm, `run-${run}.export.json`), JSON.stringify(exported));

const turns = [];
let cur = null;
for (const m of exported.messages ?? []) {
  const info = m.info ?? m;
  if (info.role === "user") {
    cur = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0,
            cost: 0, toolCalls: 0, ctxToolCalls: 0, lastContext: 0 };
    turns.push(cur);
  } else if (info.role === "assistant" && cur) {
    const t = info.tokens ?? {}; // VERIFY : structure
    cur.input      += t.input ?? 0;
    cur.output     += t.output ?? 0;
    cur.reasoning  += t.reasoning ?? 0;
    cur.cacheRead  += t.cache?.read ?? 0;
    cur.cacheWrite += t.cache?.write ?? 0;
    cur.cost       += info.cost ?? 0;
    cur.lastContext = (t.input ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0);
    for (const part of m.parts ?? []) {
      if (part.type === "tool") {
        cur.toolCalls++;
        if (/ctx_/.test(part.tool ?? "")) cur.ctxToolCalls++;
      }
    }
  }
}
if (turns.length !== prompts.length) {
  console.error(`ATTENTION: ${turns.length} tours exportés pour ${prompts.length} prompts`);
}
prompts.forEach((p, i) =>
  turns[i] && Object.assign(turns[i], { id: p.id, name: p.name, measure: p.measure }));

const dirtyAfter = sh("git", ["status", "--porcelain"]).trim();
const result = {
  suite: suite.suite, arm, run: Number(run),
  model: model ?? null, variant: variant ?? null,
  commit, commonSha, ocVersion, sessionId,
  durationMs: Date.now() - t0,
  workingTreeChanged: dirtyAfter !== "",
  turns,
};
writeFileSync(join("results", arm, `run-${run}.json`), JSON.stringify(result, null, 2));
console.error(`OK -> results/${arm}/run-${run}.json`);
if (dirtyAfter) { console.error("ATTENTION: working tree modifié"); process.exit(2); }