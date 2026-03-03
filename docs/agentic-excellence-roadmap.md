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

1. Spec compiler hardening (Phase 2): enforce scenario traceability and anti-ambiguity linting.
2. Test integrity instrumentation (Phase 3): add scenario-to-test trace matrix artifacts and anti-fake-green checks.
3. Production controls (Phase 4): introduce security/performance policy gates and conflict-risk scoring in merge queue.
4. Learning loop bootstrap (Phase 5): ingest failure patterns from `events.jsonl` and review outputs into reusable skills.

## Acceptance Criteria for the Roadmap

- Fewer manual interventions per run.
- Higher first-pass merge success.
- Lower regression escape rate.
- Clear auditable trace from requirement -> scenario -> test -> landed change.
