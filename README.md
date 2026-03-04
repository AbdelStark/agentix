# agentix

> Production-grade agentic workflow orchestrator — DDD + BDD + TDD by default, zero tolerance for slop.

An opinionated [Smithers](https://smithers.sh) workflow. You provide an RFC/PRD, Agentix decomposes it into bounded-context work units, defines executable Gherkin scenarios, runs strict RED→GREEN→REFACTOR delivery loops, and lands results through a conflict-aware merge queue.

## Core Thesis

Agentic coding quality bottlenecks are no longer "typing speed" — they are:

1. Specification quality
2. Validation quality

Agentix addresses both by hardwiring:

- **DDD** for architecture boundaries (`boundedContext`, ubiquitous language, invariants)
- **BDD** for executable specifications (`gherkinFeature`, scenario-level Given/When/Then)
- **TDD** for implementation discipline (no production code without failing tests first)

This is not a prototype-speed tool. It is designed for production-grade systems that must remain maintainable, testable, auditable, and safe at scale.

## Quick Start

From any repo with an RFC file:

```bash
# Install (or use bunx to run directly)
bun add github:AbdelStark/agentix smithers-orchestrator

# Initialize — decomposes the RFC into work units
bunx agentix init ./docs/rfc-003.md

# Review the generated plan, edit if needed
cat .agentix/work-plan.json

# Execute the workflow
bunx agentix run
```

### Prerequisites

- [Bun](https://bun.sh) >= 1.3
- [jj](https://martinvonz.github.io/jj/) (Jujutsu VCS) — `brew install jj`
  - `agentix init` automatically runs `jj git init --colocate` if the repo is not yet colocated
- At least one agent CLI: [`claude`](https://claude.ai/download) and/or [`codex`](https://openai.com/codex)

### Development Quality Gates

```bash
# local install
bun install

# required checks before commit/PR
bun run typecheck
bun test
# deterministic command-level integration harness (also included in `bun test`)
bun run test:integration
# or both in one command:
bun run check

# release metadata gate (before tagging/publish)
bun run release:check
```

## CLI

```
agentix — RFC-driven AI development workflow CLI

Usage:
  agentix init ./rfc.md              Decompose RFC into work units
  agentix plan                       (Re)generate work plan from RFC
  agentix run                        Execute the workflow
  agentix run --resume <run-id>      Resume a previous run
  agentix monitor                    Attach TUI to running workflow
  agentix dashboard                  Launch local observability dashboard
  agentix status                     Show current state
  agentix analytics summary          Telemetry summary + snapshots
  agentix analytics failures         Top failure reasons + taxonomy

Options:
  --cwd <path>                Repo root (default: cwd)
  --max-concurrency <n>       Max parallel work units (default: 6)
  --dry-run                   Generate plan without executing
  --help                      Show help
```

### `init`

Reads your RFC, scans the repo for build/test commands, detects available agent CLIs, then uses AI to decompose the RFC into work units with a dependency DAG. Each unit includes DDD boundary metadata and BDD executable scenarios.

- `.agentix/config.json` — workflow configuration
- `.agentix/work-plan.json` — work units, dependencies, tiers, acceptance criteria, bounded contexts, domain invariants, and Gherkin scenarios

You can edit the work plan before running.

### `run`

Generates a Smithers workflow file, creates agent instances, and executes. The workflow:

1. Classifies units by dependency satisfaction (active vs blocked) each pass
2. Runs quality pipelines in parallel for active units (isolated jj worktrees)
3. Lands tier-complete units onto main via the merge queue
4. Repeats until all units land or max passes reached

### `plan`

Re-runs the AI decomposition using the RFC from the existing config. Useful after editing the RFC.

### `dashboard`

Launches the local observability web platform (read-only by default) over `.agentix` data:

```bash
agentix dashboard
# -> http://127.0.0.1:43110/dashboard/index.html
```

Optional flags:

- `--host <host>` (default `127.0.0.1`)
- `--port <port>` (default `43110`)
- `--open` (open browser automatically)
- `--token <secret>` (required for non-local binds)
- `--heartbeat-ms <n>`
- `--replay-limit <n>`

### `resume`

```bash
agentix run --resume sw-m3abc12-deadbeef
```

By default, resume includes a recovery preflight for failed runs: it reopens failed nodes (while preserving a DB snapshot in `.agentix/recovery-backups/`) so work can continue instead of instantly re-failing.

```bash
# disable recovery preflight if needed
agentix run --resume sw-m3abc12-deadbeef --no-resume-recovery
```

Use `--resume-recovery false` as an explicit equivalent.

If your Smithers CLI blocks resume because the run is still marked `running`, force resume explicitly:

```bash
agentix run --resume sw-m3abc12-deadbeef --resume-force
```

Equivalent explicit boolean form: `--resume-force true`.

## How It Works

### Quality Pipeline (per unit)

Each work unit runs through a tier-based quality pipeline inside an isolated jj worktree:

| Tier | Stages | When to use |
|------|--------|-------------|
| **trivial** | implement → test | Config tweaks, dead code removal |
| **small** | implement → test → code-review | Single-file behavioral changes |
| **medium** | research → plan → implement → test → prd-review + code-review + security-review + performance-review + operational-review* → review-fix | Multi-file features |
| **large** | research → plan → implement → test → prd-review + code-review + security-review + performance-review + operational-review* → review-fix → final-review | Architectural changes |

`*` `operational-review` runs when enabled for that tier in `agentix.policy.json`.

The tier is assigned during RFC decomposition based on complexity assessment.

### DDD + BDD + TDD Contract

Each work unit now carries:

- `boundedContext` + `ubiquitousLanguage` + `domainInvariants` (DDD)
- `gherkinFeature` + `gherkinScenarios` (BDD executable spec)
- test-phase scenario coverage + trace proof metrics (`scenariosTotal`, `scenariosCovered`, `uncoveredScenarios`, `scenarioTrace`, `traceCompleteness`, `assertionSignals`, `antiSlopFlags`) used by merge readiness gates (TDD/BDD enforcement)
- policy review outputs (`security_review`, `performance_review`, `operational_review`) with structured severity, issues, remediation, and evidence
- policy configuration status output (`policy_status`) including parse warnings and effective thresholds

Units are blocked from completion when scenario coverage is incomplete.
Units are also blocked when trace completeness fails or blocking anti-slop flags are present.
Medium/large units are blocked when policy severity is `high`/`critical`, and `medium` is blocked unless remediated or explicitly accepted with rationale.

### Policy Configuration

Repo-level policy is loaded from `agentix.policy.json` (safe defaults apply when missing/invalid):

- Classes: `security`, `performance`, `operational`
- Severity model: `none`, `low`, `medium`, `high`, `critical`
- Default blocking:
  - `high`/`critical`: always block
  - `medium`: block unless fixed in review-fix or accepted with rationale
- Optional telemetry hard gate:
  - `telemetry.runNonZeroExitHardGate.enabled`
  - `telemetry.runNonZeroExitHardGate.threshold`
  - when enabled, `agentix analytics summary` fails if non-zero `run` exits meet/exceed threshold
- Policy parse/validation warnings are emitted to structured workflow output (`policy_status`) and monitor UI.

### Data Threading

Each stage reads prior outputs and feeds them forward:

```
research.contextFilePath → plan
plan.implementationSteps → implement
unit.{boundedContext,domainInvariants,gherkinScenarios} → research, plan, implement, test, final-review
implement.{filesCreated, filesModified, whatWasDone} → test, reviews
test.{buildPassed, failingSummary, scenariosCovered, uncoveredScenarios} → reviews, implement (next pass), final-review
test.{scenarioTrace, traceCompleteness, assertionSignals, antiSlopFlags} → tier gate + anti-fake-green checks + trace artifacts
reviews.{feedback, issues} → review-fix → implement (next pass)
policy-reviews.{issues, remediationActions, acceptanceRationale} → review-fix + tier gate
policy-status.{warnings, effectiveClasses} → completion report + monitor telemetry
final-review.reasoning → implement (next pass)
evictionContext → implement (after merge conflict)
```

For each merge-eligible unit, Agentix writes a deterministic trace artifact to:
- `.agentix/generated/traces/<unit-id>.json`

### Local Development Workflow (Testing Orchestrator Changes)

If you're editing Agentix locally and want to test against another repo on the same machine, the fastest path is running the local CLI entry directly from source:

```bash
# inside target repo (for example /Users/abdel/dev/me/arcade_os/compiler)
bun run /Users/abdel/dev/me/agentix/src/cli/agentix.ts run --resume <run-id>
```

This bypasses the published package and uses your in-progress local changes immediately.

Alternative:

```bash
# from agentix repo
bun link

# from target repo
bun link agentix
```

### Merge Queue

After quality pipelines complete for each pass, the merge queue:

1. Detects file overlaps between units
2. Lands non-overlapping units speculatively (parallel rebase)
3. Lands overlapping units sequentially (rebase one at a time)
4. Runs post-land CI after each rebase
5. Evicts units with conflicts or test failures — detailed context is fed back to the implementer on the next pass

All VCS operations use jj: `jj rebase`, `jj bookmark set`, `jj git push`.

### Run Observability

Agentix writes structured local telemetry events to:

- `.agentix/events.jsonl`

This stream captures command lifecycle transitions (`started`, `completed`, `failed`, `cancelled`) with run IDs and troubleshooting details.

For local-first web observability:

- `agentix dashboard`
- default URL: `http://127.0.0.1:43110/dashboard/index.html`
- secure non-local bind requires token:
  - `agentix dashboard --host 0.0.0.0 --port 43110 --token <secret>`

For aggregated telemetry intelligence:

- `agentix analytics summary --window 7d --exclude-command analytics`
- `agentix analytics failures --window 7d --top 10 --exclude-command analytics`

Artifacts generated from telemetry:

- `.agentix/analytics/daily-YYYY-MM-DD.json`
- `docs/ops/quality-report.md` (via `--write-report`)

### DAG-Driven Parallelism

Work units declare dependencies. `computeLayers()` produces topological groups:

```
Layer 0: [unit-a, unit-b]     ← no deps, run in parallel
Layer 1: [unit-c]             ← depends on unit-a
Layer 2: [unit-d, unit-e]     ← depend on unit-c
```

Layers execute sequentially; units within a layer execute in parallel (up to `maxConcurrency`).

## Library Usage

The components can be used directly in custom Smithers workflows:

```tsx
import { createSmithers } from "smithers-orchestrator";
import { scheduledOutputSchemas } from "agentix/scheduled/schemas";
import { ScheduledWorkflow } from "agentix/components";

const { smithers, outputs, Workflow } = createSmithers(
  scheduledOutputSchemas,
  { dbPath: "./workflow.db" },
);

export default smithers((ctx) => (
  <Workflow name="my-workflow" cache>
    <ScheduledWorkflow
      ctx={ctx}
      outputs={outputs}
      workPlan={workPlan}
      repoRoot="/path/to/repo"
      maxConcurrency={6}
      agents={{
        researcher:    claudeAgent,
        planner:       opusAgent,
        implementer:   codexAgent,
        tester:        claudeAgent,
        prdReviewer:   claudeAgent,
        codeReviewer:  opusAgent,
        securityReviewer: opusAgent,
        performanceReviewer: opusAgent,
        operationalReviewer: opusAgent,
        reviewFixer:   codexAgent,
        finalReviewer: opusAgent,
        mergeQueue:    opusAgent,
      }}
    />
  </Workflow>
));
```

### Components

| Component | Purpose |
|-----------|---------|
| `ScheduledWorkflow` | Main orchestrator — Ralph loop over DAG layers with pipelines + merge queue |
| `QualityPipeline` | Per-unit pipeline in an isolated worktree (research → implement → test → review) |
| `AgenticMergeQueue` | Lands completed units onto main, evicts on conflict |
| `Monitor` | TUI for observing workflow progress |

## Philosophy

`NEVER PRODUCE SLOP` is a hard rule:

- no fake-green tests
- no placeholder implementations
- no merge with uncovered executable scenarios
- no "ship now, clean later" shortcuts

Speed is valuable, but only when correctness, testability, and maintainability also improve.

## Contributor Docs

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [Production Readiness Checklist](docs/production-readiness-checklist.md)
- [Release Process](docs/release-process.md)
- [Observability](docs/observability.md)
- [Agentix Excellence Thesis](docs/agentic-excellence-thesis.md)
- [Agentix Excellence Roadmap](docs/agentic-excellence-roadmap.md)
- [Production Execution Plans](docs/execution-plans/README.md)

## References

- Cucumber docs: https://cucumber.io/docs/
- Gherkin reference: https://cucumber.io/docs/gherkin/reference
- BDD intro: https://cucumber.io/docs/bdd/
- Software 3.0 context (discussion): https://medium.com/@ben_pouladian/andrej-karpathy-on-software-3-0-software-in-the-age-of-ai-b25533da93b6

### Agent Configuration

Agents are role-based. Each role accepts a single agent or an array for fallback (Smithers v0.8+):

```tsx
agents={{
  implementer: [primaryCodex, fallbackClaude],  // array = fallback chain
  reviewer: claudeAgent,                         // single agent
}}
```

## Project Structure

```
src/
├── cli/                        # agentix CLI
│   ├── agentix.ts            # Entry point
│   ├── init-scheduled.ts       # RFC decomposition + config
│   ├── plan.ts                 # Re-generate work plan
│   ├── run.ts                  # Execute workflow
│   ├── events.ts               # Structured command event logging
│   ├── analytics.ts            # Telemetry aggregation + report synthesis
│   ├── analytics-cmd.ts        # `agentix analytics` CLI command
│   ├── adapters.ts             # Testable CLI boundary contracts
│   ├── integration/            # Deterministic command integration harness
│   ├── render-scheduled-workflow.ts  # Generate workflow.tsx (~120 lines)
│   ├── status.ts               # Show current state
│   └── monitor-cmd.ts          # Attach TUI
├── components/
│   ├── ScheduledWorkflow.tsx    # Main orchestrator
│   ├── QualityPipeline.tsx      # Per-unit quality pipeline
│   ├── AgenticMergeQueue.tsx    # Conflict-aware merge queue
│   └── Monitor.tsx              # TUI dashboard
├── prompts/                     # MDX prompt templates
│   ├── Research.mdx
│   ├── Plan.mdx
│   ├── Implement.mdx
│   ├── Test.mdx
│   ├── PrdReview.mdx
│   ├── CodeReview.mdx
│   ├── ReviewFix.mdx
│   └── FinalReview.mdx
└── scheduled/
    ├── types.ts                 # WorkPlan, WorkUnit, SCHEDULED_TIERS, computeLayers
    ├── schemas.ts               # Zod output schemas (12 tables)
    └── decompose.ts             # AI RFC decomposition
docs/
├── agentic-excellence-thesis.md
├── agentic-excellence-roadmap.md
├── execution-plans/
│   ├── 01-cli-integration-test-harness.md
│   ├── 02-scenario-trace-matrix-and-anti-slop.md
│   ├── 03-security-performance-policy-gates.md
│   ├── 04-merge-queue-risk-scoring-and-ordering.md
│   ├── 05-telemetry-aggregation-and-analytics-loop.md
│   └── README.md
├── ops/
│   └── quality-report-template.md
├── observability.md
├── production-readiness-checklist.md
└── release-process.md
.codex/skills/
├── _index.md
├── ddd-context-mapping/SKILL.md
├── bdd-gherkin-design/SKILL.md
├── tdd-red-green-refactor/SKILL.md
└── production-readiness-gates/SKILL.md
```

## License

MIT
