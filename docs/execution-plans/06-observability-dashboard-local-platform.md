# Plan 06: Observability Dashboard Local Platform

## Objective
Ship a local-first web observability platform for Agentix with deep run telemetry, while keeping the TUI as a lightweight fallback.

## Source PRD
- `docs/prd-agentix-observability-dashboard.md`

## Milestone Plan

### Milestone 0: Foundation (Data + UI Shell)
- `OBS-01` Read Model + API foundation
- `OBS-03` Dashboard shell + visual system

### Milestone 1: Live Runtime Correlation
- `OBS-02` Unified event stream + live query layer

### Milestone 2: Core Operator Workflows
- `OBS-04` Run cockpit + DAG and stage timeline
- `OBS-05` Attempt/log/event explorer
- `OBS-06` Gate/risk/trace panels

### Milestone 3: Telemetry Expansion
- `OBS-08A` Codex telemetry adapter
- `OBS-08B` Claude telemetry adapter + resource sampler

### Milestone 4: Cross-Run Insights
- `OBS-07` Analytics trends + recommendation surfaces

### Milestone 5: Hardening + Launch
- `OBS-09` Security/redaction/perf/quality gates + release readiness

## Unit State Board
| Unit | Title | Depends On | Initial State |
|---|---|---|---|
| OBS-01 | Read Model + API Foundation | - | PENDING |
| OBS-02 | Unified Live Stream Layer | OBS-01 | PENDING |
| OBS-03 | Dashboard Shell + Design System | - | PENDING |
| OBS-04 | Run Cockpit + DAG | OBS-01, OBS-03 | PENDING |
| OBS-05 | Attempt and Log Explorer | OBS-02, OBS-03 | PENDING |
| OBS-06 | Gates, Risk, and Trace Panels | OBS-01, OBS-03 | PENDING |
| OBS-07 | Analytics and Trend Views | OBS-01, OBS-03 | PENDING |
| OBS-08A | Codex Telemetry Adapter | OBS-01 | PENDING |
| OBS-08B | Claude Telemetry + Resource Sampler | OBS-01 | PENDING |
| OBS-09 | Hardening and Launch Gates | OBS-02, OBS-04, OBS-05, OBS-06, OBS-07, OBS-08A, OBS-08B | PENDING |

## Parallelism Rules
- Can run in parallel:
  - `OBS-01` and `OBS-03`
  - `OBS-04`, `OBS-06`, `OBS-07` after `OBS-01` and `OBS-03`
  - `OBS-08A` and `OBS-08B` after `OBS-01`
- Must serialize:
  - Shared API contract/schema changes touching `src/cli/dashboard-api.ts`
  - Shared UI shell route registry in `src/dashboard/app.tsx`
  - Shared aggregation schema changes in `src/cli/dashboard-read-model.ts`

---

## Issue-Ready Unit Packets

### OBS-01 — Read Model + API Foundation
- Unit ID/title: `OBS-01 — Read Model + API Foundation`
- Bounded context: `observability-query-core`
- Ubiquitous language:
  - `run snapshot`
  - `node attempt`
  - `stage output`
  - `correlation key`
  - `read model`
- Domain invariants:
  - Read model is derived-only; it never mutates orchestration state.
  - All records are scoped by `runId` and stable node identifiers.
  - Missing sources degrade gracefully (empty dataset, no crash).
- Gherkin feature + scenarios:
  - Feature: `Serve deterministic observability snapshots from local Agentix data sources`
  - Scenario `obs01-s1`: Given a repo with `.agentix/workflow.db`, When API `GET /api/runs` is called, Then runs are returned sorted by creation descending.
  - Scenario `obs01-s2`: Given missing `.agentix/events.jsonl`, When API `GET /api/commands` is called, Then response is `200` with empty list and warning metadata.
  - Scenario `obs01-s3`: Given one run with node attempts, When API `GET /api/runs/:runId/attempts` is called, Then each attempt includes start/end/state/duration fields.
- Acceptance criteria:
  - API exposes run list, run detail, nodes, attempts, stage outputs, and command events.
  - Query adapters support pagination and deterministic sorting.
  - Unit tests cover malformed rows and missing artifact files.
