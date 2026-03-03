# Plan 04: Merge Queue Risk Scoring + Smart Ordering

## Objective

Upgrade merge queue behavior from static priority ordering to explicit conflict-risk-aware scheduling that minimizes evictions and rework while preserving correctness gates.

## Problem Statement

- Current queue handles overlaps but still depends heavily on agent judgement for ordering.
- Rebase conflicts and churn-heavy files cause avoidable retries.
- We need deterministic pre-merge risk scoring to improve first-pass land success.

## Scope

- In scope:
  - Deterministic risk score model per ticket.
  - Ordering strategy using priority + risk + dependency signals.
  - Merge batching rules for safe speculative landings.
  - Tests for ordering decisions.
- Out of scope:
  - Fully autonomous conflict resolution engine.

## Risk Model

Inputs per ticket:

- file overlap count with other ready tickets.
- touched-file churn score (recent edit frequency).
- unit tier complexity.
- historical eviction count for ticket branch.
- dependency proximity to recently landed units.

Output:

- `riskScore` numeric (0-100).
- `riskBand` (`low`, `medium`, `high`).
- `mergeStrategy` (`speculative`, `sequential`).

## Work Breakdown

### Phase 1: Deterministic Scoring Engine

1. Add `src/components/merge-risk.ts`:
   - pure scoring function.
   - scoring weights config.
2. Include stable sorting fallback keys:
   - priority -> risk score -> ticket ID.

### Phase 2: Queue Prompt/Input Upgrade

1. Extend queue prompt payload with:
   - risk table.
   - recommended order.
   - speculative batch boundaries.
2. Keep agent as executor, but reduce ambiguity by precomputed strategy.

### Phase 3: Runtime Feedback Loop

1. Capture per-iteration outcomes:
   - landed.
   - evicted.
   - conflict reason.
2. Feed eviction history back into risk score penalties.

### Phase 4: Safeguards and Limits

1. Add caps:
   - max speculative batch size by risk band.
   - forced sequential mode when risk threshold exceeded.
2. Abort/evict conditions remain explicit and logged.

### Phase 5: Tests and Benchmarking

1. Add unit tests:
   - score calculation.
   - deterministic ordering.
   - strategy classification.
2. Add scenario tests with synthetic tickets and overlaps.
3. Track baseline metric improvement:
   - first-pass land rate.
   - eviction rate.

## File-Level Plan

- New:
  - `src/components/merge-risk.ts`
  - `src/components/merge-risk.test.ts`
- Updated:
  - `src/components/AgenticMergeQueue.tsx`
  - `src/components/ScheduledWorkflow.tsx`
  - `docs/observability.md` (event taxonomy extensions)

## Acceptance Criteria

- Merge ordering is deterministic for identical input state.
- High-risk tickets are automatically routed to sequential mode.
- Conflict/eviction rates decrease vs baseline runs.
- No readiness gate regressions introduced.

## Risks and Mitigations

- Risk: Overfitting risk model to limited data.
  - Mitigation: configurable weights and conservative defaults.
- Risk: Throughput regression from over-serialization.
  - Mitigation: cap sequential fallback with measured thresholds.

## Exit Criteria

- Risk scoring is active and tested.
- Queue outputs include risk metadata and strategy decisions.
