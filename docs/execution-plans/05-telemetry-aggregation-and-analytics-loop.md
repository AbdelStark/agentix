# Plan 05: Telemetry Aggregation + Analytics Feedback Loop

## Objective

Turn raw command events into actionable quality intelligence by aggregating telemetry, producing operational reports, and feeding recurring failure patterns back into prompts/skills.

## Problem Statement

- `.agentix/events.jsonl` exists but is currently a raw log stream.
- No built-in summary metrics, failure taxonomy, or trend visibility.
- Continuous excellence requires a closed improvement loop driven by real run data.

## Scope

- In scope:
  - Event normalization and aggregation.
  - CLI analytics commands.
  - Failure taxonomy and trend reporting.
  - Skill/prompt feedback artifacts.
- Out of scope:
  - External SaaS observability integration in first iteration.

## Analytics Model

Core metrics:

- command success/failure rates.
- median/p95 command duration.
- cancellation frequency.
- top failure reasons by command.
- run-level stability indicators (resume frequency, non-zero exits).

Failure taxonomy:

- `config`, `environment`, `schema`, `tests`, `merge`, `policy`, `infra`, `unknown`.

## Work Breakdown

### Phase 1: Event Schema Evolution

1. Standardize `details.reason` enums where possible.
2. Add optional correlation fields:
   - `sessionId`
   - `unitId` (when applicable)
3. Document schema versioning.

### Phase 2: Aggregation Engine

1. Add analytics module:
   - `src/cli/analytics.ts`
2. Parse JSONL robustly with malformed-line tolerance.
3. Emit rollup snapshots:
   - `.agentix/analytics/daily-YYYY-MM-DD.json`

### Phase 3: CLI Analytics Commands

1. Add commands:
   - `agentix analytics summary --window 7d`
   - `agentix analytics failures --top 10`
2. Provide machine-readable JSON output mode for automation.

### Phase 4: Feedback Artifact Generation

1. Generate recommendations:
   - `docs/ops/quality-report.md`
2. Extract recurring issues into candidate improvements:
   - prompt refinements.
   - new/updated skills.
   - policy threshold adjustments.

### Phase 5: Automation and Governance

1. Add optional scheduled workflow (local or CI) to produce weekly report.
2. Add release checklist hooks for analytics review.
3. Define ownership for triaging top failure causes.

## File-Level Plan

- New:
  - `src/cli/analytics.ts`
  - `src/cli/analytics-cmd.ts`
  - `src/cli/analytics.test.ts`
  - `docs/ops/quality-report-template.md`
- Updated:
  - `src/cli/agentix.ts` (new `analytics` subcommand)
  - `docs/observability.md`
  - `docs/release-process.md`
  - `docs/production-readiness-checklist.md`

## Acceptance Criteria

- `agentix analytics summary` provides deterministic, validated output.
- Failure reasons are grouped into stable taxonomy buckets.
- Weekly (or on-demand) quality report is generated from telemetry.
- At least one concrete prompt/skill improvement is produced from report data.

## Risks and Mitigations

- Risk: telemetry schema drift breaks aggregation.
  - Mitigation: versioned parser with compatibility fallbacks.
- Risk: noisy recommendations.
  - Mitigation: threshold-based reporting and human review gate.

## Exit Criteria

- Analytics command set is live and tested.
- Feedback loop is operational and documented.
