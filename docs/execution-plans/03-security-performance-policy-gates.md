# Plan 03: Security + Performance Policy Gates

## Objective

Add explicit production policy gates for security and performance so medium/large units cannot be marked ready without passing policy-level review.

## Problem Statement

- Current quality gates prioritize correctness/spec alignment but do not enforce explicit security/performance policy contracts.
- Production readiness requires non-functional constraints to be first-class and machine-checked.

## Scope

- In scope:
  - Security review gate.
  - Performance review gate.
  - Policy severity model and block thresholds.
  - Integration into tier completion logic.
- Out of scope:
  - Full static analysis engine replacement.
  - Real-time load testing infrastructure (initially command/report driven).

## Policy Model

1. Define policy classes:
   - `security`
   - `performance`
   - `operational`
2. Severity levels:
   - `none`, `low`, `medium`, `high`, `critical`
3. Block rule:
   - `high` or `critical` blocks merge.
   - `medium` blocks unless explicitly fixed or accepted with rationale.

## Work Breakdown

### Phase 1: Schema and Stage Design

1. Extend output schemas with:
   - `security_review`
   - `performance_review`
2. Include fields:
   - `approved`
   - `severity`
   - `issues`
   - `remediationActions`
   - `evidence`

### Phase 2: Prompt Contracts

1. Add prompt files:
   - `src/prompts/SecurityReview.mdx`
   - `src/prompts/PerformanceReview.mdx`
2. Encode concrete checks:
   - auth/authz boundaries.
   - injection and secret handling.
   - error leakage.
   - algorithmic complexity regressions.
   - I/O and query hot paths.

### Phase 3: Pipeline Integration

1. For `medium` and `large` tiers, add new stage execution:
   - after `test`
   - before final readiness
2. Update review-fix loop to consume and fix security/performance issues.
3. Update completion gates in `ScheduledWorkflow`.

### Phase 4: Policy Configuration

1. Add policy config file (repo-level):
   - `agentix.policy.json`
2. Allow configurable thresholds and domain-specific checks.
3. Provide safe defaults if config is missing.

### Phase 5: Tests and Docs

1. Add tests:
   - schema validation.
   - gate blocking by severity.
   - review-fix remediation flow.
2. Update docs:
   - `README.md`
   - `docs/production-readiness-checklist.md`
   - `docs/release-process.md`

## File-Level Plan

- New:
  - `src/prompts/SecurityReview.mdx`
  - `src/prompts/PerformanceReview.mdx`
  - `src/scheduled/policy.ts`
  - `agentix.policy.json` (example defaults)
- Updated:
  - `src/scheduled/schemas.ts`
  - `src/components/QualityPipeline.tsx`
  - `src/components/ScheduledWorkflow.tsx`
  - `scripts/gen-mdx-types.ts`

## Acceptance Criteria

- Medium/large units cannot complete with unresolved high/critical policy issues.
- Policy stage outputs are deterministic and machine-validated.
- Review-fix consumes policy issues and reports closure evidence.
- `bun run check` remains green.

## Risks and Mitigations

- Risk: excessive false positives slowing throughput.
  - Mitigation: conservative defaults + configurable thresholds.
- Risk: policy drift from actual production requirements.
  - Mitigation: versioned policy config + release checklist tie-in.

## Exit Criteria

- Security/performance gates are active in production flow.
- At least one known insecure/inefficient pattern is proven blocked by tests.
