#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argsOf, tokens, sha } from './bench-lib.mjs';
const options = argsOf();
const results = options.results ?? 'results';
const selectedRuns = options.runs ? String(options.runs).split(',').map(Number) : null;
// Invalidate old reports before any checks: a failed re-comparison must never leave old gains visible.
writeFileSync(join(results, 'compare.json'), JSON.stringify({ valid: false, reason: 'comparison-not-validated' }, null, 2));

// run-0 (pilote) exclu
const load = (arm) =>
  readdirSync(join(results, arm))
    .filter((f) => /^run-[1-9]\d*\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(results, arm, f), "utf8")))
    .filter(r => !selectedRuns || selectedRuns.includes(r.run))
    .sort((a, b) => a.run - b.run);

const off = load("off");
const on = load("on");

if (!off.length || !on.length) {
  throw new Error("Il faut au moins un run (hors pilote) dans results/off et results/on");
}

const same = (xs) => new Set(xs).size === 1;
const all = [...off, ...on];
if (all.some(r => !r.sessionId) || new Set(all.map(r => r.sessionId)).size !== all.length) throw new Error('Sessions manquantes ou réutilisées entre runs');
writeFileSync(join(results, 'validity.json'), JSON.stringify(all.map(r => ({ arm: r.arm, run: r.run, valid: r.valid === true,
  turns: r.turns.map(t => ({ id: t.id, valid: t.valid === true, comparable: t.comparable === true, reason: t.reason, contextDiverged: t.contextDiverged })) })), null, 2));
if (all.some(r => r.schemaVersion !== 2 || !r.valid || r.turns.length !== r.expectedPrompts?.length || r.turns.some(t => !t.valid || !t.comparable))) throw new Error('Exécution incomplète ou ancienne : gains exclus ; voir validity.json et audit.mjs');
if (off.map(r => r.run).join(',') !== on.map(r => r.run).join(',')) throw new Error('Paires OFF/ON manquantes');
if (on.some(r => !r.pluginIdentity) || !same(on.map(r => JSON.stringify(r.pluginIdentity)))) throw new Error('Version ou contenu du plugin non figé entre runs ON');
for (const key of ['applicationSha', 'configSha', 'suiteSha', 'runtimeSha', 'protocol', 'environmentSha', 'cachePolicy', 'timeoutMs']) {
  if (all.some(r => r[key] == null) || !same(all.map(r => r[key]))) throw new Error(`Préconditions différentes: ${key}`);
}
if (all.some(r => r.turns.some(t => !t.models.length || t.models.some(m => m !== r.model)))) throw new Error('Modèle effectif absent ou différent du modèle demandé');
if (all.some(r => r.variant && r.turns.some(t => !t.variants?.length || t.variants.some(v => v !== r.variant)))) throw new Error('Variante effective absente ou différente de la variante demandée');

if (!same(all.map((r) => r.commonSha))) {
  throw new Error("Instructions communes différentes entre branches : comparaison invalide");
}
if (!same(all.map((r) => r.model ?? null))) {
  throw new Error("Modèles différents entre runs");
}
if (!same(all.map((r) => r.variant ?? null))) {
  throw new Error("Variantes différentes entre runs");
}
if (!same(all.map((r) => r.ocVersion ?? null))) {
  throw new Error("Versions d'OpenCode différentes");
}
if (all.some((r) => r.workingTreeChanged)) {
  throw new Error("Un run a modifié le dépôt");
}
if (!same(off.map((r) => r.commit)) || !same(on.map((r) => r.commit))) {
  throw new Error("Commits différents au sein d'une branche");
}

const tok = tokens;

const byId = (r) => Object.fromEntries((r.turns ?? []).map((t) => [t.id, t]));
const ids = off[0].turns.map((t) => t.id);
const measureOf = Object.fromEntries(off[0].turns.map((t) => [t.id, t.measure]));
if (new Set(ids).size !== ids.length || all.some(r => JSON.stringify(r.turns.map(t => t.id)) !== JSON.stringify(ids) || JSON.stringify(r.expectedPrompts.map(p => p.id)) !== JSON.stringify(ids))) throw new Error('Ordre, identité ou unicité des prompts invalide');

