# Quality Report

- Generated: 2026-03-03T15:04:25.573Z
- Window: 7d (2026-02-24T15:04:25.573Z -> 2026-03-03T15:04:25.573Z)

## Core Metrics

- Parsed events: 5
- Malformed lines: 0
- Dropped events: 0
- Success rate: 0.00%
- Failure rate: 100.00%
- Cancellation rate: 0.00%
- Median duration: 225ms
- P95 duration: 980ms
- Run resume rate: 100.00%
- Run non-zero exits: 1

## Top Failure Reasons

- run: missing-smithers-cli (2) [environment]
- plan: missing-rfc (1) [config]
- run: workflow-exit-non-zero (1) [infra]

## Failure Taxonomy

- config: 1
- environment: 2
- schema: 0
- tests: 0
- merge: 0
- policy: 0
- infra: 1
- unknown: 0

## Prompt/Skill Improvement Candidates

- [MEDIUM] (prompt) Top recurring failure is run:missing-smithers-cli (2 occurrences). -> Refine the run command prompt/guardrails with a preflight checklist for missing-smithers-cli and explicit remediation steps.
- [MEDIUM] (skill) Failure taxonomy is currently led by environment. -> Create or update a focused environment-recovery skill with deterministic detection + fix scripts for common run failures.
- [MEDIUM] (operations) Run resume frequency is 100.00%. -> Investigate top resume causes and add early-fail checks so workflows fail fast before long-running execution.
- [HIGH] (policy) 1 run command(s) ended with non-zero exit. -> Add a release gate requiring explicit mitigation notes for recurring non-zero workflow exits.

## Ownership + Next Actions

- Owner: release coordinator + domain maintainers
- Cadence: weekly telemetry review or before tagged release
- Gate: unresolved high-priority recurring failures must have mitigation owner
