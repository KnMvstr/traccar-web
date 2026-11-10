# Benchmark Observatory

Local React/TypeScript dashboard with separate `/opencode` and `/vscode-copilot`
pages, ECharts visualizations, sortable tables, CSV export and campaign history.

The default view compares all setups as separate lines across prompts. The setup
selector can focus on a single configuration. Token and time prompt views also
offer line-race playback with pause, replay, reset and a prompt slider; the
cumulative toggle applies to every displayed line. The detail table and CSV
include each selected setup/prompt combination.

Cost views show the total estimated USD token cost per prompt or per setup,
including all model calls and token categories. Cumulative prompt costs are
summed within each run before computing the selected median or mean. Unknown
costs remain unavailable rather than being displayed as zero.

```powershell
cd benchmark-web
npm install
npm run dev
```

Open the URL printed by Vite. For the production build with automatic updates:

```powershell
npm run build
npm start
```

Open `http://127.0.0.1:4173/opencode` or
`http://127.0.0.1:4173/vscode-copilot`.

## Automatic updates and last completed results

The OpenCode runner invokes the data publisher after both comparisons succeed.
The development and production servers also scan source results every five
seconds; open pages fetch their saved snapshots every ten seconds. No model
calls are made. The production server serves current snapshots separately from
the built assets, so a new benchmark does not require a frontend rebuild.

The publisher checks every expected setup/run/prompt, excludes pilots, verifies
model/variant/commit consistency, and requires both validated OpenCode comparison
reports to match the actual run files. Partial writes, failed campaigns, missing
files and stale reports leave the saved data untouched. Each source has an
independent snapshot; writes replace the complete JSON atomically.

`public/data/opencode.json` and `public/data/vscode-copilot.json` retain all
accepted campaigns, with newest completed first. These files are intentionally
versionable and should be kept/backed up to preserve history when `results/` is
overwritten. Existing historical campaigns cannot be recovered if their results
were already overwritten before this dashboard was installed. The campaign
selector allows viewing previous accepted results. Each page footer shows the
completion date and start date of the selected benchmark in Europe/Paris.

To refresh snapshots without a server: `npm run prepare-data`.
To run regression checks: `npm test`.

## VSCode Copilot importer

There is no VSCode benchmark runner in this repository yet. The VSCode page is
ready for normalized results and remains empty until a real completed campaign
is supplied; OpenCode runs using the Copilot provider are not VSCode results.

By default, write these files under `results/vscode-copilot/`:

- `manifest.json`: `model`, optional `variant`, `createdAt` (ISO date), `runs`
  (positive integer IDs), `branches` (setup IDs to labels), and `refs` (setup
  IDs to immutable source commit IDs).
- `completed.json`: `{ "complete": true, "valid": true, "runs": [...] }`.
  The producing runner must set both flags only after its validation succeeds.

Each run in `completed.json` must contain:

```json
{
  "arm": "off",
  "run": 1,
  "model": "github-copilot/gpt-5.6-luna",
  "variant": "medium",
  "commit": "source-commit-matching-manifest-refs",
  "valid": true,
  "workingTreeChanged": false,
  "startedAt": "2026-11-10T10:00:01Z",
  "finishedAt": "2026-11-10T10:01:00Z",
  "durationMs": 59000,
  "expectedPrompts": [{ "id": "P0", "name": "P0_Inventory", "measure": "setup" }],
  "turns": [{
    "id": "P0", "valid": true, "comparable": true,
    "contextDiverged": false, "durationMs": 59000,
    "costKnown": false,
    "calls": [{ "tokens": {
      "total": 140, "input": 100, "output": 20, "reasoning": 10,
      "cache": { "read": 10, "write": 0 }
    }}]
  }]
}
```

Include all expected prompts and every setup × run combination. Use the actual
VSCode model, variant and measurements. Unknown provider costs remain null.
Write the completion marker last. The running server will import it
automatically, or invoke `npm run prepare-data` as the producer's final step.
Override source directories with `OPENCODE_RESULTS` and `COPILOT_RESULTS`
environment variables (prefer absolute paths).

## Pricing and deployment

`config/pricing.json` stores the source, verification date and USD token rates for GitHub Copilot.
Updating the file re-estimates the currently available completed campaign on
the next scan. Historical campaigns retain their recorded pricing snapshot.
Rates are not silently fetched or changed; verify and update the configuration
when the official pricing changes. Unsupported model IDs yield unknown estimates.
Reasoning is included once according to exported totals. Long-context multipliers
are applied per call. Actual provider costs remain separate.

The published JSON contains metrics, setup labels and prompt names, excluding
raw session messages, workspace paths and tool traces. No remote hosting is
configured. Static hosting of `dist/` requires rerunning the build and deploying
after benchmarks; use the included Node server for automatic local updates.

## Token category filter

The category selector supports total tokens (default), uncached input, output
excluding reasoning, reasoning, combined cache, cache reads, and cache writes.
It updates token charts, the detail table, CSV output, and category-specific
cost estimates; execution durations stay the same. Output and reasoning are
reconciled per call so that category totals match exported token totals.
Exported provider costs cannot be attributed to categories and are therefore
unavailable when a category is selected. Older archived campaigns without
category details offer the total view only.

The current price profile applies only to `github-copilot/gpt-5.6-luna`, using
GitHub Copilot's published USD rates and its 200,000-input-token long-context
threshold. These remain estimates, not a GitHub billing export or a measurement
of the user's subscription quota. Other providers/models show unavailable costs
until a matching profile is configured.

## Run ranges

Tokens and cost views offer a Comparison / Ranges (boxplot) switch for both
setups and prompts. Each box uses individual runs: Q1, median and Q3 use linear
interpolation (R7), and whiskers show the observed minimum and maximum. This is
the min–max boxplot convention, not Tukey's 1.5-IQR whiskers. Small samples
should be interpreted with care. Unknown costs remain unavailable. Token type,
prompt scope, setup and cumulative filters are preserved; cumulative totals
are formed within each run before computing quartiles. The treemap was removed.
