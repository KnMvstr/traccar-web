import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, win32 } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

export const sha = (value) => createHash('sha256').update(value).digest('hex');
export const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
export function normalizeRuntime(config, agent) {
  const c = structuredClone(config), ag = structuredClone(agent);
  c.plugin = (c.plugin ?? []).filter(p => !String(p).includes('context-mode'));
  delete c.plugin_origins;
  if (ag.tools) ag.tools = Object.fromEntries(Object.entries(ag.tools).filter(([key]) => !isCtx(key)));
  return stable({ config: c, agent: ag });
}
export function pluginIdentity(pathsOutput, spec = 'context-mode') {
  const cache = pathsOutput.split(/\r?\n/).find(line => /^cache\s+/.test(line))?.replace(/^cache\s+/, '');
  if (!cache) return null;
  for (const key of [spec, `${spec}@latest`]) {
    const dir = resolve(cache, 'packages', key), pkg = resolve(dir, 'node_modules/context-mode/package.json');
    if (!existsSync(pkg)) continue;
    const raw = readFileSync(pkg), json = JSON.parse(raw);
    const entry = resolve(dir, 'node_modules/context-mode', json.main ?? 'build/adapters/opencode/plugin.js');
    const lock = resolve(dir, 'package-lock.json');
    return { version: json.version, packageSha: sha(raw), entrySha: existsSync(entry) ? sha(readFileSync(entry)) : null,
      lockSha: existsSync(lock) ? sha(readFileSync(lock)) : null };
  }
  return null;
}
export const permissionOverlay = { external_directory: 'deny', edit: 'deny', doom_loop: 'deny', question: 'deny', task: 'deny', webfetch: 'deny', websearch: 'deny', ctx_upgrade: 'deny', ctx_purge: 'deny', ctx_fetch_and_index: 'deny' };
export function benchmarkEnv() {
  const base = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? '{}');
  const permissions = value => typeof value === 'string' ? { '*': value } : value ?? {};
  return { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...base,
    permission: { ...permissions(base.permission), ...permissionOverlay },
    agent: { ...base.agent, build: { ...base.agent?.build, permission: { ...permissions(base.agent?.build?.permission), ...permissionOverlay } } } }) };
}
export const argsOf = (args = process.argv.slice(2)) => Object.fromEntries(args.map(x => {
  const i = x.indexOf('='); return i < 0 ? [x.replace(/^--/, ''), true] : [x.slice(0, i).replace(/^--/, ''), x.slice(i + 1)];
}));
export function inside(root, path) {
  const api = /^[A-Za-z]:[\\/]/.test(root) ? win32 : { resolve, relative, isAbsolute };
  const full = api.resolve(root, path), rel = api.relative(api.resolve(root), full);
  if (rel === '..' || rel.startsWith('..' + (api === win32 ? '\\' : '/')) || api.isAbsolute(rel)) throw new Error(`Chemin extérieur au workspace: ${path}`);
  return full;
}
export function promptFile(root, file) {
  const full = realpathSync(inside(root, file)); inside(realpathSync(root), full); return full;
}
export function binary() {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  if (process.platform === 'win32') {
    const shim = execFileSync('where.exe', ['opencode'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    const candidate = resolve(shim, '..', 'node_modules/opencode-ai/bin/opencode.exe');
    try { return realpathSync(candidate); } catch { throw new Error('Définir OPENCODE_BIN vers le véritable exécutable, pas un shim .cmd/.ps1'); }
  }
  return 'opencode';
}
export function capture(bin, args, { cwd, timeoutMs = 900000, env = process.env, onEvent } = {}) {
  return new Promise(resolveResult => {
    const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', timedOut = false, error = null, abortReason = null, pending = '';
    const terminate = () => {
      if (process.platform === 'win32' && child.pid) {
        try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { child.kill(); }
      } else child.kill('SIGKILL');
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    child.stdout.on('data', d => {
      stdout += d; pending += d;
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) {
        let event; try { event = JSON.parse(line); } catch { continue; }
        const reason = onEvent?.(event);
        if (reason && !abortReason) { abortReason = reason; terminate(); }
      }
    }); child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => { error = e.message; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolveResult({ stdout, stderr, code, signal, timedOut, error, abortReason }); });
  });
}
export const eventsOf = (raw) => raw.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
export const isCtx = name => /(?:^|[_-])ctx_[a-z_]+/.test(name ?? '');
export function retryGuard() {
  const counts = new Map(), seen = new Set();
  return event => {
    const p = event.part;
    if (p?.type !== 'tool') return null;
    if (p.state?.status === 'completed') {
      counts.delete(`${p.tool}:permission`); counts.delete(`${p.tool}:path`); return null;
    }
    if (p.state?.status !== 'error') return null;
    const id = p.callID ?? p.id;
    if (id && seen.has(id)) return null;
    if (id) seen.add(id);
    const error = p.state.error ?? '';
    const kind = /permission|reject|denied|refus/i.test(error) ? 'permission' : /not found|no such file|ENOENT/i.test(error) ? 'path' : null;
    if (!kind) return null;
    const key = `${p.tool}:${kind}`, n = (counts.get(key) ?? 0) + 1; counts.set(key, n);
    return n >= 3 ? `retry-limit:${key}` : null;
  };
}
export function extractTurns(exported) {
  if (!Array.isArray(exported.messages)) throw new Error('Schéma export inconnu: messages absent');
  const turns = []; let cur;
  for (const message of exported.messages) {
    const info = message.info ?? message;
    if (info.role === 'user') {
      cur = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, costKnown: true,
        toolCalls: 0, ctxToolCalls: 0, ctxSucceeded: 0, ctxFailed: 0, ctxProcessingSucceeded: 0, toolErrors: 0, lastContext: 0,
        calls: [], tools: [], finalStop: false, pendingTools: 0, errors: [], permissionEvents: [], pathErrors: 0, models: [], variants: [] };
      turns.push(cur);
    } else if (cur && info.role === 'assistant') {
      const t = info.tokens ?? {};
      for (const key of ['input', 'output', 'reasoning']) cur[key] += t[key] ?? 0;
      cur.cacheRead += t.cache?.read ?? 0; cur.cacheWrite += t.cache?.write ?? 0;
      cur.cost += info.cost ?? 0; cur.costKnown &&= typeof info.cost === 'number';
      cur.lastContext = (t.input ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0);
      cur.calls.push({ messageID: info.id, tokens: t, cost: info.cost ?? null, finish: info.finish ?? null, time: info.time });
      if (info.modelID && info.providerID) cur.models.push(`${info.providerID}/${info.modelID}`);
      cur.variants.push(info.variant ?? null);
      cur.finalStop = info.finish === 'stop' && !!info.time?.completed && (message.parts ?? []).some(p => p.type === 'text' && p.text?.trim());
      if (info.error) cur.errors.push(info.error);
      for (const part of message.parts ?? []) if (part.type === 'tool') {
        const state = part.state ?? {}, ctx = isCtx(part.tool);
        cur.toolCalls++; if (ctx) cur.ctxToolCalls++;
        if (state.status !== 'completed' && state.status !== 'error') cur.pendingTools++;
        if (state.status === 'error') { cur.toolErrors++; if (ctx) cur.ctxFailed++; }
        if (state.status === 'completed' && ctx) cur.ctxSucceeded++;
        if (state.status === 'completed' && /(?:^|[_-])ctx_(?:execute|execute_file|batch_execute|index|search|fetch_and_index)$/.test(part.tool ?? '')) cur.ctxProcessingSucceeded++;
        const tool = { name: part.tool, status: state.status, input: state.input, output: state.output, error: state.error, time: state.time };
        cur.tools.push(tool);
        if (/permission|reject|denied|refus/i.test(state.error ?? '')) cur.permissionEvents.push(tool);
        if (/not found|no such file|ENOENT/i.test(state.error ?? '')) cur.pathErrors++;
      }
    }
  }
  let tainted = false;
  for (const t of turns) {
    t.valid = t.finalStop && !t.pendingTools && !t.errors.length;
    t.reason = t.valid ? null : !t.finalStop ? 'missing-final-stop' : t.pendingTools ? 'pending-tools' : 'assistant-error';
    t.comparable = t.valid && !tainted; t.contextDiverged = tainted; tainted ||= !t.valid;
  }
  return turns;
}
// OpenCode may normalize output separately from reasoning. Use the exported
// per-message total, never assume the provider's original accounting convention.
export function tokens(turn) {
  if (!Array.isArray(turn.calls) || !turn.calls.length) throw new Error('Totaux par appel absents');
  return turn.calls.reduce((sum, call) => {
    const t = call.tokens, total = t?.total;
    const base = (t?.input ?? 0) + (t?.output ?? 0) + (t?.cache?.read ?? 0) + (t?.cache?.write ?? 0);
    if (!Number.isFinite(total) || total < 0 || (total !== base && total !== base + (t.reasoning ?? 0))) {
      throw new Error('Schéma de tokens non rapproché : total exporté absent ou incohérent');
    }
    return sum + total;
  }, 0);
}
export function fingerprint(cwd, cfg, suite, toolRoot) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
  const application = files.filter(f => f !== 'opencode.json');
  const normalized = structuredClone(cfg);
  normalized.plugin = (normalized.plugin ?? []).filter(p => !String(p).includes('context-mode'));
  return { applicationSha: sha(application.map(f => `${f}\0${sha(readFileSync(resolve(cwd, f)))}`).join('\n')),
    configSha: sha(JSON.stringify(stable(normalized))), suiteSha: sha(JSON.stringify(suite) + suite.prompts.map(p => readFileSync(promptFile(toolRoot, p.file), 'utf8')).join('\0')) };
}
