import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, BoxplotChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, AriaComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { makeChartSeries, makeTableTotals, makeConsumptionComparison, makeBoxplotSeries, tokenTypes, type TokenType, type ChartSeries, type Campaign, type Row } from './data';
import { chartColors, setupStyle } from './chartColors';
import { translate, readLanguage, localeFor, tokenLabels, promptTitles, promptObjectives, metricDescription, type Language } from './language';

echarts.use([BarChart, LineChart, BoxplotChart, GridComponent, TooltipComponent, AriaComponent, LegendComponent, CanvasRenderer]);

const count = (n: number, language: Language) => new Intl.NumberFormat(localeFor(language), { maximumFractionDigits: 0 }).format(n);
const decimal = (n: number, language: Language) => new Intl.NumberFormat(localeFor(language), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
const money = (n: number | null, language: Language) => n === null ? translate(language, 'Unavailable') : new Intl.NumberFormat(localeFor(language), { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(n);
const date = (s: string, language: Language) => new Intl.DateTimeFormat(localeFor(language), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(s));
const views = [{ id: 'setup-tokens', label: 'Tokens · setups' }, { id: 'setup-time', label: 'Time · setups' }, { id: 'setup-cost', label: 'Cost · setups' }, { id: 'prompt-tokens', label: 'Tokens · prompts' }, { id: 'prompt-time', label: 'Time · prompts' }, { id: 'prompt-cost', label: 'Cost · prompts' }];

function Chart({ series, time, cost, prompt, language, tokenType, cumulative, setupIds }: { setupIds: string[]; series: ChartSeries[]; time: boolean; cost: boolean; prompt: boolean; language: Language; tokenType: TokenType; cumulative: boolean }) {
  const t = (text: string) => translate(language, text);
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const [race, setRace] = useState(false), [playing, setPlaying] = useState(false);
  const steps = series[0]?.rows.length ?? 0;
  const [frame, setFrame] = useState(steps);
  useEffect(() => {
    const chart = echarts.init(ref.current!); chartRef.current = chart;
    const resize = new ResizeObserver(() => chart.resize()); resize.observe(ref.current!);
    return () => { resize.disconnect(); chart.dispose(); chartRef.current = null; };
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setFrame(current => Math.min(steps, current + 1)), 900);
    return () => clearInterval(timer);
  }, [playing, steps]);
  useEffect(() => { if (frame >= steps) setPlaying(false); }, [frame, steps]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const colors = chartColors;
    const value = (r: Row) => cost ? r.estimatedCost : time ? r.durationMs / 60000 : r.tokens;
    const visible = race && prompt ? frame : steps;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const multiple = prompt && series.length > 1;
    const description = metricDescription({ language, time, cost, prompt, cumulative, tokenType });
    const formatValue = (v: number | null) => cost ? money(v, language) : v === null ? t('Unavailable') : `${time ? decimal(v, language) : count(v, language)} ${t(time ? 'min' : 'tokens')}`;
    const tooltip = (raw: unknown) => {
      const points = [raw] as { seriesIndex: number; dataIndex: number }[];
      const first = points[0];
      if (!first) return '';
      const heading = series[first.seriesIndex]?.rows[first.dataIndex]?.label ?? '';
      const metric = t(cost ? 'Estimated cost' : time ? 'Duration' : 'Tokens');
      const category = time || tokenType === 'total' ? '' : `${t(tokenLabels[tokenType])} · `;
      const context = `${category}${t(!prompt ? 'Per run' : cumulative ? 'Cumulative' : 'Per prompt')}`;
      const lines = [`{heading|${heading} · ${metric}}`, `{context|${context}}`];
      for (const point of points) {
        const s = series[point.seriesIndex], row = s?.rows[point.dataIndex];
        if (!row) continue;
        lines.push(`{dot${setupStyle(prompt ? s.id : setupIds[point.dataIndex], prompt ? point.seriesIndex : point.dataIndex).index}|●} ${s.name || t('Value')}  {value|${formatValue(value(row))}}`);
      }
      return lines.join('\n');
    };
    chart.setOption({ animation: !reducedMotion, animationDuration: 350, animationDurationUpdate: race ? 700 : 350, animationEasingUpdate: 'linear', color: colors,
      aria: { enabled: true }, tooltip: { trigger: 'item', renderMode: 'richText', confine: true, borderColor: '#d8dfd2', formatter: tooltip, padding: [10, 14], textStyle: { fontSize: 12, lineHeight: 24, rich: { heading: { fontSize: 12, fontWeight: 600, lineHeight: 26, color: '#24382d' }, context: { fontSize: 11, lineHeight: 24, color: '#7d897e' }, value: { fontSize: 12, fontWeight: 600 }, ...Object.fromEntries(colors.map((color, i) => [`dot${i}`, { color, fontSize: 11 }])) } } },
      legend: { show: multiple, top: 8, type: 'scroll', textStyle: { color: '#526359', fontSize: 11 } },
      grid: { top: multiple ? 65 : 28, left: 75, right: prompt && race && chart.getWidth() > 700 ? 190 : 30, bottom: 55 },
      xAxis: { type: 'category', boundaryGap: !prompt, data: series[0]?.rows.map(r => r.label) ?? [], axisLine: { lineStyle: { color: '#d8dfd7' } }, axisLabel: { color: '#526359', interval: 0, fontSize: 11 } },
      yAxis: { type: 'value', max: race && prompt ? Math.max(cost ? 0.0001 : 1, ...series.flatMap(s => s.rows.map(value)).filter((v): v is number => v !== null)) * 1.1 : undefined, name: cost ? 'USD' : t(time ? 'Minutes' : 'Tokens'), nameTextStyle: { color: '#6a786f' }, splitLine: { lineStyle: { color: '#e8ece5', type: 'dashed' } }, axisLabel: { color: '#6a786f', formatter: (v: number) => cost ? money(v, language) : time ? new Intl.NumberFormat(localeFor(language), { maximumFractionDigits: 1 }).format(v) : v >= 1e6 ? `${v/1e6}M` : v >= 1000 ? `${v/1000}k` : `${v}` } },
      series: series.map((s, index) => ({ id: s.id, name: s.name || description, type: prompt ? 'line' : 'bar',
        itemStyle: { color: setupStyle(s.id,index).color },
        data: s.rows.slice(0, visible).map((r,i) => ({ value: value(r), itemStyle: { color: prompt ? setupStyle(s.id,index).color : setupStyle(setupIds[i],i).color, borderRadius: [7,7,0,0] } })),
        barMaxWidth: 100, symbolSize: 8, lineStyle: { width: 3, color: setupStyle(s.id,index).color },
        endLabel: { show: prompt && race && chart.getWidth() > 700, formatter: '{a}', color: setupStyle(s.id,index).color, fontSize: 11 },
        labelLayout: { moveOverlap: 'shiftY' }, emphasis: { focus: 'series' },
        areaStyle: prompt && !multiple ? { color: setupStyle(s.id,index).color, opacity: 0.06 } : undefined,
      })),
    }, { replaceMerge: ['series'] });
  }, [series, time, cost, prompt, language, race, frame, steps, tokenType, cumulative, setupIds]);
  function play() {
    if (playing) { setPlaying(false); return; }
    if (frame >= steps) setFrame(1);
    setPlaying(true);
  }
  return <>
    {prompt && <div className="race-controls"><label className="check"><input type="checkbox" checked={race} onChange={e => { setRace(e.target.checked); setPlaying(false); setFrame(steps); }}/>{t('Line race')}</label>{race && <>
      <button className="outline" onClick={play} disabled={steps < 2}>{t(playing ? 'Pause' : frame >= steps ? 'Replay' : 'Play')}</button>
      <button className="outline" onClick={() => { setPlaying(false); setFrame(1); }}>{t('Reset')}</button>
      <input type="range" min={1} max={Math.max(1, steps)} value={Math.max(1, frame)} aria-label={t('Prompt progression')} onChange={e => { setPlaying(false); setFrame(Number(e.target.value)); }}/>
      <span aria-live="polite">{series[0]?.rows[Math.max(0,frame-1)]?.label} · {frame}/{steps}</span>
    </>}</div>}
    <div ref={ref} className="chart" role="img" aria-label={t(cost ? 'Cost comparison; exact values in the table below' : time ? 'Duration comparison; exact values in the table below' : 'Token comparison; exact values in the table below')} />
  </>;
}

function Boxplot({ campaign, view, setup, scope, cumulative, tokenType, language }: { campaign: Campaign; view: string; setup: string; scope: string; cumulative: boolean; tokenType: TokenType; language: Language }) {
  const ref = useRef<HTMLDivElement>(null);
  const t = (text: string) => translate(language, text);
  useEffect(() => {
    const chart = echarts.init(ref.current!);
    const series = makeBoxplotSeries(campaign, view, setup, scope, cumulative, tokenType);
    const cost = view.endsWith('cost'), prompt = view.startsWith('prompt');
    const format = (v: number) => cost ? money(v, language) : count(v, language);
    const colors = chartColors;
    const multiple = prompt && series.length > 1;
    chart.setOption({ color: colors, animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      aria: { enabled: true },
      legend: { show: multiple, top: 5, type: 'scroll', textStyle: { fontSize: 11, color: '#526359' } },
      grid: { left: 85, right: 25, top: multiple ? 65 : 30, bottom: 55 },
      xAxis: { type: 'category', data: series[0]?.rows.map(r => t(r.label)) ?? [], axisLabel: { interval: 0, color: '#526359', fontSize: 11 }, axisLine: { lineStyle: { color: '#d8dfd7' } } },
      yAxis: { type: 'value', min: 0, name: cost ? 'USD' : t('Tokens'), splitLine: { lineStyle: { color: '#e8ece5', type: 'dashed' } }, axisLabel: { color: '#6a786f', formatter: (v: number) => cost ? money(v,language) : new Intl.NumberFormat(localeFor(language), { notation: 'compact', maximumFractionDigits: 1 }).format(v) } },
      tooltip: { trigger: 'item', renderMode: 'richText', confine: true, borderColor: '#d8dfd2', padding: [10,14], formatter: (raw: unknown) => {
        const point = raw as { seriesIndex: number; dataIndex: number };
        const s = series[point.seriesIndex], row = s?.rows[point.dataIndex];
        if (!row) return '';
        const title = `${prompt ? `${t(s.name)} · ` : ''}${t(row.label)}`;
        if (!row.summary) return `${title}\n${t('Unavailable')}`;
        const [min,q1,median,q3,max] = row.summary;
        return `${title}\n${t(tokenLabels[tokenType])} · ${t(prompt && cumulative ? 'Cumulative' : prompt ? 'Per prompt' : 'Per run')}\n${t('Median')}: ${format(median)}\n${t('Middle 50%')}: ${format(q1)} – ${format(q3)}\nMin–max: ${format(min)} – ${format(max)}`;
      } },
      series: series.map((s,i) => ({ id: s.id, name: t(s.name) || t('Ranges'), type: 'boxplot', boxWidth: [10, 60],
        itemStyle: { color: setupStyle(s.id,i).fill, borderColor: setupStyle(s.id,i).color, borderWidth: 2 },
        data: s.rows.map((r,j) => { const style = setupStyle(prompt ? s.id : campaign.setups[j].id, prompt ? i : j); return { value: r.summary ?? ['-', '-', '-', '-', '-'], itemStyle: { color: style.fill, borderColor: style.color, borderWidth: 2 } }; }),
      })),
    });
    const resize = new ResizeObserver(() => chart.resize()); resize.observe(ref.current!);
    return () => { resize.disconnect(); chart.dispose(); };
  }, [campaign, view, setup, scope, cumulative, tokenType, language]);
  return <div ref={ref} className="chart" role="img" aria-label={t('Run ranges: minimum, quartiles, median and maximum')}/>;
}

function ResultsTable({ rows, totals, statistic, time, cost, language }: { rows: Row[]; totals: ReturnType<typeof makeTableTotals>; statistic: string; time: boolean; cost: boolean; language: Language }) {
  const t = (text: string) => translate(language, text);
  const [sorting, setSorting] = useState<SortingState>([]);
  const columns = useMemo<ColumnDef<Row>[]>(() => [
    { accessorKey: 'label', header: t('Setup / prompt') }, { accessorKey: 'n', header: t('Runs') },
    { accessorKey: 'tokens', header: t('Tokens'), cell: x => count(x.getValue<number>(), language) },
    { accessorKey: 'durationMs', header: t('Time (min)'), cell: x => decimal(x.getValue<number>() / 60000, language) },
    { accessorKey: 'estimatedCost', header: t('Est. provider cost'), cell: x => money(x.getValue<number | null>(), language) },
    { accessorKey: 'providerCost', header: t('Exported cost'), cell: x => money(x.getValue<number | null>(), language) },
    { id: 'range', header: t(cost ? 'Cost range (USD)' : time ? 'Time range (min)' : 'Token range'), cell: x => x.row.original.min === null || x.row.original.max === null ? t('Unavailable') : cost ? `${money(x.row.original.min, language)} – ${money(x.row.original.max, language)}` : time ? `${decimal(x.row.original.min/60000, language)} – ${decimal(x.row.original.max/60000, language)}` : `${count(x.row.original.min, language)} – ${count(x.row.original.max, language)}` },
  ], [time, cost, language]);
  const table = useReactTable({ data: rows, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });
  const footerRows = [{ ...totals.overall, label: t('All selected runs') }, ...totals.perSetup.map(row => ({ ...row, label: `${t('Total per run')} · ${t(row.label)} (${t(statistic)})` }))];
  function download() {
    const keys: (keyof Row)[] = ['label','n','tokens','durationMs','estimatedCost','providerCost','min','max'];
    const csv = [keys.join(','), ...[...table.getRowModel().rows.map(r => r.original), ...footerRows].map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = 'benchmark-view.csv'; a.click(); URL.revokeObjectURL(url);
  }
  return <section className="panel table-panel"><div className="panel-heading"><div><span className="eyebrow">{t('THE NUMBERS')}</span><h2>{t('Results in detail')}</h2></div><button className="outline" onClick={download}>{t('Export CSV ↗')}</button></div><div className="table-scroll"><table><thead>{table.getHeaderGroups().map(g => <tr key={g.id}>{g.headers.map(h => <th key={h.id} aria-sort={h.column.getIsSorted() === 'asc' ? 'ascending' : h.column.getIsSorted() === 'desc' ? 'descending' : 'none'}><button onClick={h.column.getToggleSortingHandler()}>{flexRender(h.column.columnDef.header,h.getContext())}{h.column.getIsSorted() === 'asc' ? ' ↑' : h.column.getIsSorted() === 'desc' ? ' ↓' : ''}</button></th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map(r => <tr key={r.id}>{r.getVisibleCells().map(c => <td key={c.id}>{flexRender(c.column.columnDef.cell,c.getContext())}</td>)}</tr>)}</tbody><tfoot>{footerRows.map((row, index) => <tr key={index} className={index === 0 ? 'overall-total' : undefined}><th scope="row">{row.label}</th><td>{row.n}</td><td>{count(row.tokens, language)}</td><td>{decimal(row.durationMs / 60000, language)}</td><td>{money(row.estimatedCost, language)}</td><td>{money(row.providerCost, language)}</td><td>—</td></tr>)}</tfoot></table></div></section>;
}

function ConsumptionTable({ campaign, statistic, scope, tokenType, language }: { campaign: Campaign; statistic: string; scope: string; tokenType: TokenType; language: Language }) {
  const t = (text: string) => translate(language, text);
  const rows = makeConsumptionComparison(campaign, statistic, scope, tokenType);
  const percentage = (value: number | null) => value === null ? t('Unavailable') : new Intl.NumberFormat(localeFor(language), { style: 'percent', maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: 'exceptZero' }).format(value / 100);
  const tone = (value: number | null) => value === null || Math.abs(value) < .05 ? '' : value < 0 ? 'consumption-lower' : 'consumption-higher';
  return <section className="panel table-panel savings-panel"><div className="panel-heading"><div><h2>{t('Consumption versus OFF')}</h2><p className="savings-context">{t(statistic)} · {t(scope === 'all' ? 'All prompts' : 'Marginal prompts')} · {t(tokenLabels[tokenType])}</p></div></div><div className="table-scroll"><table><thead><tr><th>{t('Comparison')}</th><th>{t('Token consumption')}</th><th>{t('Estimated cost')}</th></tr></thead><tbody>{rows.map(row => <tr key={row.arm}><th scope="row">{t(row.arm === 'on-no-routing' ? 'OFF → without routing' : 'OFF → with routing')}</th><td className={tone(row.tokenChange)}>{percentage(row.tokenChange)}</td><td className={tone(row.costChange)}>{percentage(row.costChange)}</td></tr>)}</tbody></table></div></section>;
}

export default function BenchmarkPage({ source, title }: { source: string; title: string }) {
  const [language, setLanguage] = useState<Language>(readLanguage);
  const t = (text: string) => translate(language, text);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === 'fr' ? 'Traccar · Observatoire des benchmarks' : 'Traccar · Benchmark Observatory';
    try { localStorage.setItem('benchmark-language', language); } catch { /* Language still works when storage is disabled. */ }
  }, [language]);
  const [expanded, setExpanded] = useState(false);
  const expandedDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = expandedDialog.current;
    if (!dialog) return;
    if (!expanded) { if (dialog.open) dialog.close(); return; }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => { document.body.style.overflow = overflow; if (dialog.open) dialog.close(); };
  }, [expanded]);
  const [presentation, setPresentation] = useState('comparison');
  const [tokenType, setTokenType] = useState<TokenType>('total');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]), [selected, setSelected] = useState('latest');
  const [loaded, setLoaded] = useState(false), [offline, setOffline] = useState(false);
  const [view, setView] = useState('prompt-tokens'), [setup, setSetup] = useState('all'), [statistic, setStatistic] = useState('median'), [scope, setScope] = useState('all'), [cumulative, setCumulative] = useState(false);
  useEffect(() => {
    let active = true; const abort = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(`/data/${source}.json`, { cache: 'no-store', signal: abort.signal });
        if (response.status === 404) { if (active) setLoaded(true); return; }
        if (!response.ok) throw Error('Fetch failed');
        const payload = await response.json();
        if (payload.schemaVersion !== 1 || !Array.isArray(payload.campaigns)) throw Error('Invalid snapshot');
        if (active) { setCampaigns(previous => JSON.stringify(previous) === JSON.stringify(payload.campaigns) ? previous : payload.campaigns); setOffline(false); setLoaded(true); }
      } catch { if (active) { setOffline(true); setLoaded(true); } }
    };
    void refresh(); const timer = setInterval(refresh, 10000);
    return () => { active = false; abort.abort(); clearInterval(timer); };
  }, [source]);
  const campaign = selected === 'latest' ? campaigns[0] : campaigns.find(c => c.id === selected) ?? campaigns[0];
  const activeSetup = setup === 'all' || campaign?.setups.some(s => s.id === setup) ? setup : 'all';
  const prompt = view.startsWith('prompt'), time = view.endsWith('time'), cost = view.endsWith('cost');
  const hasBreakdown = campaign?.runs.every(r => r.turns.every(t => t.tokenBreakdown && t.costBreakdown)) ?? false;
  const activeTokenType = hasBreakdown ? tokenType : 'total';
  const boxplot = !time && presentation === 'boxplot';
  const effectiveStatistic = boxplot ? 'median' : statistic;
  const series = useMemo(() => campaign ? makeChartSeries(campaign, view, activeSetup, effectiveStatistic, scope, cumulative, activeTokenType).map(s => ({ ...s, name: translate(language, s.name), rows: s.rows.map(row => ({ ...row, label: translate(language, row.label) })) })) : [], [campaign, view, activeSetup, effectiveStatistic, scope, cumulative, language, activeTokenType]);
  const rows = useMemo(() => series.flatMap(s => s.rows.map(row => ({ ...row, label: prompt && activeSetup === 'all' ? `${s.name} · ${row.label}` : row.label }))), [series, prompt, activeSetup]);
  const totals = useMemo(() => campaign ? makeTableTotals(campaign, view, activeSetup, effectiveStatistic, scope, activeTokenType) : null, [campaign, view, activeSetup, effectiveStatistic, scope, activeTokenType]);
  const renderChart = () => campaign ? (boxplot ? <Boxplot campaign={campaign} view={view} setup={activeSetup} scope={scope} cumulative={cumulative} tokenType={activeTokenType} language={language}/> : <Chart key={`${campaign.id}-${view}-${activeSetup}-${statistic}-${scope}-${cumulative}-${language}-${activeTokenType}`} series={series} time={time} cost={cost} prompt={prompt} language={language} tokenType={activeTokenType} cumulative={cumulative} setupIds={campaign.setups.map(s => s.id)}/>) : null;
  return <>
    <header className="topbar"><a className="brand" href="/opencode"><span className="brand-mark">t.</span><span>traccar<span className="brand-sub"> / benchmark</span></span></a><div className="header-actions"><span className="top-note">{t('BENCHMARK OBSERVATORY')} <span className="version">01</span></span><div className="language-selector" role="group" aria-label={language === 'fr' ? 'Langue' : 'Language'}>{(['en', 'fr'] as const).map(code => <button key={code} type="button" lang={code} aria-label={code === 'en' ? 'English' : 'Français'} aria-pressed={language === code} className={language === code ? 'active' : ''} onClick={() => setLanguage(code)}>{code.toUpperCase()}</button>)}</div></div></header>
    <main><div className="breadcrumb">{t('CONTEXT EFFICIENCY')}</div>
      <div className="hero"><div><span className="eyebrow">{t('LESS CONTEXT. MORE CLARITY.')}</span><h1>{title}<br/><span>Benchmark.</span></h1><p className="lead">{t('Measure the impact of Context Mode on a real codebase.')}<br/>{t('Token consumption, execution time, and cost.')}</p></div><div className="hero-aside"><span className="status-dot"/> {t(offline ? 'Connection interrupted' : campaign ? 'Latest validated results' : 'Awaiting validated results')}<small>{t('Refreshes automatically · retains completed campaigns')}</small></div></div>
      <nav className="page-tabs" aria-label={t('Benchmark tool')}><a className={source === 'opencode' ? 'active' : ''} href="/opencode">OpenCode <span>↗</span></a><a className={source === 'vscode-copilot' ? 'active' : ''} href="/vscode-copilot">VSCode Copilot <span>↗</span></a></nav>
      {!campaign ? <section className="panel empty"><span className="eyebrow">{t(loaded ? 'NO COMPLETED CAMPAIGN' : 'LOADING RESULTS')}</span><h2>{t(loaded ? 'Ready for the first benchmark.' : 'Reading the last completed benchmark…')}</h2><p>{t(source === 'vscode-copilot' ? 'This page will populate when a complete, validated VSCode Copilot campaign is imported.' : 'A complete, validated OpenCode campaign will appear here automatically.')} {t('Partial runs never replace completed results.')}</p></section> : <>
      <section className="methodology"><div><span className="eyebrow">{t('HOW TO READ THIS BENCHMARK')}</span><p>{t('Results summarize')} <strong>{campaign.runs.length / campaign.setups.length} {t('measured runs per setup')}</strong> {t('on Traccar Web, comparing')} {campaign.setups.map(s => t(s.name)).join(', ')}. {t('Each run is a fresh')} {title} {t('session with')} {campaign.prompts.length} {t('consecutive audit prompts; context is preserved between prompts. Pilot runs are excluded.')}</p></div><dl><div><dt>{t('MODEL')}</dt><dd>{campaign.model}</dd></div><div><dt>{t('VARIANT')}</dt><dd>{campaign.variant ?? t('Not recorded')}</dd></div></dl></section>
      <details className="protocol"><summary>{t('Explore the prompt protocol and calculation method')}</summary><div className="prompt-grid">{campaign.prompts.map(p => <div key={p.id} className="prompt-card"><div className="prompt-card-heading"><b>{p.id}</b><strong>{t(promptTitles[p.name] ?? p.name.replace(/^P\d+_/, '').replace(/([a-z])([A-Z])/g,'$1 $2'))}</strong></div>{promptObjectives[p.name] && <p className="prompt-objective">{t(promptObjectives[p.name])}</p>}</div>)}</div><p>{t('Runs share the same prompt sequence and model. OpenCode rotates setup execution order between repetitions. P0 maps the repository, P1 performs the initial audit, P2–P6 audit focused features, and P7 consolidates the existing session findings. Totals and cumulative values are computed per run before aggregation. Time is the sum of selected prompt durations. Ranges show the minimum and maximum observed runs; they are not confidence intervals.')}</p></details>
      <section className="filters" aria-label={t('Benchmark filters')}><label>{t('CAMPAIGN')}<select value={selected} onChange={e => setSelected(e.target.value)}><option value="latest">{t('Latest completed')}</option>{campaigns.map(c => <option key={c.id} value={c.id}>{date(c.finishedAt, language)} Paris</option>)}</select></label><label>{t('STATISTIC')}<select value={effectiveStatistic} disabled={boxplot} onChange={e => setStatistic(e.target.value)}><option value="median">{t('Median')}</option><option value="mean">{t('Mean')}</option></select></label><label>{t('PROMPT SCOPE')}<select value={scope} onChange={e => setScope(e.target.value)}><option value="all">{t('All prompts')}</option><option value="marginal">{t('Marginal · P2–P6')}</option></select></label><label>{t('TOKEN TYPE')}<select value={activeTokenType} onChange={e => setTokenType(e.target.value as TokenType)}>{tokenTypes.map(type => <option key={type} value={type} disabled={type !== 'total' && !hasBreakdown}>{t(tokenLabels[type])}</option>)}</select></label>{prompt && <label>{t('SETUP')}<select value={activeSetup} onChange={e => setSetup(e.target.value)}><option value="all">{t('All setups')}</option>{campaign.setups.map(s => <option key={s.id} value={s.id}>{t(s.name)}</option>)}</select></label>}</section>
      <div className="view-tabs" role="group" aria-label={t('Metric view')}>{views.map(v => <button key={v.id} className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)}>{t(v.label)}</button>)}</div>
      {!time && <div className="presentation-tabs" role="group" aria-label={t('Chart type')}><button className={presentation === 'comparison' ? 'active' : ''} onClick={() => setPresentation('comparison')}>{t('Comparison')}</button><button className={boxplot ? 'active' : ''} onClick={() => setPresentation('boxplot')}>{t('Ranges')}</button></div>}
      <section className="panel"><div className="panel-heading"><div><span className="eyebrow">{boxplot ? t('Run ranges').toUpperCase() : `${t(effectiveStatistic).toUpperCase()} ${t('COMPARISON')}`}</span><h2>{t(cost ? activeTokenType === 'total' ? 'Total estimated cost' : 'Estimated cost' : time ? 'Time spent' : 'Token consumption')} <span className="muted">/ {t(prompt ? 'by prompt' : 'by setup')}</span></h2></div><div className="chart-actions"><button className="outline" aria-haspopup="dialog" onClick={() => setExpanded(true)}>{t('Expand')} ⤢</button>{prompt && <label className="check"><input type="checkbox" checked={cumulative} onChange={e => setCumulative(e.target.checked)}/> {t('Cumulative')}</label>}</div></div>{renderChart()}<div className="chart-caption"><span>↳ {t(prompt ? activeSetup === 'all' ? 'Compare all setups across prompts.' : campaign.setups.find(s => s.id === activeSetup)?.name ?? '' : 'Same protocol. Three context strategies.')}</span><span>{t(tokenLabels[activeTokenType])} · {t(scope === 'all' ? 'All prompts' : 'Marginal prompts')} · {t(effectiveStatistic)} {t('of')} {campaign.runs.length / campaign.setups.length} {t('runs')}</span></div></section>
      <p className="cost-note">{t('Token categories come from the benchmark exports. Output excludes reasoning to avoid double counting; total includes all categories. The filter applies to token counts and estimated costs. Execution time is unchanged. Exported provider cost is available only for total tokens.')}{!hasBreakdown && <> {t('Category details are unavailable for this archived campaign.')}</>}</p>
      {totals && <ResultsTable rows={rows} totals={totals} statistic={effectiveStatistic} time={time} cost={cost} language={language}/>}
      <p className="totals-note">{t('All selected runs: sum across runs, using the current prompt and token filters.')}</p>
      <ConsumptionTable campaign={campaign} statistic={effectiveStatistic} scope={scope} tokenType={activeTokenType} language={language}/>
      <aside className="cost-note"><b>{t('About estimated costs')}</b><p>{campaign.pricing.label ?? 'OpenAI API'} — {t('Estimated token costs at the recorded provider rates, not a billing statement or a measured monthly quota. Each setup value is per run, not per campaign.')} {t('Input')} ${campaign.pricing.input}, {t('cached input')} ${campaign.pricing.cacheRead}, {t('output')} ${campaign.pricing.output} {t('per million tokens.')} {t('Long-context threshold')}: {count(campaign.pricing.longContextThreshold ?? 272000, language)} tokens. {t('Calculated per call with reasoning reconciliation, cache writes, and long-context rates. Unsupported models show “Unavailable”.')} <a href={campaign.pricing.source} target="_blank" rel="noreferrer">{t('Pricing source ↗')}</a> · {t('Verified')} {new Intl.DateTimeFormat(localeFor(language), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(campaign.pricing.verifiedAt))}.</p></aside>
      </>}
      <footer><div><b>traccar / benchmark</b><span>{t('Benchmark completed:')} {campaign ? `${date(campaign.finishedAt, language)} (Europe/Paris)` : t('No completed benchmark yet')}</span>{campaign && <small>{t('Campaign started')} {date(campaign.startedAt, language)} · {t('Displaying')} {t(selected === 'latest' ? 'latest completed' : 'archived')} {t('results')}</small>}</div><p>{t('Completed results stay visible while the next benchmark runs.')}</p></footer>
    </main>
    <dialog ref={expandedDialog} className="expanded-chart" aria-labelledby="expanded-chart-title" onClose={() => setExpanded(false)}>
      {expanded && campaign && <><div className="panel-heading"><div><span className="eyebrow">{t(boxplot ? 'Run ranges' : 'COMPARISON')}</span><h2 id="expanded-chart-title">{t(cost ? activeTokenType === 'total' ? 'Total estimated cost' : 'Estimated cost' : time ? 'Time spent' : 'Token consumption')} <span className="muted">/ {t(prompt ? 'by prompt' : 'by setup')}</span></h2></div><div className="chart-actions">{prompt && <label className="check"><input type="checkbox" checked={cumulative} onChange={e => setCumulative(e.target.checked)}/>{t('Cumulative')}</label>}<button className="outline" autoFocus onClick={() => setExpanded(false)}>{t('Close')} ×</button></div></div>{renderChart()}<div className="chart-caption"><span>{t(tokenLabels[activeTokenType])} · {t(scope === 'all' ? 'All prompts' : 'Marginal prompts')}</span><span>{t('Escape to close')}</span></div></>}
    </dialog>
  </>;
}