- Allowed files:
  - `src/cli/dashboard-cmd.ts`
  - `src/cli/dashboard-api.ts`
  - `src/cli/dashboard-read-model.ts`
  - `src/cli/dashboard-types.ts`
  - `src/cli/__tests__/dashboard-api.test.ts`
  - `src/cli/__tests__/dashboard-read-model.test.ts`
- Forbidden files:
  - `src/components/ScheduledWorkflow.tsx`
  - `src/components/QualityPipeline.tsx`
  - `src/components/AgenticMergeQueue.tsx`
- Verification commands:
  - `bun run typecheck`
  - `bun test src/cli/__tests__/dashboard-api.test.ts src/cli/__tests__/dashboard-read-model.test.ts`
  - `bun run check`

### OBS-02 — Unified Live Stream Layer
- Unit ID/title: `OBS-02 — Unified Live Stream Layer`
- Bounded context: `observability-streaming`
- Ubiquitous language:
  - `event envelope`
  - `live cursor`
  - `stream replay`
  - `heartbeat`
- Domain invariants:
  - Event ordering is monotonic per run stream.
  - Duplicate events are idempotent by event key.
  - Stream reconnect resumes from last acknowledged cursor.
- Gherkin feature + scenarios:
  - Feature: `Stream correlated runtime events with replay safety`
  - Scenario `obs02-s1`: Given active run events, When client subscribes with no cursor, Then server emits latest replay window then live updates.
  - Scenario `obs02-s2`: Given dropped network connection, When client reconnects with `afterSeq`, Then no duplicate or missing events are rendered.
  - Scenario `obs02-s3`: Given no new events, When stream is open, Then heartbeats are emitted at configured interval.
- Acceptance criteria:
  - SSE endpoint supports replay via cursor.
  - Event envelope normalizes Smithers + Agentix command events.
  - Integration tests validate reconnect and ordering semantics.
- Allowed files:
  - `src/cli/dashboard-stream.ts`
  - `src/cli/dashboard-api.ts`
  - `src/cli/__tests__/dashboard-stream.test.ts`
- Forbidden files:
  - `src/scheduled/*`
  - `src/components/*`
- Verification commands:
  - `bun run typecheck`
  - `bun test src/cli/__tests__/dashboard-stream.test.ts`
  - `bun run check`

### OBS-03 — Dashboard Shell + Design System
- Unit ID/title: `OBS-03 — Dashboard Shell + Design System`
- Bounded context: `observability-ui-foundation`
- Ubiquitous language:
  - `cockpit shell`
  - `panel layout`
  - `command palette`
  - `design token`
- Domain invariants:
  - UI remains usable at 1280px desktop and 390px mobile widths.
  - Primary workflows are keyboard-accessible.
  - Shell renders with empty-state data without runtime errors.
- Gherkin feature + scenarios:
  - Feature: `Render a production-grade observability shell`
  - Scenario `obs03-s1`: Given app startup, When API is reachable, Then shell loads run list and default route within 2 seconds.
  - Scenario `obs03-s2`: Given no runs, When dashboard opens, Then empty-state CTA and diagnostics panel are shown.
  - Scenario `obs03-s3`: Given keyboard-only navigation, When user switches modules, Then focus and shortcuts remain deterministic.
- Acceptance criteria:
  - New web shell route and layout scaffold are in place.
  - Consistent component tokens/styles and responsive behavior are implemented.
  - Accessibility smoke checks pass.
- Allowed files:
  - `src/dashboard/*`
  - `src/dashboard/components/*`
  - `src/dashboard/styles/*`
  - `src/cli/dashboard-cmd.ts`
- Forbidden files:
  - `src/advanced-monitor-ui.ts`
  - `src/components/Monitor.tsx`
- Verification commands:
  - `bun run typecheck`
  - `bun test src/dashboard/**/*.test.ts`
  - `bun run check`

### OBS-04 — Run Cockpit + DAG
- Unit ID/title: `OBS-04 — Run Cockpit + DAG`
- Bounded context: `run-orchestration-visibility`
- Ubiquitous language:
  - `run health`
  - `phase`
  - `dependency edge`
  - `stage badge`
