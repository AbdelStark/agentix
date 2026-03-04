# Plan 07: Production-Grade Telemetry and Observability Hardening

## Objective
Upgrade the web dashboard from basic telemetry tables to production-grade observability with:
- explicit prompt auditability,
- exact execution-step visibility,
- a unified correlated timeline across all local telemetry sources,
- deterministic evidence for operator debugging and release readiness.

## Scope
- In scope:
  - Run-scoped prompt telemetry projection.
  - Run-scoped execution step projection.
  - Run-scoped unified event timeline projection.
  - API contract extensions and dashboard telemetry cockpit upgrades.
  - Deterministic test coverage and quality gate enforcement.
- Out of scope:
  - External SaaS telemetry backends.
  - Mutating orchestration state from dashboard surfaces.

## Gap Analysis (Current -> Target)

| Capability | Current State | Gap | Target |
|---|---|---|---|
| Prompt visibility | Only visible for one selected attempt in Attempt Explorer | No run-wide prompt audit index, no correlation metadata | Run-wide prompt audit feed with node/attempt/timing/response context |
| Exact step visibility | Attempts list exists but not normalized as execution-step model | No dedicated unit/stage execution projection for telemetry workflows | Deterministic execution-step projection (unit, stage, iteration, attempt, state, duration, prompt evidence) |
| Timeline correlation | Live feed + tables exist in separate modules | No single timeline across Smithers events, command events, tool telemetry, and resource samples | Unified sorted timeline with source/category/correlation keys and summaries |
| Telemetry usability | Tool/resource tables are shallow | Low operator signal density; difficult forensic traversal | Telemetry cockpit with KPIs, filters, step timeline, prompt audit, and unified event stream |
| Production-readiness evidence | Existing tests cover core dashboard baseline | Missing scenario coverage for new observability contracts | New deterministic tests for read model, API, and UI telemetry rendering |

## Bounded Context Map

1. `telemetry-projection-core`
- Purpose: derive deterministic read-model projections from local data sources.
- Aggregates: prompt audit entries, execution step entries, unified timeline entries.

2. `observability-api-contract`
- Purpose: expose projection data through stable, read-only HTTP contracts.
- Aggregates: `/api/runs/:runId/prompts`, `/api/runs/:runId/execution-steps`, `/api/runs/:runId/timeline`.

3. `observability-telemetry-cockpit`
- Purpose: render production operator workflows over telemetry projections.
- Aggregates: telemetry summary cards, prompt audit table, step timeline table, unified timeline feed.

## Ubiquitous Language
- `prompt audit`: normalized prompt/response metadata for an attempt.
- `execution step`: one stage attempt with timing/state and extracted prompt evidence.
- `timeline event`: normalized event in correlated run chronology.
- `correlation key`: stable identity for dedupe and cross-source linking.
- `projection`: read-only derived representation over persisted telemetry sources.

## Domain Invariants
1. Projections are read-only and never mutate orchestration state.
2. Timeline ordering is deterministic by `(timestampMs desc, stable tie-breaker)`.
3. Correlation keys are stable and idempotent for repeated reads.
4. Prompt extraction fails closed (empty values) and never throws on malformed metadata.
5. Missing telemetry sources degrade gracefully to empty results + warnings.
6. API output remains secret-redacted by existing redaction middleware.
7. Dashboard telemetry UI must render meaningful empty states without runtime errors.

## Unit State Board

| Unit | Title | Bounded Context | Depends On | Initial State |
|---|---|---|---|---|
| OBS-10 | Telemetry Projection Contracts | telemetry-projection-core | - | PENDING |
| OBS-11 | Prompt + Execution Step Projections | telemetry-projection-core | OBS-10 | PENDING |
| OBS-12 | Unified Timeline Projection + API Routes | observability-api-contract | OBS-10, OBS-11 | PENDING |
| OBS-13 | Telemetry Cockpit UI Upgrade | observability-telemetry-cockpit | OBS-11, OBS-12 | PENDING |
| OBS-14 | Hardening, Tests, and Gates | cross-context quality gate | OBS-10, OBS-11, OBS-12, OBS-13 | PENDING |

State machine: `PENDING -> ACTIVE -> REVIEW -> {READY -> LANDED | EVICTED -> ACTIVE}`.

## Parallelism Rules
- Can run in parallel:
  - `OBS-11` and non-overlapping parts of `OBS-13` after projection contracts stabilize.
- Must serialize:
  - Shared files: `src/cli/dashboard-read-model.ts`, `src/cli/dashboard-api.ts`, `src/dashboard/app.tsx`.
  - Any API contract/type changes in `src/cli/dashboard-types.ts`.

---

## Issue-Ready Task Packets

