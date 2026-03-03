# Plan 02: Scenario Trace Matrix + Anti-Fake-Green Gates

## Objective

Make scenario coverage auditable and non-gameable by producing a machine-readable scenario-to-test trace matrix and enforcing anti-fake-green checks at workflow gate time.

## Problem Statement

- Current gating checks `scenariosCovered` and `uncoveredScenarios`, but proof quality can still be shallow.
- Passing tests without meaningful assertions is a known slop mode.
- Production-grade agentic delivery requires verifiable traceability: requirement -> scenario -> test evidence.

## Scope

- In scope:
  - Add trace-matrix artifacts per work unit.
  - Enforce minimum quality evidence on test outputs.
  - Gate merge eligibility on trace integrity.
- Out of scope:
  - Full mutation testing engine in first iteration (optional future extension).

## Data Contract Additions

1. Extend test output schema (`src/scheduled/schemas.ts`) with:
   - `scenarioTrace`: array of `{ scenarioId, mappedTests, evidence }`.
   - `traceCompleteness`: boolean.
   - `assertionSignals`: `{ totalAssertions, filesWithAssertions, weakTestsDetected }`.
   - `antiSlopFlags`: array of machine-readable failure codes.
2. Extend type definitions where needed in workflow components.

## Work Breakdown

### Phase 1: Schema and Prompt Contract

1. Update `Test.mdx` to require:
   - per-scenario mapped tests.
   - test file references.
   - evidence notes for Given/When/Then outcomes.
2. Regenerate MDX types.
3. Add unit tests for schema validation and failure cases.

### Phase 2: Trace Artifact Generation

1. Generate artifact per unit:
   - `.agentix/generated/traces/<unit-id>.json`
2. Include:
   - scenario metadata.
   - mapped test identifiers.
   - command outputs relevant to validation.
3. Ensure artifact creation is deterministic and idempotent.

### Phase 3: Anti-Fake-Green Heuristics

1. Add first-pass heuristics:
   - scenario mapped to at least one test.
   - behavior-changing unit has test file changes.
   - weak-test pattern detection (empty assertions, placeholder tests).
2. Emit explicit `antiSlopFlags`.
3. Block tier completion when critical flags exist.

### Phase 4: Gate Integration

1. Update `ScheduledWorkflow.tierComplete` checks to require:
   - `traceCompleteness === true`
   - no blocking `antiSlopFlags`
2. Surface failure reason into final completion report.

### Phase 5: Tests and Docs

1. Add workflow-level tests for:
   - trace complete path.
   - trace incomplete block path.
   - anti-slop flag block path.
2. Update docs:
   - `README.md`
   - `docs/production-readiness-checklist.md`
   - `CLAUDE.md`

## File-Level Plan

- Updated:
  - `src/scheduled/schemas.ts`
  - `src/components/QualityPipeline.tsx`
  - `src/components/ScheduledWorkflow.tsx`
  - `src/prompts/Test.mdx`
  - `src/scheduled/types.ts` (if shared types need trace primitives)
- New:
  - `src/scheduled/trace-matrix.ts`
  - `src/scheduled/trace-matrix.test.ts`
  - `src/components/__tests__/workflow-trace-gates.test.ts`

## Acceptance Criteria

- Every scenario has at least one mapped test in trace output.
- Merge gating fails deterministically when trace is incomplete.
- Anti-fake-green checks block known weak-test patterns.
- Trace artifact exists for every completed unit.
- `bun run check` remains green.

## Risks and Mitigations

- Risk: false positives from heuristic checks.
  - Mitigation: start with conservative blocking rules and explicit allowlist mechanism.
- Risk: prompt output variability.
  - Mitigation: strict schema enforcement and clear failure feedback loops.

## Exit Criteria

- Scenario trace matrix is generated, validated, and enforced in gates.
- Demonstrated prevention of at least 3 known fake-green patterns in tests.
