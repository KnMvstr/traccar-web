import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { summarizeArchive, publishCopilotArchives } from './copilot-archives.mjs';

function fixture() {
  const prompts = Array.from({ length: 8 }, (_, i) => ({ id: `P${i}` }));
  const manifest = { arm: 'off', runs: 1, model: { id: 'model' }, commit: 'measured', createdAt: '2026-11-12T20:00:00Z', prompts };
  const campaign = { complete: true, executionValid: true, runs: [{ run: 1, executionValid: true,
    finishedAt: '2026-11-12T21:00:00Z', turns: prompts.map(p => ({ ...p, executionValid: true, durationMs: 100, rawUsage: { private: 'raw-content' } })) }] };
  return { manifest, campaign };
}

test('archives expose execution durations without inventing validated token or cost metrics', () => {
  const { manifest, campaign } = fixture();
  const summary = summarizeArchive(manifest, campaign, { ref: 'off', commit: 'archive', path: 'campaign' });
  assert.equal(summary.runs[0].durationMs, 800);
  assert.equal(summary.metricsComparable, false);
  assert.equal(summary.sourceCommit, 'measured');
  assert.ok(!JSON.stringify(summary).includes('raw-content'));
  assert.equal(summary.runs[0].tokens, undefined);
});

test('partial campaigns, missing prompts and invalid durations are rejected', () => {
  const origin = { ref: 'off', commit: 'a', path: 'p' };
  for (const change of [c => { c.complete = false; }, c => { c.runs[0].turns.pop(); }, c => { c.runs[0].turns[0].durationMs = -1; }]) {
    const { manifest, campaign } = fixture(); change(campaign);
    assert.throws(() => summarizeArchive(manifest, campaign, origin));
  }
});

test('reads results on another Git branch without checking it out and retains last archive on unavailable source', t => {
  const root = mkdtempSync(join(tmpdir(), 'copilot-archive-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'); mkdirSync(repo);
  // Trust only this temporary fixture, without changing the user's Git config.
  const index = Number(process.env.GIT_CONFIG_COUNT ?? 0);
  const config = { GIT_CONFIG_COUNT: String(index + 1), [`GIT_CONFIG_KEY_${index}`]: 'safe.directory', [`GIT_CONFIG_VALUE_${index}`]: realpathSync.native(repo).replaceAll('\\', '/') };
  const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-q');
  const branch = 'vscode-gthb-copilot-off';
  const path = join(repo, 'results/vscode-copilot/campaigns/stamp/off'); mkdirSync(path, { recursive: true });
  const { manifest, campaign } = fixture();
  writeFileSync(join(path, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(path, 'campaign.json'), JSON.stringify(campaign));
  git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  git('branch', branch);
  git('checkout', '-qb', 'dashboard');
  const output = join(root, 'output');
  assert.equal(publishCopilotArchives(repo, output, [branch]).campaigns, 1);
  assert.equal(git('branch', '--show-current'), 'dashboard');
  assert.equal(publishCopilotArchives(repo, output, [branch]).updated, false);
  publishCopilotArchives(repo, output, ['missing']);
  const saved = JSON.parse(readFileSync(join(output, 'vscode-copilot-archives.json')));
  assert.equal(saved.campaigns.length, 1);
  assert.equal(saved.errors.length, 1);
});
