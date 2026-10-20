#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { argsOf, extractTurns, sha, tokens } from './bench-lib.mjs';
const a = argsOf(), root = resolve(a.results ?? 'results');
const suite = JSON.parse(readFileSync(new URL('./prompts.json', import.meta.url), 'utf8'));
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]); }
const matrix = [];
for (const file of files(root).filter(f => /\.export(?:\.json)?$/.test(f) && !f.includes(`${join('diagnostic', 'session.export')}`))) {
  try {
    const turns = extractTurns(JSON.parse(readFileSync(file, 'utf8')));
    const sidecar = file.replace(/\.export(?:\.json)?$/, '.json');
    const meta = existsSync(sidecar) ? JSON.parse(readFileSync(sidecar, 'utf8')) : null;
    let diverged = false;
    turns.forEach((t, i) => {
      const saved = meta?.turns?.[i];
      try { tokens(t); } catch (error) {
        t.valid = false;
        t.reason = 'token-accounting-error';
        t.tokenAccountingError = error.message;
      }
      if (saved?.valid === false) { t.valid = false; t.reason = saved.reason ?? 'runner-invalid'; }
      t.contextDiverged = diverged; t.comparable = t.valid && !diverged && saved?.comparable !== false; diverged ||= !t.comparable;
    });
    if (a['refresh-metrics']) {
      if (meta?.schemaVersion !== 2) throw new Error('Recalcul refusé sans métadonnées v2 ; aucune précondition historique inventée');
      if (turns.length !== meta.turns.length) throw new Error('Recalcul refusé : nombre de tours différent du résumé');
      meta.turns = turns.map((t, i) => ({ ...t, id: meta.turns[i].id, name: meta.turns[i].name, measure: meta.turns[i].measure, durationMs: meta.turns[i].durationMs }));
      meta.valid &&= turns.length === meta.expectedPrompts.length && turns.every(t => t.comparable);
      meta.metricsSha = sha(readFileSync(new URL('./bench-lib.mjs', import.meta.url)));
      meta.exportSha = sha(readFileSync(file));
      writeFileSync(sidecar, JSON.stringify(meta, null, 2));
    }
    matrix.push({ file, name: basename(file), valid: turns.length === suite.prompts.length && turns.every(t => t.comparable) && meta?.valid !== false,
      turns: suite.prompts.map((p, i) => ({ id: p.id, valid: turns[i]?.valid ?? false, comparable: turns[i]?.comparable ?? false,
        reason: turns[i]?.reason ?? (turns[i] ? null : 'missing'), contextDiverged: turns[i]?.contextDiverged ?? turns.some(t => !t.valid),
        ctxAttempted: turns[i]?.ctxToolCalls ?? 0, ctxSucceeded: turns[i]?.ctxSucceeded ?? 0,
        permissions: turns[i]?.permissionEvents ?? [] })),
      unexpectedTurns: Math.max(0, turns.length - suite.prompts.length), protocolVerified: meta?.schemaVersion === 2 });
  } catch (error) { matrix.push({ file, valid: false, error: error.message }); }
}
writeFileSync(join(root, 'audit.json'), JSON.stringify(matrix, null, 2));
writeFileSync(join(root, 'audit.md'), ['# Validité des exports', '', '| Export | Prompt | Terminé | Comparable | Motif | ctx réussis |', '|---|---|---|---|---|---|',
  ...matrix.flatMap(r => r.turns ? r.turns.map(t => `| ${r.name} | ${t.id} | ${t.valid} | ${t.comparable} | ${t.reason ?? ''}${t.contextDiverged ? ' contexte divergent' : ''} | ${t.ctxSucceeded} |`) : [`| ${r.file} | — | false | false | ${r.error} | — |`]),
  '', 'La validité historique du tour ne prouve pas l’équivalence des conditions OFF/ON. Les exports sans métadonnées v2 restent exclus des gains officiels.'].join('\n'));
console.log(`${matrix.length} exports audités -> ${join(root, 'audit.md')}`);
if (matrix.some(r => !r.valid)) process.exitCode = 2;