### OBS-10 — Telemetry Projection Contracts
- Unit ID/title: `OBS-10 — Telemetry Projection Contracts`
- Bounded context: `telemetry-projection-core`
- Ubiquitous language: `projection`, `correlation key`, `timeline event`
- Domain invariants:
  - New telemetry types are deterministic and read-only.
  - Contracts support graceful empty/missing-source responses.
- Gherkin feature + scenarios:
  - Feature: `Define deterministic projection contracts for dashboard telemetry`
  - Scenario `obs10-s1`: Given a run with no telemetry files, When projection APIs are queried, Then empty item sets and warnings are returned.
  - Scenario `obs10-s2`: Given projection records with equal timestamps, When sorted output is returned, Then tie-breaking remains deterministic.
  - Scenario `obs10-s3`: Given malformed metadata payloads, When projection parsing runs, Then parser recovers without process failure.
- Acceptance criteria:
  - New dashboard telemetry types are added and exported.
  - Sort and parsing helpers are deterministic and covered by tests.
- Allowed files:
  - `src/cli/dashboard-types.ts`
  - `src/cli/dashboard-read-model.ts`
  - `src/cli/__tests__/dashboard-read-model.test.ts`
- Forbidden files:
  - `src/components/*`
  - `src/scheduled/*`
- Verification commands:
  - `bun run typecheck`
  - `bun test src/cli/__tests__/dashboard-read-model.test.ts`

### OBS-11 — Prompt + Execution Step Projections
- Unit ID/title: `OBS-11 — Prompt + Execution Step Projections`
- Bounded context: `telemetry-projection-core`
- Ubiquitous language: `prompt audit`, `execution step`
- Domain invariants:
  - Prompt extraction is resilient across `meta.prompt`, `meta.input.prompt`, and message arrays.
  - Execution-step rows map exactly to attempts and preserve attempt chronology.
- Gherkin feature + scenarios:
  - Feature: `Project prompt and step telemetry for forensic debugging`
  - Scenario `obs11-s1`: Given attempt metadata with direct prompt fields, When prompt projection runs, Then prompt text and hash fields are emitted.
  - Scenario `obs11-s2`: Given attempts spanning multiple stages, When execution-step projection runs, Then stage/unit IDs and timing fields are normalized.
  - Scenario `obs11-s3`: Given missing or malformed metadata, When projection runs, Then entries remain present with null/empty prompt fields.
- Acceptance criteria:
  - Read model exposes prompt audit and execution-step listing methods.
  - Output includes correlation fields (`runId`, `nodeId`, `iteration`, `attempt`).
  - Tests validate prompt extraction fallbacks and deterministic ordering.
- Allowed files:
  - `src/cli/dashboard-read-model.ts`
  - `src/cli/dashboard-types.ts`
  - `src/cli/__tests__/dashboard-read-model.test.ts`
- Forbidden files:
  - `src/components/*`
  - `src/scheduled/*`
- Verification commands:
  - `bun run typecheck`
  - `bun test src/cli/__tests__/dashboard-read-model.test.ts`

### OBS-12 — Unified Timeline Projection + API Routes
- Unit ID/title: `OBS-12 — Unified Timeline Projection + API Routes`
- Bounded context: `observability-api-contract`
- Ubiquitous language: `timeline event`, `source`, `category`
- Domain invariants:
  - Timeline merges Smithers events, command events, tool events, and resource samples under one deterministic sort.
  - API endpoints remain read-only and token/auth guarded.
- Gherkin feature + scenarios:
  - Feature: `Expose correlated run telemetry over dashboard API`
  - Scenario `obs12-s1`: Given telemetry across multiple sources, When timeline API is queried, Then events are merged and sorted newest-first.
  - Scenario `obs12-s2`: Given prompt and step projections, When API endpoints are queried, Then data includes stable correlation keys.
  - Scenario `obs12-s3`: Given secret-like values in payloads, When API responds, Then values are redacted.
- Acceptance criteria:
  - API routes added for prompts, execution steps, and timeline.
  - Endpoint responses are paginated and warning-aware.
  - API tests cover contracts and security redaction behavior.
- Allowed files:
  - `src/cli/dashboard-api.ts`
  - `src/cli/dashboard-read-model.ts`
  - `src/cli/dashboard-types.ts`
  - `src/cli/__tests__/dashboard-api.test.ts`
  - `src/cli/__tests__/dashboard-security.test.ts`
- Forbidden files:
  - `src/components/*`
- Verification commands:
  - `bun run typecheck`
  - `bun test src/cli/__tests__/dashboard-api.test.ts src/cli/__tests__/dashboard-security.test.ts`

