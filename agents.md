# Agentix Multi-Agent Protocol

<roles>
| Role | Model Tier | Responsibility | Hard Boundary |
|---|---|---|---|
| Orchestrator | Frontier | Decompose work, assign units, enforce gates | Does not implement feature code directly |
| Domain Researcher | Frontier/Mid | Build bounded-context map, language, invariants | Does not approve merge readiness |
| Planner | Frontier | Produce scenario-to-test implementation plan | Does not bypass invariants/scenarios |
| Implementer | Mid | Execute RED->GREEN->REFACTOR and code changes | Does not weaken tests/gates |
| Tester | Mid | Run suites and produce scenario coverage evidence | Does not mark unverifiable work as pass |
| Spec Reviewer | Frontier | Verify acceptance + Gherkin + invariants alignment | Does not patch code directly |
| Code Reviewer | Frontier | Check quality/security/maintainability | Does not patch code directly |
| Merge Coordinator | Frontier | Land ready units, evict conflicted units | Does not override readiness gates |
</roles>

<task_packet>
Every delegated unit must include:
- Unit ID/title
- Bounded context
- Ubiquitous language
- Domain invariants
- Gherkin feature + scenarios
- Acceptance criteria
- Allowed files and forbidden files
- Verification commands
</task_packet>

<state_machine>
PENDING -> ACTIVE -> REVIEW -> {READY -> LANDED | EVICTED -> ACTIVE}

Transition requirements:
- `ACTIVE -> REVIEW`: implementation + tests completed.
- `REVIEW -> READY`: all reviews pass and scenario coverage complete.
- `READY -> LANDED`: merge queue rebase/checks pass.
- Any uncovered scenario or broken invariant forces `EVICTED`.
</state_machine>

<parallelism>
Safe parallel execution:
- Units in different bounded contexts with no file overlap.
- Independent scenario sets.

Must serialize:
- Shared-file edits.
- Shared-schema/API contract changes.
- Units touching same aggregate roots.
</parallelism>

<gates>
A unit is merge-eligible only if:
1. `testsPassed == true`
2. `buildPassed == true` (or explicit final gate override)
3. `scenariosCovered == scenariosTotal`
4. `uncoveredScenarios` is empty
5. Review severities are acceptable
6. Domain invariants remain true
7. Local quality gate `bun run check` passes
8. CI quality gate (typecheck + tests) is green
</gates>

<escalation>
Escalate to human when:
- Invariant conflict between RFC and existing system behavior.
- Scenario ambiguity blocks deterministic test design.
- Cross-context change requires architecture decision.
- Security/compliance risk is identified.
</escalation>
