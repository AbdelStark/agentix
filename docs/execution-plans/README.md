# Agentix Production Execution Plans

Detailed implementation plans for the highest-priority production hardening items.

## Execution Order

1. [01 - Deterministic CLI Integration Test Harness](01-cli-integration-test-harness.md)
2. [02 - Scenario Trace Matrix + Anti-Fake-Green Gates](02-scenario-trace-matrix-and-anti-slop.md)
3. [03 - Security + Performance Policy Gates](03-security-performance-policy-gates.md)
4. [04 - Merge Queue Risk Scoring + Smart Ordering](04-merge-queue-risk-scoring-and-ordering.md)
5. [05 - Telemetry Aggregation + Analytics Feedback Loop](05-telemetry-aggregation-and-analytics-loop.md)
6. [06 - Observability Dashboard Local Platform](06-observability-dashboard-local-platform.md)
7. [07 - Production-Grade Telemetry and Observability Hardening](07-production-grade-telemetry-observability-hardening.md)

## Why This Sequence

- Plan 1 creates deterministic test seams needed to ship later phases safely.
- Plan 2 raises behavior proof quality and makes slop detection enforceable.
- Plan 3 introduces production policy controls on top of stronger quality data.
- Plan 4 optimizes throughput/reliability in the merge stage with explicit risk logic.
- Plan 5 closes the loop with measurable operational intelligence and continuous improvement.
- Plan 6 turns telemetry + run state into a local-first web observability platform.
- Plan 7 hardens telemetry depth (prompts, step timeline, unified event timeline) for production-grade run forensics.

## Global Definition of Done

- `bun run check` is green.
- New behaviors have deterministic tests.
- Documentation is updated (`README.md`, `CLAUDE.md`, operational docs).
- No contract drift between `types.ts`, `schemas.ts`, prompts, and workflow gates.
- Changes preserve the "never produce slop" doctrine and strengthen auditability.
