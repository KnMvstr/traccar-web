import { useEffect, useState } from 'react';

type ArchiveRun = { run: number; durationMs: number; turns: { id: string; durationMs: number; manualApprovalWaitMs: number }[] };
type Archive = { id: string; sourceRef: string; archiveCommit: string; archivePath: string; arm: string;
  model: string; finishedAt: string; permissionLevel: string | null; runs: ArchiveRun[] };
const minutes = (ms: number) => (ms / 60000).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

export default function CopilotArchives({ language }: { language: 'en' | 'fr' }) {
  const fr = language === 'fr';
  const [campaigns, setCampaigns] = useState<Archive[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function refresh() {
      try {
        const response = await fetch('/data/vscode-copilot-archives.json', { cache: 'no-store', signal: controller.signal });
        if (response.status === 404) return;
        if (!response.ok) throw Error('Fetch failed');
        const payload = await response.json();
        if (payload.schemaVersion !== 1 || !Array.isArray(payload.campaigns)) throw Error('Invalid archives');
        if (active) { setCampaigns(payload.campaigns); setError(false); }
      } catch { if (active) setError(true); }
    }
    void refresh();
    const timer = setInterval(refresh, 10000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, []);
  const campaign = campaigns.find(c => c.id === selected) ?? campaigns[0];
  if (!campaign) return error ? <p role="status">{fr ? 'Archives VS Code momentanément indisponibles.' : 'VS Code archives temporarily unavailable.'}</p> : null;
  const date = (value: string) => new Date(value).toLocaleString(fr ? 'fr-FR' : 'en-GB', { timeZone: 'Europe/Paris' });
  return <section className="panel table-panel">
    <div className="panel-heading"><div><span className="eyebrow">{fr ? 'CAMPAGNES ARCHIVÉES' : 'ARCHIVED CAMPAIGNS'}</span>
      <h2>{fr ? 'Résultats d’exécution VS Code' : 'VS Code execution results'}</h2>
      <p>{fr ? 'Exécution terminée · tokens et coûts non validés pour comparaison.' : 'Execution completed · token and cost comparison not validated.'}</p>
      {error && <p role="status">{fr ? 'Actualisation interrompue ; dernière archive conservée.' : 'Refresh interrupted; showing last archive.'}</p>}
    </div><a className="outline" href="/data/vscode-copilot-archives.json" download>{fr ? 'Exporter les résumés JSON' : 'Download JSON summaries'}</a></div>
    <div className="filters" style={{ padding: '0 26px' }}><label>{fr ? 'CAMPAGNE' : 'CAMPAIGN'}
      <select value={campaign.id} onChange={e => setSelected(e.target.value)}>{campaigns.map(c => <option key={c.id} value={c.id}>{c.arm.toUpperCase()} · {date(c.finishedAt)} Paris · {c.runs.length} runs</option>)}</select>
    </label></div>
    <p style={{ padding: '0 26px' }}>Context Mode {campaign.arm.toUpperCase()} · {campaign.model} · {campaign.runs.length} runs</p>
    <div className="table-scroll"><table><thead><tr><th>Run</th><th>{fr ? 'Durée totale (min)' : 'Total time (min)'}</th>
      {campaign.runs[0].turns.map(t => <th key={t.id}>{t.id} (min)</th>)}<th>{fr ? 'Attente manuelle (min)' : 'Manual wait (min)'}</th>
    </tr></thead><tbody>{campaign.runs.map(r => <tr key={r.run}><td>{r.run}</td><td>{minutes(r.durationMs)}</td>
      {r.turns.map(t => <td key={t.id}>{minutes(t.durationMs)}</td>)}<td>{minutes(r.turns.reduce((s, t) => s + t.manualApprovalWaitMs, 0))}</td>
    </tr>)}</tbody></table></div>
    <p className="savings-note">{fr ? 'Durées par tour, attente humaine comprise. Les exports bruts .json.gz sont conservés dans la branche source. Ces archives ne sont pas ajoutées aux graphiques de consommation.' : 'Per-turn durations include human waiting time. Raw .json.gz exports remain on the source branch. These archives are excluded from consumption charts.'}</p>
  </section>;
}
