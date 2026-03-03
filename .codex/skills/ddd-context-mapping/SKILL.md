---
name: ddd-context-mapping
description: Derive and enforce DDD boundaries for work units, including bounded contexts, ubiquitous language, aggregates, and invariants. Use when decomposing RFCs/PRDs, planning implementation slices, or reviewing architecture drift in agentic workflows.
---

# DDD Context Mapping

<purpose>
Define domain boundaries before code changes so agents can parallelize safely without model drift.
</purpose>

<procedure>
1. Read RFC/PRD scope and identify business capabilities.
2. Partition capabilities into bounded contexts with minimal overlap.
3. For each context, define ubiquitous language terms.
4. Define non-negotiable invariants and failure modes.
5. Map each work unit to one primary bounded context.
6. Reject units spanning multiple contexts unless explicitly required.
</procedure>

<patterns>
<do>
- Name bounded contexts with domain terms, not technical layers.
- Encode invariants as testable statements.
- Keep language consistent across prompts, tests, and code.
</do>
<dont>
- Do not mix unrelated domains in one unit.
- Do not accept vague invariants such as "should work".
- Do not invent new terms when a domain term already exists.
</dont>
</patterns>

<troubleshooting>
| Symptom | Cause | Fix |
|---|---|---|
| Frequent merge conflicts across units | Boundaries are split by file type, not domain | Re-slice units by bounded context |
| Conflicting terminology in code/tests | Ubiquitous language not defined | Add glossary to unit metadata and enforce in reviews |
| Regressions in core rules | Invariants implicit only | Encode invariants in tests and review checklist |
</troubleshooting>