for (const r of all) {
  const m = byId(r);
  for (const id of ids) {
    if (!m[id]) {
      throw new Error(`${r.arm} #${r.run}: tour ${id} manquant`);
    }
  }
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return {
    min: s[0],
    med: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2,
    max: s[s.length - 1],
  };
};

const summarize = (runs) => {
  const maps = runs.map(byId);

  const perTurn = ids.map((id) => {
    const ts = maps.map((m) => m[id]);
    return {
      id,
      tokens: stats(ts.map(tok)),
      input: stats(ts.map((t) => t.input ?? 0)),
      output: stats(ts.map((t) => t.output ?? 0)),
      reasoning: stats(ts.map((t) => t.reasoning ?? 0)),
      cacheRead: stats(ts.map((t) => t.cacheRead ?? 0)),
      cacheWrite: stats(ts.map((t) => t.cacheWrite ?? 0)),
      cost: stats(ts.map((t) => t.cost ?? 0)),
      costKnown: ts.every(t => t.costKnown),
      durationMs: stats(ts.map(t => t.durationMs ?? 0)),
      toolCalls: stats(ts.map((t) => t.toolCalls ?? 0)),
      toolErrors: stats(ts.map(t => t.toolErrors)),
      pathErrors: stats(ts.map(t => t.pathErrors)),
      permissionErrors: stats(ts.map(t => t.permissionEvents.length)),
      ctxCalls: stats(ts.map((t) => t.ctxToolCalls ?? 0)),
      ctxSucceeded: stats(ts.map(t => t.ctxSucceeded)),
      ctxFailed: stats(ts.map(t => t.ctxFailed)),
      context: stats(ts.map((t) => t.lastContext ?? 0)),
    };
  });

  const cumPerRun = maps.map((m) => {
    let c = 0;
    return ids.map((id) => (c += tok(m[id])));
  });

  const cumulative = ids.map((_, i) => stats(cumPerRun.map((c) => c[i])));

  const marginalIds = ids.filter((id) => measureOf[id] === "marginal");
  const marginalTotals = maps.map((m) =>
    marginalIds.reduce((sum, id) => sum + tok(m[id]), 0),
  );

  const marginal = stats(marginalTotals);

  const finalTotals = cumPerRun.map((c) => c[c.length - 1]);
  const finalMed = stats(finalTotals).med;
  const representativeRunIndex = finalTotals.reduce(
    (best, v, i) =>
      Math.abs(v - finalMed) < Math.abs(finalTotals[best] - finalMed) ? i : best,
    0,
  );

  return {
    n: runs.length,
    perTurn,
    cumulative,
    marginal,
    cost: {
      complete: runs.every(r => r.turns.every(t => t.costKnown)),
      total: runs.every(r => r.turns.every(t => t.costKnown)) ? stats(maps.map(m => ids.reduce((sum, id) => sum + m[id].cost, 0))) : null,
      marginal: runs.every(r => r.turns.every(t => t.costKnown)) ? stats(maps.map(m => marginalIds.reduce((sum, id) => sum + m[id].cost, 0))) : null,
    },
    representativeRun: runs[representativeRunIndex].run,
  };
};

const S = {
  off: summarize(off),
  on: summarize(on),
};

let breakEven = null;
ids.forEach((id, i) => {
  if (breakEven === null && S.on.cumulative[i].med < S.off.cumulative[i].med) {
    breakEven = id;
  }
});

const savingPct =
  S.off.marginal.med > 0
    ? ((1 - S.on.marginal.med / S.off.marginal.med) * 100)
    : 0;

const disjoint = S.on.marginal.max < S.off.marginal.min;
const ctxUsed = on.every(r => r.turns.some(t => t.ctxProcessingSucceeded > 0));
const costSavingPct = S.off.cost.complete && S.on.cost.complete && S.off.cost.marginal.med > 0 ? (1 - S.on.cost.marginal.med / S.off.cost.marginal.med) * 100 : null;
const paired = off.map((o, i) => {
  const n = on[i], marginal = r => r.turns.filter(t => t.measure === 'marginal');
  const offTokens = marginal(o).reduce((sum, t) => sum + tokens(t), 0), onTokens = marginal(n).reduce((sum, t) => sum + tokens(t), 0);
  return { run: o.run, offTokens, onTokens, deltaTokens: onTokens - offTokens, savingPct: offTokens > 0 ? (1 - onTokens / offTokens) * 100 : null };
});

