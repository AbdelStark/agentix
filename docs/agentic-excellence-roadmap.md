# Agentix Excellence Roadmap

## North Star

Build an opinionated agentic orchestrator that consistently produces production-grade software at scale using DDD + BDD + TDD.

## Current State (2026-03-03)

- Phase 1 foundation is complete (contract + prompts + gates + context layer).
- Release hygiene baseline is active (`bun run check`, CI gate, publish gate, `release:check`).
- Command observability baseline is active (`.agentix/events.jsonl`).
- Remaining work is concentrated in deeper quality instrumentation and production controls.

## Phase 1 - Foundation (now)

- Add DDD + BDD fields to work-unit contract.
- Push these fields into prompts and review gates.
- Add scenario coverage outputs and block completion on uncovered scenarios.
- Establish project context layer (`CLAUDE.md`, `agents.md`, `.codex/skills`).

## Phase 2 - Spec Compiler

- Add RFC/PRD parser that extracts candidate bounded contexts.
- Add stricter Gherkin validation (schema + anti-ambiguity checks).
- Add scenario ID linting and traceability checks.

## Phase 3 - Test Integrity

- Add anti-fake-green checks (assertion quality, mutation score optional).
- Add scenario-to-test trace matrix artifact per unit.
- Add deterministic test evidence capture for review phases.

## Phase 4 - Production Controls

- Add policy gates for security, performance, and operational readiness.
- Add risk scoring for merge queue ordering.
- Add hardened rollback/eviction playbooks for conflicted units.

## Phase 5 - Continuous Learning Loop

- Capture recurring review failures into reusable skills.
- Evolve prompts from postmortems and failure analytics.
- Keep doctrine stable, adjust heuristics and tooling continuously.

## Prioritized Next Milestones

1. CLI integration harness hardening: deterministic command-level tests across `init/plan/run/resume/status/monitor`.
2. Spec compiler hardening (Phase 2): enforce scenario traceability and anti-ambiguity linting.
3. Production controls (Phase 4): introduce security/performance policy gates and conflict-risk scoring in merge queue.
4. Learning loop bootstrap (Phase 5): ingest failure patterns from `events.jsonl` and review outputs into reusable skills.

## Detailed Execution Plans

- [Execution Plan Index](execution-plans/README.md)
- [Plan 01: CLI Integration Test Harness](execution-plans/01-cli-integration-test-harness.md)
- [Plan 02: Scenario Trace Matrix + Anti-Fake-Green Gates](execution-plans/02-scenario-trace-matrix-and-anti-slop.md)
- [Plan 03: Security + Performance Policy Gates](execution-plans/03-security-performance-policy-gates.md)
- [Plan 04: Merge Queue Risk Scoring + Smart Ordering](execution-plans/04-merge-queue-risk-scoring-and-ordering.md)
- [Plan 05: Telemetry Aggregation + Analytics Feedback Loop](execution-plans/05-telemetry-aggregation-and-analytics-loop.md)

## Acceptance Criteria for the Roadmap

- Fewer manual interventions per run.
- Higher first-pass merge success.
- Lower regression escape rate.
- Clear auditable trace from requirement -> scenario -> test -> landed change.