- Domain invariants:
  - Unit node status is computed from canonical attempt/node state, not guessed.
  - Dependency edges always map to valid work-plan unit IDs.
  - Cockpit summary and DAG counts match backend aggregates.
- Gherkin feature + scenarios:
  - Feature: `Inspect run-level execution state and dependency flow`
  - Scenario `obs04-s1`: Given a run with work-plan deps, When user opens DAG tab, Then all units and edges render with tier/stage status.
  - Scenario `obs04-s2`: Given node failures, When cockpit summary renders, Then failed counts and blocking units are highlighted.
  - Scenario `obs04-s3`: Given a selected unit, When detail drawer opens, Then stage timeline and last gate reason are visible.
- Acceptance criteria:
  - Cockpit KPIs + DAG view + unit drawer implemented.
  - Filters for tier/priority/failed/evicted are functional.
  - Snapshot tests cover representative run states.
- Allowed files:
  - `src/dashboard/modules/run-cockpit/*`
  - `src/dashboard/modules/dag/*`
  - `src/dashboard/app.tsx`
  - `src/cli/dashboard-api.ts`
- Forbidden files:
  - `src/components/ScheduledWorkflow.tsx`
- Verification commands:
  - `bun run typecheck`
  - `bun test src/dashboard/modules/run-cockpit/**/*.test.ts src/dashboard/modules/dag/**/*.test.ts`
  - `bun run check`

### OBS-05 — Attempt and Log Explorer
- Unit ID/title: `OBS-05 — Attempt and Log Explorer`
- Bounded context: `attempt-forensics`
- Ubiquitous language:
  - `attempt timeline`
  - `node output`
  - `stderr slice`
  - `prompt/response audit`
- Domain invariants:
  - Attempt timeline ordering is chronological.
  - Log lines preserve original stream (`stdout` vs `stderr`).
  - Prompt/response views are tied to exact attempt IDs.
- Gherkin feature + scenarios:
  - Feature: `Perform deterministic root-cause analysis per attempt`
  - Scenario `obs05-s1`: Given multiple retries for a node, When timeline is opened, Then attempts are grouped with duration and terminal state.
  - Scenario `obs05-s2`: Given mixed stdout/stderr chunks, When logs view renders, Then stream type is visible and filterable.
  - Scenario `obs05-s3`: Given selected attempt, When audit panel opens, Then stored prompt metadata and response text are shown.
- Acceptance criteria:
  - Attempt explorer supports search, filtering, and jump-to-event behavior.
  - Logs are virtualized for high-volume runs.
  - Correlation from event -> attempt -> log is one click.
- Allowed files:
  - `src/dashboard/modules/attempt-explorer/*`
  - `src/cli/dashboard-api.ts`
  - `src/cli/dashboard-stream.ts`
- Forbidden files:
  - `src/scheduled/*`
- Verification commands:
  - `bun run typecheck`
  - `bun test src/dashboard/modules/attempt-explorer/**/*.test.ts`
  - `bun run check`

### OBS-06 — Gates, Risk, and Trace Panels
- Unit ID/title: `OBS-06 — Gates, Risk, and Trace Panels`
- Bounded context: `readiness-intelligence`
- Ubiquitous language:
  - `gate status`
  - `trace completeness`
  - `risk band`
  - `eviction context`
- Domain invariants:
  - Gate status must mirror workflow outputs and never infer pass from missing data.
  - Trace completeness uses persisted trace artifacts only.
  - Merge risk panels reflect `merge_queue.riskSnapshot` exactly.
- Gherkin feature + scenarios:
  - Feature: `Explain readiness and merge risk with evidence`
  - Scenario `obs06-s1`: Given incomplete scenario coverage, When gate board is opened, Then failing scenarios and blocking reason are explicit.
  - Scenario `obs06-s2`: Given merge risk snapshot, When risk panel renders, Then recommended order and strategy bands match snapshot.
  - Scenario `obs06-s3`: Given evicted unit entries, When unit detail is viewed, Then latest eviction reason and details are visible.
- Acceptance criteria:
  - Gate board, trace panel, and risk panel implemented.
  - Direct links from gate failures to relevant attempts/events.
  - Tests validate all blocking gate states.