const f = (x) => Math.round(x).toLocaleString("fr-FR");
const cell = (s) => `${f(s.med)} (${f(s.min)}–${f(s.max)})`;

const rows = ids.map((id, i) => {
  const o = S.off.perTurn[i];
  const n = S.on.perTurn[i];
  return `| ${id} | ${measureOf[id]} | ${cell(o.tokens)} | ${cell(n.tokens)} | ${f(n.tokens.med - o.tokens.med)} | ${f(n.ctxCalls.med)} |`;
});

const md = [
  `# Résumé — ${off[0].suite}`,
  ``,
  `Runs : OFF=${S.off.n}, ON=${S.on.n} | modèle : ${off[0].model ?? "défaut"} | variante : ${off[0].variant ?? "défaut"} | OpenCode ${off[0].ocVersion}`,
  `Valeurs : médiane (min–max) des totaux exportés par appel, rapprochés des catégories brutes. Aucun ajout aveugle du raisonnement.`,
  `Coûts issus des exports, sans estimation tarifaire. Coût inconnu si absent. Cache fournisseur distinct du stockage local Context Mode ; caches non réinitialisés, état fournisseur non contrôlé.`,
  ``,
  `| Tour | Mesure | OFF | ON | Δ médiane | appels ctx_* (ON) |`,
  `|---|---|---|---|---|---|`,
  ...rows,
  ``,
  `| Tour | Coût OFF | Coût ON | Durée médiane OFF/ON (s) | Erreurs outils OFF/ON | ctx réussis/échoués ON (médiane) |`,
  `|---|---|---|---|---|---|`,
  ...ids.map((id, i) => {
    const o = S.off.perTurn[i], n = S.on.perTurn[i];
    return `| ${id} | ${o.costKnown ? o.cost.med.toFixed(6) : 'inconnu'} | ${n.costKnown ? n.cost.med.toFixed(6) : 'inconnu'} | ${(o.durationMs.med / 1000).toFixed(1)}/${(n.durationMs.med / 1000).toFixed(1)} | ${o.toolErrors.med}/${n.toolErrors.med} | ${n.ctxSucceeded.med}/${n.ctxFailed.med} |`;
  }),
  ``,
  `- Total P2–P6 (marginal) : OFF ${cell(S.off.marginal)} | ON ${cell(S.on.marginal)}`,
  `- Écart sur P2–P6 : ${savingPct.toFixed(1)} % (positif = ON consomme moins)`,
  `- Coût marginal exporté médian : OFF ${S.off.cost.marginal?.med ?? 'inconnu'} | ON ${S.on.cost.marginal?.med ?? 'inconnu'} ; écart ${costSavingPct === null ? 'non calculable' : costSavingPct.toFixed(1) + ' %'}.`,
  `- Plages disjointes (ON max < OFF min) : ${disjoint ? "oui" : "NON, résultat non démontré"}`,
  `- Point d'équilibre (cumul médian ON < OFF) : ${breakEven ?? "jamais"}`,
  `- Run le plus proche de la médiane : OFF #${S.off.representativeRun}, ON #${S.on.representativeRun}`,
  ctxUsed ? `- Traitement ctx réussi observé dans chaque run ON ; attribution causale à interpréter avec la dispersion.` : `- Traitement ctx réussi non démontré dans chaque run ON : aucun gain attribuable au traitement ctx (doctor/stats seuls ne suffisent pas).`,
  ``,
  `Notes : médiane par tour indépendante ; cumul calculé par run puis médian ;`,
  `la somme des médianes n'est pas la médiane des sommes.`,
].join("\n");

writeFileSync(join(results, 'compare.json'), JSON.stringify({ valid: true, S, savingPct, costSavingPct, paired, disjoint, breakEven, ctxUsed,
  metricsSha: sha(readFileSync(new URL('./bench-lib.mjs', import.meta.url))),
  individualRuns: all, costComplete: all.every(r => r.turns.every(t => t.costKnown)) }, null, 2));
console.log(md);
