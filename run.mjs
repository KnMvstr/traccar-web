#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argsOf, binary, capture, eventsOf, extractTurns, fingerprint, promptFile, sha, benchmarkEnv, retryGuard, normalizeRuntime, isCtx, pluginIdentity, tokens } from './bench-lib.mjs';

const a = argsOf(), { arm, run = '1', model, variant } = a;
if (!['on', 'off'].includes(arm) || !a.dir || !model) throw new Error('--arm=on|off, --dir et --model explicite requis');
if (!Number.isInteger(Number(run)) || Number(run) < 0) throw new Error('--run doit être un entier positif ou nul');
const cwd = realpathSync(a.dir), root = dirname(fileURLToPath(import.meta.url));
const timeoutMs = Number(a['timeout-ms'] ?? 900000);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms invalide');
const suite = JSON.parse(readFileSync(join(root, 'prompts.json'), 'utf8'));
if (suite.prompts.some(p => p.arms && !['on', 'off'].every(arm => p.arms.includes(arm)))) throw new Error('Prompts asymétriques interdits');
const bin = binary();
const env = benchmarkEnv();
const sh = (cmd, args) => execFileSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
if (sh('git', ['status', '--porcelain']).trim()) throw new Error('Working tree non propre');
const common = readFileSync(join(cwd, suite.commonInstructions));
const cfg = JSON.parse(readFileSync(join(cwd, 'opencode.json'), 'utf8'));
if (!(cfg.instructions ?? []).includes(suite.commonInstructions)) throw new Error('Instructions communes non référencées');
const hasPlugin = (cfg.plugin ?? []).some(p => String(p).includes('context-mode'));
if (hasPlugin !== (arm === 'on')) throw new Error('Configuration plugin incohérente');
const outDir = resolve(a.results ?? join(root, 'results'), arm);
mkdirSync(outDir, { recursive: true });
const base = join(outDir, `run-${run}`);
if (existsSync(`${base}.json`)) throw new Error(`Résultat existant: ${base}.json`);
const result = { schemaVersion: 2, suite: suite.suite, arm, run: Number(run), model, variant: variant ?? null,
  commit: sh('git', ['rev-parse', 'HEAD']).trim(), commonSha: sha(common), ocVersion: sh(bin, ['--version']).trim(),
  ...fingerprint(cwd, cfg, suite, root), environmentSha: sha(env.OPENCODE_CONFIG_CONTENT), cachePolicy: 'provider-uncontrolled-local-warm', timeoutMs,
  pluginConfigured: hasPlugin, pluginSpec: cfg.plugin ?? [], protocol: 'final-stop-v2',
  valid: false, turns: [], expectedPrompts: suite.prompts.map(p => ({ id: p.id, name: p.name, measure: p.measure })),
  workspace: cwd, startedAt: new Date().toISOString() };