### OBS-13 — Telemetry Cockpit UI Upgrade
- Unit ID/title: `OBS-13 — Telemetry Cockpit UI Upgrade`
- Bounded context: `observability-telemetry-cockpit`
- Ubiquitous language: `telemetry cockpit`, `step timeline`, `prompt audit`, `unified event stream`
- Domain invariants:
  - UI modules render consistent empty states when no telemetry is available.
  - Module remains keyboard-accessible and preserves existing dashboard routing behavior.
  - Telemetry panels reflect backend projection fields exactly (no inferred phantom states).
- Gherkin feature + scenarios:
  - Feature: `Inspect production telemetry from a single cockpit module`
  - Scenario `obs13-s1`: Given populated projection APIs, When telemetry tab renders, Then prompt audit and execution-step tables are visible.
  - Scenario `obs13-s2`: Given no telemetry data, When telemetry tab renders, Then deterministic empty-state diagnostics are shown.
  - Scenario `obs13-s3`: Given mixed timeline sources, When telemetry tab renders, Then source and category are clearly labeled.
- Acceptance criteria:
  - Telemetry tab upgraded with summary KPIs + prompt + step + timeline visibility.
  - Existing tool/resource telemetry remains available.
  - Dashboard app tests remain green and routing unchanged.
- Allowed files:
  - `src/dashboard/app.tsx`
  - `src/dashboard/components/api-client.ts`
  - `src/dashboard/modules/telemetry/*`
  - `src/dashboard/styles/lucid-glass.css`
  - `src/dashboard/app.test.ts`
- Forbidden files:
  - `src/components/*`
  - `src/scheduled/*`
- Verification commands:
  - `bun run typecheck`
  - `bun test src/dashboard/app.test.ts src/dashboard/modules/telemetry/*.test.ts`

### OBS-14 — Hardening, Tests, and Gates
- Unit ID/title: `OBS-14 — Hardening, Tests, and Gates`
- Bounded context: `cross-context quality gate`
- Ubiquitous language: `ready`, `evicted`, `gate evidence`
- Domain invariants:
  - No unit can be marked ready without passing required tests/gates.
  - Missing evidence fails closed.
- Gherkin feature + scenarios:
  - Feature: `Enforce production-grade release gates for observability changes`
  - Scenario `obs14-s1`: Given all telemetry scenarios covered, When quality gates run, Then `bun run check` succeeds.
  - Scenario `obs14-s2`: Given API contract drift, When tests run, Then failing tests block readiness.
  - Scenario `obs14-s3`: Given unresolved invariant violations, When review occurs, Then unit is evicted with explicit reason.
- Acceptance criteria:
  - Targeted and full suites run green.
  - Plan state board is updated with final statuses and evidence.
  - Execution plan references remain consistent in docs index.
- Allowed files:
  - `docs/execution-plans/07-production-grade-telemetry-observability-hardening.md`
  - `docs/execution-plans/README.md`
  - test files touched by OBS-10..OBS-13
- Forbidden files:
  - unrelated product surfaces
- Verification commands:
  - `bun run typecheck`
  - `bun run check`
  - `bun run release:check` (for tagged release flow)

## Merge Readiness Gates
A unit is merge-eligible only if all remain true:
1. `testsPassed == true`
2. `buildPassed == true` (or explicit policy override)
3. `scenariosCovered == scenariosTotal`
4. `uncoveredScenarios` is empty
5. Review severities are acceptable
6. Domain invariants remain true
7. `bun run check` is green
8. CI quality gate is green
9. `bun run release:check` passes for tagged release flow

## Execution Log
- OBS-10: `PENDING -> ACTIVE -> REVIEW -> READY -> LANDED`
- OBS-11: `PENDING -> ACTIVE -> REVIEW -> READY -> LANDED`
- OBS-12: `PENDING -> ACTIVE -> REVIEW -> READY -> LANDED`
- OBS-13: `PENDING -> ACTIVE -> REVIEW -> READY -> LANDED`
- OBS-14: `PENDING -> ACTIVE -> REVIEW -> READY -> LANDED`

## Completion Evidence
- Projection contracts and models landed:
  - `DashboardPromptAuditSnapshot`
  - `DashboardExecutionStepSnapshot`
  - `DashboardTimelineEvent`
- API routes landed:
  - `GET /api/runs/:runId/prompts`
  - `GET /api/runs/:runId/execution-steps`
  - `GET /api/runs/:runId/timeline`
- Telemetry cockpit UI landed:
  - Summary KPIs
  - Execution Steps table
  - Prompt Audit table
  - Unified Timeline table
  - Live Event pulse
- Gate evidence:
  - `bun run typecheck` -> PASS
  - `bun run check` -> PASS
  - `bun run release:check` -> PASS
