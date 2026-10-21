#!/usr/bin/env node
// Separate session: never included in benchmark usage or history.
import { mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { argsOf, binary, capture, eventsOf, extractTurns, benchmarkEnv, pluginIdentity } from './bench-lib.mjs';
const a = argsOf();
if (!a.dir || !a.model) throw new Error('--dir et --model requis');
const cwd = realpathSync(a.dir), bin = binary(), timeoutMs = Number(a['timeout-ms'] ?? 180000);
const env = benchmarkEnv(cwd);
const out = resolve(a.results ?? 'results', 'diagnostic'); mkdirSync(out, { recursive: true });
const evidence = { startedAt: new Date().toISOString(), model: a.model, workspace: cwd,
  config: JSON.parse(readFileSync(join(cwd, 'opencode.json'), 'utf8')), probes: {} };
const save = () => writeFileSync(join(out, 'diagnostic.json'), JSON.stringify(evidence, null, 2));
save();
for (const [name, argv] of [['version', ['--version']], ['paths', ['debug', 'paths']], ['config', ['debug', 'config']], ['agent', ['debug', 'agent', 'build']], ['mcp', ['mcp', 'list']]]) {
  evidence.probes[name] = await capture(bin, argv, { cwd, env, timeoutMs });
  save();
}
evidence.pluginIdentity = pluginIdentity(evidence.probes.paths.stdout, evidence.config.plugin?.find(p => String(p).includes('context-mode')));
const prompt = `Test préalable technique, distinct du benchmark. Lecture seule. Racine ${JSON.stringify(cwd)} ; chemins relatifs uniquement. Liste les outils Context Mode réellement exposés avec leurs noms et schémas visibles, sans en inventer. Si ctx_doctor est disponible, appelle-le. Exécute ensuite un outil ctx_execute ou ctx_batch_execute disponible pour calculer 2+2, sans réseau ni écriture, et rapporte le résultat. Si les outils sont absents ou refusés, explique la limite et termine. N'utilise pas d'outil classique pour simuler ctx.`;
const argv = ['run', '--format', 'json', '--agent', 'build', '--print-logs', '--log-level', 'DEBUG', '--model', a.model, '--title', 'bench-ctx-preflight'];
if (a.variant) argv.push('--variant', a.variant);
argv.push(prompt);
evidence.process = await capture(bin, argv, { cwd, env, timeoutMs, onEvent: event => {
  writeFileSync(join(out, 'last-event.json'), JSON.stringify(event, null, 2)); return null;
} });
save();
const events = eventsOf(evidence.process.stdout);
const sid = events.map(e => e.sessionID ?? e.part?.sessionID).find(Boolean);
evidence.sessionId = sid;
evidence.valid = false;
if (sid) {
  const ex = await capture(bin, ['export', sid], { cwd, env, timeoutMs });
  evidence.exportProcess = ex;
  try {
    const exported = JSON.parse(ex.stdout);
    writeFileSync(join(out, 'session.export.json'), JSON.stringify(exported, null, 2));
    evidence.turns = extractTurns(exported);
    evidence.valid = ex.code === 0 && evidence.process.code === 0 && !evidence.process.timedOut &&
      evidence.turns.length === 1 && evidence.turns[0].valid && evidence.turns[0].tools.some(t => /ctx_(?:batch_)?execute/.test(t.name) && t.status === 'completed' && /\b4\b/.test(t.output ?? ''));
  } catch (e) { evidence.error = e.message; }
}
evidence.conclusion = evidence.valid ? 'ctx-execution-confirmed' : 'unresolved-see-probes-and-session';
save();
console.error(`${evidence.conclusion}: ${out}`);
if (!evidence.valid) process.exitCode = 2;
