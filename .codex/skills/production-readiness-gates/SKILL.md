---
name: production-readiness-gates
description: Apply strict non-slop release gates for agentic changes. Use when reviewing merge readiness, validating scenario coverage, checking invariant safety, and deciding land vs evict in orchestration flows.
---

# Production Readiness Gates

<purpose>
Ensure only production-grade changes land by combining technical, behavioral, and domain-level gates.
</purpose>

<procedure>
1. Validate build and test status.
2. Validate scenario coverage completeness.
3. Validate invariant safety for changed contexts.
4. Validate review severity and unresolved issues.
5. Decide `ready` or `evict` with explicit reason.
6. Record remediation actions for next pass.
</procedure>

<patterns>
<do>
- Require evidence for every gate.
- Fail closed when evidence is missing.
- Prefer eviction with context over risky merge.
</do>
<dont>
- Do not merge on hope or incomplete signals.
- Do not waive major/critical findings without rationale.
- Do not ignore uncovered scenarios.
</dont>
</patterns>

<troubleshooting>
| Symptom | Cause | Fix |
|---|---|---|
| Gate says pass but production fails | Gate checks too shallow | Add scenario/invariant assertions to gate inputs |
| Frequent evictions late in queue | Upstream specs or boundaries weak | Tighten decomposition and planning contracts |
| Review churn without convergence | Feedback lacks actionable detail | Require issue templates with exact fixes |
</troubleshooting>
