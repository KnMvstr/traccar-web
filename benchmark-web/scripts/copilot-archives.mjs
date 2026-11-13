import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

export function summarizeArchive(manifest, campaign, origin) {
  if (campaign.complete !== true || campaign.executionValid !== true) throw Error('Campaign execution not complete');
  if (!Number.isSafeInteger(manifest.runs) || manifest.runs < 1 || campaign.runs?.length !== manifest.runs) throw Error('Incomplete runs');
  if (!Array.isArray(manifest.prompts) || manifest.prompts.length !== 8 || manifest.prompts.some((p, i) => p.id !== `P${i}`)) throw Error('Expected P0–P7');
  if (!['off', 'on'].includes(manifest.arm) || !manifest.model?.id || !Number.isFinite(Date.parse(manifest.createdAt))) throw Error('Invalid manifest');
  const seen = new Set();
  const runs = campaign.runs.map(run => {
    if (run.executionValid !== true || !Number.isSafeInteger(run.run) || run.run < 1 || run.run > manifest.runs || seen.has(run.run)
      || run.turns?.length !== manifest.prompts.length || !Number.isFinite(Date.parse(run.finishedAt))) throw Error('Invalid run');
    seen.add(run.run);
    const turns = run.turns.map((turn, i) => {
      if (turn.id !== manifest.prompts[i].id || turn.executionValid !== true || !Number.isFinite(turn.durationMs) || turn.durationMs < 0) throw Error('Invalid turn');
      return { id: turn.id, durationMs: turn.durationMs, manualApprovalWaitMs: turn.manualApprovalWaitMs ?? 0 };
    });
    return { run: run.run, finishedAt: run.finishedAt, durationMs: turns.reduce((sum, t) => sum + t.durationMs, 0), turns };
  });
  // Raw usage remains deliberately outside normalized token/cost datasets.
  return { id: `${origin.commit}:${origin.path}`, sourceRef: origin.ref, archiveCommit: origin.commit,
    archivePath: origin.path, arm: manifest.arm, model: manifest.model.id, sourceCommit: manifest.commit,
    startedAt: manifest.createdAt, finishedAt: runs.map(r => r.finishedAt).sort().at(-1),
    executionValid: true, metricsComparable: false, permissionLevel: manifest.permissionLevel ?? null, runs };
}

export function publishCopilotArchives(repo, output, refs = ['origin/vscode-gthb-copilot-off', 'origin/vscode-gthb-copilot-on']) {
  const destination = resolve(output, 'vscode-copilot-archives.json');
  const previous = existsSync(destination) ? JSON.parse(readFileSync(destination, 'utf8')) : { schemaVersion: 1, campaigns: [] };
  const campaigns = [];
  const errors = [];
  for (const ref of refs) {
    try {
      const commit = git(repo, 'rev-parse', '--verify', `${ref}^{commit}`);
      const files = git(repo, 'ls-tree', '-r', '--name-only', commit, '--', 'results/vscode-copilot/campaigns').split('\n');
      for (const file of files.filter(f => /^results\/vscode-copilot\/campaigns\/[^/]+\/(off|on)\/campaign\.json$/.test(f))) {
        const path = file.slice(0, -'/campaign.json'.length);
        try {
          const read = name => JSON.parse(git(repo, 'show', `${commit}:${path}/${name}`));
          const campaign = summarizeArchive(read('manifest.json'), read('campaign.json'), { ref, commit, path });
          if (!campaigns.some(c => c.archivePath === campaign.archivePath && c.sourceCommit === campaign.sourceCommit)) campaigns.push(campaign);
        } catch (error) { errors.push(`${ref}: ${path}: ${error.message}`); }
      }
    } catch { errors.push(`Source branch unavailable: ${ref}`); }
  }
  // Keep the last usable archive when a branch or a file temporarily disappears.
  for (const campaign of previous.campaigns) {
    if (!campaigns.some(c => c.archivePath === campaign.archivePath && c.sourceCommit === campaign.sourceCommit)) campaigns.push(campaign);
  }
  campaigns.sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
  const payload = { schemaVersion: 1, campaigns, errors };
  if (JSON.stringify(previous) === JSON.stringify(payload)) return { source: 'vscode-copilot-archives', updated: false, campaigns: campaigns.length };
  mkdirSync(output, { recursive: true });
  const temp = `${destination}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(payload, null, 2) + '\n');
  renameSync(temp, destination);
  return { source: 'vscode-copilot-archives', updated: true, campaigns: campaigns.length, errors };
}
