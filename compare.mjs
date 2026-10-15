#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// run-0 (pilote) exclu
const load = (arm) =>
  readdirSync(join("results", arm))
    .filter((f) => /^run-[1-9]\d*\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join("results", arm, f), "utf8")))
    .sort((a, b) => a.run - b.run);

const off = load("off");
const on = load("on");

if (!off.length || !on.length) {
  throw new Error("Il faut au moins un run (hors pilote) dans results/off et results/on");
}

const same = (xs) => new Set(xs).size === 1;
const all = [...off, ...on];

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

const tok = (t) =>
  (t.input ?? 0) +
  (t.output ?? 0) +
  (t.reasoning ?? 0) +
  (t.cacheRead ?? 0) +
  (t.cacheWrite ?? 0);

const byId = (r) => Object.fromEntries((r.turns ?? []).map((t) => [t.id, t]));
const ids = off[0].turns.map((t) => t.id);
const measureOf = Object.fromEntries(off[0].turns.map((t) => [t.id, t.measure]));

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
      toolCalls: stats(ts.map((t) => t.toolCalls ?? 0)),
      ctxCalls: stats(ts.map((t) => t.ctxToolCalls ?? 0)),
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
const ctxUsed = S.on.perTurn.some((t) => t.ctxCalls.max > 0);

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
  `Valeurs : médiane (min–max) en tokens bruts (input + output + reasoning + cache).`,
  ``,
  `| Tour | Mesure | OFF | ON | Δ médiane | appels ctx_* (ON) |`,
  `|---|---|---|---|---|---|`,
  ...rows,
  ``,
  `- Total P2–P6 (marginal) : OFF ${cell(S.off.marginal)} | ON ${cell(S.on.marginal)}`,
  `- Écart sur P2–P6 : ${savingPct.toFixed(1)} % (positif = ON consomme moins)`,
  `- Plages disjointes (ON max < OFF min) : ${disjoint ? "oui" : "NON, résultat non démontré"}`,
  `- Point d'équilibre (cumul médian ON < OFF) : ${breakEven ?? "jamais"}`,
  `- Run le plus proche de la médiane : OFF #${S.off.representativeRun}, ON #${S.on.representativeRun}`,
  ctxUsed ? `` : `- ATTENTION : aucun appel ctx_* en ON, aucune économie possible.`,
  ``,
  `Notes : médiane par tour indépendante ; cumul calculé par run puis médian ;`,
  `la somme des médianes n'est pas la médiane des sommes.`,
].join("\n");

writeFileSync("results/summary.json", JSON.stringify({ S, savingPct, disjoint, breakEven }, null, 2));
writeFileSync("results/summary.md", md);
console.log(md);