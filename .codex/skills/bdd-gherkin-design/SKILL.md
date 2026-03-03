---
name: bdd-gherkin-design
description: Author executable BDD specifications using Gherkin features and scenarios with clear Given/When/Then clauses. Use when converting requirements into testable behavior contracts, generating acceptance scenarios, or validating scenario coverage.
---

# BDD Gherkin Design

<purpose>
Turn requirements into unambiguous executable scenarios that drive implementation and validation.
</purpose>

<procedure>
1. Extract feature intent from RFC/PRD.
2. Write one `Feature` per work unit.
3. Write scenarios in observable business language.
4. Ensure each scenario has explicit Given, When, Then clauses.
5. Assign stable scenario IDs.
6. Map each scenario to at least one automated test.
</procedure>

<patterns>
<do>
- Keep Then clauses measurable and externally observable.
- Use domain vocabulary from bounded context metadata.
- Cover happy path, edge case, and failure behavior.
</do>
<dont>
- Do not describe implementation details in scenarios.
- Do not write ambiguous steps ("handles correctly").
- Do not close units with orphan scenarios.
</dont>
</patterns>

<troubleshooting>
| Symptom | Cause | Fix |
|---|---|---|
| Scenario can’t be translated to test | Step wording is ambiguous | Rewrite with concrete preconditions and outcomes |
| Tests pass but behavior still wrong | Scenario asserts internals, not outcomes | Rewrite Then clauses to observable outputs |
| Too many duplicate scenarios | Missing rule grouping | Introduce Rule and consolidate overlap |
</troubleshooting>
