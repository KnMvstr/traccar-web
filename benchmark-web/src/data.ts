export const tokenTypes = ['total', 'input', 'output', 'reasoning', 'cache', 'cacheRead', 'cacheWrite'] as const;
export type TokenType = typeof tokenTypes[number];
export type Turn = { tokenBreakdown?: Record<Exclude<TokenType, 'total'>, number>; costBreakdown?: Record<Exclude<TokenType, 'total'>, number | null>; id: string; tokens: number; durationMs: number; estimatedCost: number | null; providerCost: number | null };
export type Run = { arm: string; run: number; durationMs: number; turns: Turn[] };
export type Campaign = {
  id: string; source: string; model: string; variant: string | null; startedAt: string; finishedAt: string;
  prompts: { id: string; name: string; measure: string }[]; setups: { id: string; name: string }[]; runs: Run[];
  pricing: { provider?: string; label?: string; longContextThreshold?: number; verifiedAt: string; source: string; input: number; cacheRead: number; output: number };
};
export type Row = { label: string; n: number; tokens: number; durationMs: number; estimatedCost: number | null; providerCost: number | null; min: number | null; max: number | null };
export type ChartSeries = { id: string; name: string; rows: Row[] };
export const summarize = (values: number[], statistic: string) => {
  const sorted = [...values].sort((a,b) => a-b), mid = Math.floor(sorted.length / 2);
  if (statistic === 'sum') return sorted.reduce((a,b) => a+b, 0);
  return statistic === 'mean' ? sorted.reduce((a,b) => a+b, 0) / sorted.length : sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
};

const sum = (values: (number | null)[]) => values.some(v => v === null) ? null : (values as number[]).reduce((a,b) => a+b, 0);
export function makeRows(c: Campaign, view: string, setup: string, statistic: string, scope: string, cumulative: boolean, tokenType: TokenType = 'total'): Row[] {
  const filteredTurns = (turns: Turn[]) => turns.map(t => {
    if (tokenType === 'total') return t;
    if (!t.tokenBreakdown || !t.costBreakdown) throw Error('Token breakdown unavailable');
    return { ...t, tokens: t.tokenBreakdown[tokenType], estimatedCost: t.costBreakdown[tokenType], providerCost: null };
  });
  const prompts = c.prompts.filter(p => scope === 'all' || p.measure === 'marginal');
  const aggregate = (label: string, values: Turn[]): Row => {
    const metric = values.map(v => view.endsWith('cost') ? v.estimatedCost : view.endsWith('time') ? v.durationMs : v.tokens);
    const nullable = (key: 'estimatedCost' | 'providerCost') => values.every(v => v[key] !== null) ? summarize(values.map(v => v[key] as number), statistic) : null;
    return { label, n: values.length, tokens: summarize(values.map(v => v.tokens), statistic), durationMs: summarize(values.map(v => v.durationMs), statistic), estimatedCost: nullable('estimatedCost'), providerCost: nullable('providerCost'), min: metric.every(v => v !== null) ? Math.min(...metric as number[]) : null, max: metric.every(v => v !== null) ? Math.max(...metric as number[]) : null };
  };
  const total = (turns: Turn[]): Turn => ({ id: '', tokens: turns.reduce((s,t) => s+t.tokens, 0), durationMs: turns.reduce((s,t) => s+t.durationMs, 0), estimatedCost: sum(turns.map(t => t.estimatedCost)), providerCost: sum(turns.map(t => t.providerCost)) });
  if (view.startsWith('setup')) return c.setups.map(s => aggregate(s.name, c.runs.filter(r => r.arm === s.id).map(r => total(filteredTurns(r.turns).filter(t => prompts.some(p => p.id === t.id))))));
  return prompts.map((p, i) => aggregate(p.id, c.runs.filter(r => r.arm === setup).map(r => total(filteredTurns(r.turns).filter(t => cumulative ? prompts.slice(0,i+1).some(v => v.id === t.id) : t.id === p.id)))));
}

