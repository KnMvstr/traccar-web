const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

function positiveInteger(value, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw Error(`${label} must be a positive integer`);
  return n;
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function loadSuite(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'suite.json'), 'utf8'));
  const ids = new Set();
  return manifest.prompts.map(prompt => {
    const file = path.resolve(dir, prompt.file);
    if (!file.startsWith(path.resolve(dir) + path.sep)) throw Error('Prompt outside suite');
    if (ids.has(prompt.id)) throw Error(`Duplicate prompt ${prompt.id}`);
    ids.add(prompt.id);
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) throw Error(`Empty prompt ${prompt.id}`);
    return { ...prompt, text, sha256: createHash('sha256').update(text).digest('hex') };
  });
}

function validateExport(session, expected, modelId, priorRequestIds = []) {
  const requests = session.requests;
  if (!Array.isArray(requests) || requests.length !== expected.length) {
    throw Error('Unexpected session or request count; the active chat may have changed');
  }
  for (let i = 0; i < requests.length; i++) {
    const r = requests[i];
    if (r.message?.text !== expected[i]) throw Error(`Prompt mismatch at turn ${i + 1}`);
    if (!r.requestId || (i < priorRequestIds.length && r.requestId !== priorRequestIds[i])) {
      throw Error('Conversation continuity lost');
    }
    if (!r.modelId || r.modelId !== modelId) throw Error('Model changed or missing from export');
    // In the installed VS Code schema: 0=in progress, 1=complete, 2=cancelled.
    // Export rewrites an in-progress response as cancelled: never accept that state.
    if (r.modelState?.value !== 1 || !Number.isFinite(r.modelState?.completedAt)) {
      throw Error(`Turn ${i + 1} not successfully completed (unsupported schema or interruption)`);
    }
    if (r.result?.errorDetails) throw Error(`Assistant error at turn ${i + 1}`);
    if (!Array.isArray(r.response) || !r.response.some(p =>
      (typeof p.value === 'string' && p.value.trim()) ||
      (p.kind === 'markdownContent' && p.content?.value?.trim()))) {
      throw Error(`Missing final response text at turn ${i + 1}`);
    }
  }
  return requests.at(-1);
}

function summarizeTurn(prompt, request, durationMs) {
  return {
    id: prompt.id, name: prompt.name, measure: prompt.measure,
    requestId: request.requestId, modelId: request.modelId, durationMs,
    modelConfiguration: request.modelConfiguration, modeInfo: request.modeInfo,
    executionValid: true,
    // promptTokens may describe only the latest model call, not a whole agent turn.
    metricsComparable: false,
    rawUsage: Object.fromEntries([
      'promptTokens', 'completionTokens', 'lastCallCompletionTokens', 'promptTokenDetails',
      'modelTotals', 'latestModelCall', 'contextUsage', 'copilotCredits', 'elapsedMs',
    ].filter(key => request[key] !== undefined).map(key => [key, request[key]])),
    toolCalls: request.response.filter(p => /toolInvocation/i.test(p.kind || '')),
  };
}

module.exports = { positiveInteger, git, loadSuite, validateExport, summarizeTurn };