const save = () => writeFileSync(`${base}.json`, JSON.stringify(result, null, 2));
let sessionId, failure;
const t0 = Date.now();
const safety = `\n\nRègles communes de chemins et permissions : racine exacte ${JSON.stringify(cwd)}. Utilise les chemins relatifs au workspace. Ne reconstruis jamais le nom du répertoire utilisateur. Ne demande pas d'accès extérieur. Après refus ou fichier introuvable, corrige à partir des chemins observés dans le workspace ; au plus deux corrections par erreur, puis indique la limite dans la réponse finale. Ne contourne jamais une permission.`;
try {
  const probes = {};
  for (const [name, argv] of [['config', ['debug', 'config']], ['agent', ['debug', 'agent', 'build']]]) {
    probes[name] = await capture(bin, argv, { cwd, env, timeoutMs });
    writeFileSync(`${base}.${name}.json`, JSON.stringify(probes[name], null, 2));
    if (probes[name].code !== 0 || probes[name].timedOut) throw new Error(`Pré-vol: ${name} indisponible`);
  }
  const resolved = JSON.parse(probes.config.stdout), agent = JSON.parse(probes.agent.stdout);
  result.runtimeSha = sha(JSON.stringify(normalizeRuntime(resolved, agent)));
  result.availableCtxTools = Object.entries(agent.tools ?? {}).filter(([name, enabled]) => enabled && isCtx(name)).map(([name]) => name);
  if (hasPlugin) {
    const paths = await capture(bin, ['debug', 'paths'], { cwd, env, timeoutMs });
    result.pluginIdentity = pluginIdentity(paths.stdout, cfg.plugin.find(p => String(p).includes('context-mode')));
    if (!result.pluginIdentity) throw new Error('Version résolue de Context Mode inconnue : vérifier le cache OpenCode');
  }
  const resolvedHasPlugin = (resolved.plugin ?? []).some(p => String(p).includes('context-mode'));
  if (resolvedHasPlugin !== hasPlugin || (arm === 'off' && result.availableCtxTools.length)) throw new Error('Pré-vol: configuration effective contaminée');
  for (const [index, p] of suite.prompts.entries()) {
    console.error(`[${arm} #${run}] ${p.id} ${p.name}`);
    const argv = ['run', '--format', 'json', '--agent', 'build', '--model', model];
    if (variant) argv.push('--variant', variant);
    if (sessionId) argv.push('--session', sessionId); else argv.push('--title', `bench-${arm}-run${run}`);
    argv.push(readFileSync(promptFile(root, p.file), 'utf8') + safety);
    const start = Date.now();
    const pr = await capture(bin, argv, { cwd, env, timeoutMs, onEvent: retryGuard() });
    writeFileSync(`${base}.${p.id}.process.json`, JSON.stringify(pr, null, 2));
    const events = eventsOf(pr.stdout);
    const ids = [...new Set(events.map(e => e.sessionID ?? e.part?.sessionID).filter(Boolean))];
    if (ids.length > 1 || (sessionId && ids.some(id => id !== sessionId))) throw new Error('Session inattendue');
    sessionId ??= ids[0]; result.sessionId = sessionId;
    if (!sessionId) throw new Error('sessionID absent');
    const ex = await capture(bin, ['export', sessionId], { cwd, env, timeoutMs });
    writeFileSync(`${base}.${p.id}.export-process.json`, JSON.stringify(ex, null, 2));
    if (ex.code !== 0 || ex.timedOut) throw new Error('Export impossible');
    const exported = JSON.parse(ex.stdout);
    writeFileSync(`${base}.export.json`, JSON.stringify(exported, null, 2));
    const turns = extractTurns(exported);
    result.turns = turns.map((t, i) => ({ ...t, durationMs: result.turns[i]?.durationMs, ...result.expectedPrompts[i] }));
    if (turns.length !== index + 1) throw new Error(`Nombre de tours inattendu: ${turns.length}`);
    const last = result.turns[index]; last.durationMs = Date.now() - start;
    if (pr.code !== 0 || pr.timedOut || pr.error || pr.abortReason || events.some(e => e.type === 'error')) {
      last.valid = last.comparable = false; last.reason = pr.abortReason ?? (pr.timedOut ? 'timeout' : 'process-error');
    }
    save();
    if (!last.valid) throw new Error(`${p.id}: ${last.reason}`);
    last.exportedTokens = tokens(last);
    if (sh('git', ['status', '--porcelain']).trim()) throw new Error('Working tree modifié');
  }
  result.valid = true;
} catch (error) { failure = error; result.failure = error.message; }
finally {
  result.durationMs = Date.now() - t0;
  result.finishedAt = new Date().toISOString();
  result.workingTreeChanged = !!sh('git', ['status', '--porcelain']).trim();
  result.valid &&= !result.workingTreeChanged;
  result.ctx = { attempted: result.turns.reduce((n, t) => n + t.ctxToolCalls, 0), succeeded: result.turns.reduce((n, t) => n + t.ctxSucceeded, 0), failed: result.turns.reduce((n, t) => n + t.ctxFailed, 0) };
  result.ctxConclusion = !hasPlugin ? 'disabled' : result.ctx.succeeded ? 'used' : result.ctx.attempted ? 'calls-failed' : result.availableCtxTools?.length ? 'available-but-not-selected' : 'tools-unavailable';
  save();
}
if (failure || !result.valid) { console.error(`INVALID: ${result.failure ?? 'working-tree-changed'}`); process.exitCode = 2; }
else console.error(`OK -> ${base}.json`);
