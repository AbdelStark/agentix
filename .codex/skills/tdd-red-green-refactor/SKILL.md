---
name: tdd-red-green-refactor
description: Enforce strict TDD loops (RED->GREEN->REFACTOR) for behavior-changing work. Use when implementing features, bug fixes, or refactors that alter observable behavior and require non-sloppy verification.
---

# TDD Red-Green-Refactor

<purpose>
Prevent speculative coding and fake confidence by enforcing behavior-first development loops.
</purpose>

<procedure>
1. Select one scenario and one behavior slice.
2. RED: write a failing test first.
3. GREEN: implement the minimal code to pass that test.
4. REFACTOR: improve design while keeping tests green.
5. Repeat until all scenarios are covered.
6. Run full verification suite before handoff.
</procedure>

<patterns>
<do>
- Keep each cycle small and atomic.
- Name tests by behavior, not implementation.
- Add invariant checks in tests for domain-critical logic.
</do>
<dont>
- Do not write production code before a failing test.
- Do not keep passing tests that prove nothing meaningful.
- Do not batch many behaviors into one giant test.
</dont>
</patterns>

<troubleshooting>
| Symptom | Cause | Fix |
|---|---|---|
| "No obvious test to write" | Behavior not well specified | Return to Gherkin scenario design |
| Test passes immediately | Existing behavior already present or test too weak | Strengthen assertion or pick missing behavior |
| Frequent regressions after refactor | Refactor changed behavior silently | Add characterization tests before refactor |
</troubleshooting>