- Allowed files:
  - `src/dashboard/modules/gates/*`
  - `src/dashboard/modules/risk/*`
  - `src/dashboard/modules/trace/*`
  - `src/cli/dashboard-api.ts`
- Forbidden files:
  - `src/components/AgenticMergeQueue.tsx`
- Verification commands:
  - `bun run typecheck`
  - `bun test src/dashboard/modules/gates/**/*.test.ts src/dashboard/modules/risk/**/*.test.ts src/dashboard/modules/trace/**/*.test.ts`
  - `bun run check`

### OBS-07 — Analytics and Trend Views
- Unit ID/title: `OBS-07 — Analytics and Trend Views`
- Bounded context: `observability-analytics-ui`
- Ubiquitous language:
  - `failure taxonomy`
  - `run stability`
  - `quality recommendation`
  - `trend window`
- Domain invariants:
  - Trend views read from analytics snapshots without mutating them.
  - Metric definitions match existing CLI analytics semantics.
  - Excluded commands remain excluded in UI aggregates.
- Gherkin feature + scenarios:
  - Feature: `Visualize command reliability and quality trends`
  - Scenario `obs07-s1`: Given daily snapshots, When trends page loads, Then success/failure/cancellation trends are graphed by date.
  - Scenario `obs07-s2`: Given taxonomy distribution, When failures panel opens, Then top reasons are grouped by command and taxonomy.
  - Scenario `obs07-s3`: Given recommendation entries, When insights panel renders, Then priority/category/action fields are visible.
- Acceptance criteria:
  - Trends UI renders snapshots and recommendations.
  - Empty snapshots and malformed snapshot handling tested.
  - Numeric parity with CLI summary verified in tests.
- Allowed files:
  - `src/dashboard/modules/analytics/*`
  - `src/cli/dashboard-api.ts`
  - `src/cli/analytics.ts` (read-only extension if necessary)
- Forbidden files:
  - `src/components/*`
- Verification commands:
  - `bun run typecheck`
  - `bun test src/dashboard/modules/analytics/**/*.test.ts src/cli/analytics.test.ts`
  - `bun run check`

### OBS-08A — Codex Telemetry Adapter
- Unit ID/title: `OBS-08A — Codex Telemetry Adapter`
- Bounded context: `agent-runtime-telemetry`
- Ubiquitous language:
  - `agent event`
  - `tool execution record`
  - `token usage`
  - `adapter normalization`
- Domain invariants:
  - Adapter ingestion cannot break task success/failure semantics.
  - Unsupported event shapes are logged and ignored, not fatal.
  - Event records are linked to `runId/nodeId/attempt` when available.
- Gherkin feature + scenarios:
  - Feature: `Capture Codex runtime telemetry for observability`
  - Scenario `obs08a-s1`: Given Codex JSON event output, When adapter processes stream, Then normalized tool events are stored with timestamps.
  - Scenario `obs08a-s2`: Given malformed event lines, When parser runs, Then ingestion continues and parse errors are counted.
  - Scenario `obs08a-s3`: Given task completion, When telemetry is queried, Then events are correlated to the correct attempt.
- Acceptance criteria:
  - Feature-flagged Codex telemetry capture implemented.
  - Normalized storage and API exposure in dashboard read model.
  - Contract tests with recorded fixtures pass.
- Allowed files:
  - `src/cli/dashboard-telemetry-adapters/codex.ts`
  - `src/cli/dashboard-read-model.ts`
  - `src/cli/render-scheduled-workflow.ts`
  - `src/cli/__tests__/dashboard-codex-adapter.test.ts`
- Forbidden files:
  - `src/components/*`
  - `src/scheduled/*`
- Verification commands:
  - `bun run typecheck`
  - `bun test src/cli/__tests__/dashboard-codex-adapter.test.ts`
  - `bun run check`

### OBS-08B — Claude Telemetry Adapter + Resource Sampler
- Unit ID/title: `OBS-08B — Claude Telemetry Adapter + Resource Sampler`
- Bounded context: `agent-runtime-telemetry`
- Ubiquitous language:
  - `stream-json telemetry`
  - `resource sample`
  - `cpu/memory envelope`
  - `sampling interval`