export function makeChartSeries(c: Campaign, view: string, setup: string, statistic: string, scope: string, cumulative: boolean, tokenType: TokenType = 'total'): ChartSeries[] {
  if (view.startsWith('setup')) return [{ id: 'totals', name: '', rows: makeRows(c, view, setup, statistic, scope, cumulative, tokenType) }];
  return c.setups.filter(s => setup === 'all' || s.id === setup).map(s => ({
    id: s.id, name: s.name, rows: makeRows(c, view, s.id, statistic, scope, cumulative, tokenType),
  }));
}

export function makeTableTotals(c: Campaign, view: string, setup: string, statistic: string, scope: string, tokenType: TokenType = 'total'): { perSetup: Row[]; overall: Row } {
  const selected = { ...c, setups: c.setups.filter(s => !view.startsWith('prompt') || setup === 'all' || s.id === setup) };
  const totalView = `setup-${view.split('-')[1]}`;
  // Sum prompts within each run; cumulative display rows must never be added.
  const perSetup = makeRows(selected, totalView, setup, statistic, scope, false, tokenType);
  const individual = selected.setups.flatMap(s => c.runs.filter(r => r.arm === s.id).map(r =>
    makeRows({ ...c, setups: [s], runs: [r] }, totalView, s.id, statistic, scope, false, tokenType)[0]));
  return { perSetup: view.startsWith('prompt') ? perSetup : [], overall: {
    label: 'All selected runs', n: individual.length,
    tokens: individual.reduce((s,r) => s+r.tokens,0),
    durationMs: individual.reduce((s,r) => s+r.durationMs,0),
    estimatedCost: sum(individual.map(r => r.estimatedCost)),
    providerCost: sum(individual.map(r => r.providerCost)), min: null, max: null,
  } };
}

export function makeConsumptionComparison(c: Campaign, statistic: string, scope: string, tokenType: TokenType = 'total') {
  const rows = makeRows(c, 'setup-tokens', 'all', statistic, scope, false, tokenType);
  const byArm = new Map(c.setups.map((s,i) => [s.id, rows[i]]));
  const off = byArm.get('off');
  const change = (baseline: number | null | undefined, target: number | null | undefined) =>
    baseline == null || target == null || baseline <= 0 ? null : 100 * (target/baseline-1);
  return ['on-no-routing', 'on'].map(arm => ({
    arm, tokenChange: change(off?.tokens, byArm.get(arm)?.tokens),
    costChange: change(off?.estimatedCost, byArm.get(arm)?.estimatedCost),
  }));
}

export function fiveNumberSummary(values: number[]): [number, number, number, number, number] | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  const quantile = (p: number) => {
    const position = (sorted.length-1)*p, lower = Math.floor(position);
    return sorted[lower]+(sorted[Math.ceil(position)]-sorted[lower])*(position-lower);
  };
  return [sorted[0], quantile(.25), quantile(.5), quantile(.75), sorted[sorted.length-1]];
}
export function makeBoxplotSeries(c: Campaign, view: string, setup: string, scope: string, cumulative: boolean, tokenType: TokenType = 'total') {
  const groups = view.startsWith('setup') ? [{ id: 'setups', name: '', setups: c.setups }] :
    c.setups.filter(s => setup === 'all' || s.id === setup).map(s => ({ id: s.id, name: s.name, setups: [s] }));
  return groups.map(group => {
    const selected = { ...c, setups: group.setups };
    const template = makeRows(selected, view, group.id, 'median', scope, cumulative, tokenType);
    const rows = template.map((row, index) => {
      const arm = view.startsWith('setup') ? group.setups[index].id : group.id;
      const samples = c.runs.filter(r => r.arm === arm).map(run => {
        const single = { ...c, setups: c.setups.filter(s => s.id === arm), runs: [run] };
        const r = makeRows(single, view, arm, 'median', scope, cumulative, tokenType)[view.startsWith('setup') ? 0 : index];
        return view.endsWith('cost') ? r.estimatedCost : r.tokens;
      });
      return { label: row.label, n: samples.length, summary: samples.every(v => v !== null) ? fiveNumberSummary(samples as number[]) : null };
    });
    return { id: group.id, name: group.name, rows };
  });
}