- Domain invariants:
  - Claude telemetry mode is flag-gated and rollback-safe.
  - Resource sampling overhead remains below agreed threshold.
  - Missing OS counters never fail workflow execution.
- Gherkin feature + scenarios:
  - Feature: `Capture Claude runtime telemetry and process resource envelopes`
  - Scenario `obs08b-s1`: Given Claude stream-json output, When adapter ingests events, Then normalized records are stored with correlation keys.
  - Scenario `obs08b-s2`: Given sampler enabled, When run executes, Then periodic CPU/memory samples are persisted and queryable.
  - Scenario `obs08b-s3`: Given unsupported platform signal, When sampler runs, Then warning is emitted and workflow continues.
- Acceptance criteria:
  - Claude telemetry adapter implemented behind feature flag.
  - Resource sampler integrated and queryable in dashboard.
  - Performance budget documented and validated.
- Allowed files:
  - `src/cli/dashboard-telemetry-adapters/claude.ts`
  - `src/cli/dashboard-resource-sampler.ts`
  - `src/cli/dashboard-read-model.ts`
  - `src/cli/render-scheduled-workflow.ts`
  - `src/cli/__tests__/dashboard-claude-adapter.test.ts`
  - `src/cli/__tests__/dashboard-resource-sampler.test.ts`
- Forbidden files:
  - `src/components/*`
- Verification commands:
  - `bun run typecheck`
  - `bun test src/cli/__tests__/dashboard-claude-adapter.test.ts src/cli/__tests__/dashboard-resource-sampler.test.ts`
  - `bun run check`

### OBS-09 — Hardening and Launch Gates
- Unit ID/title: `OBS-09 — Hardening and Launch Gates`
- Bounded context: `observability-release-governance`
- Ubiquitous language:
  - `merge-eligible`
  - `scenario coverage`
  - `quality gate`
  - `land vs evict`
- Domain invariants:
  - All new units satisfy full gate criteria before READY.
  - Security/redaction checks fail closed on uncertain masking.
  - Release checks include dashboard build/type/test and CLI compatibility.
- Gherkin feature + scenarios:
  - Feature: `Enforce production-readiness for dashboard rollout`
  - Scenario `obs09-s1`: Given all unit implementations complete, When readiness check runs, Then uncovered scenarios list is empty.
  - Scenario `obs09-s2`: Given sensitive token-like strings in logs, When redaction checks run, Then secrets are masked in UI/API output.
  - Scenario `obs09-s3`: Given tagged release flow, When release gate executes, Then `bun run release:check` passes with dashboard artifacts included.
- Acceptance criteria:
  - Production checklist updated with dashboard-specific gates.
  - Redaction, performance, and compatibility tests pass.
  - Documentation updated for runbook and local launch.
- Allowed files:
  - `docs/observability.md`
  - `docs/production-readiness-checklist.md`
  - `docs/release-process.md`
  - `README.md`
  - `src/cli/dashboard-cmd.ts`
  - `src/cli/__tests__/dashboard-security.test.ts`
- Forbidden files:
  - `src/scheduled/decompose.ts`
  - `src/scheduled/types.ts`
- Verification commands:
  - `bun run typecheck`
  - `bun test`
  - `bun run check`
  - `bun run release:check`

---

## Merge Readiness Gates (Enforced Per Unit)
A unit transitions `REVIEW -> READY` only when all are true:
1. `testsPassed == true`
2. `buildPassed == true` (or explicit final gate override)
3. `scenariosCovered == scenariosTotal`
4. `uncoveredScenarios` is empty
5. Review severities are acceptable
6. Domain invariants remain true
7. `bun run check` passes
8. CI typecheck + tests are green
9. Tagged release path passes `bun run release:check`

## Human Escalation Triggers
Escalate immediately when:
- Invariant conflict between PRD and current orchestration behavior.
- Scenario ambiguity blocks deterministic test design.
- Cross-context API contract changes require architecture decision.
- Security/compliance risk is detected in prompt/log telemetry exposure.

## Definition of Done
- All units reach `LANDED` via the protocol state machine.
- Dashboard runs locally with live and historical observability coverage.
- TUI remains functional as fallback and does not regress.
- Documentation and release gates include the dashboard platform.
