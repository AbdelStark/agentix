# Production Readiness Checklist

Use this checklist before tagging a release.

## Build & Test

- [ ] `bun install --frozen-lockfile` succeeds
- [ ] `bun run typecheck` succeeds
- [ ] `bun test` succeeds
- [ ] `bun run release:check` succeeds
- [ ] CI workflow is green for the release commit

## Contract Integrity

- [ ] Work-unit schema includes DDD/BDD fields and validates sample units
- [ ] Scenario coverage gate is active (`scenariosCovered === scenariosTotal`)
- [ ] Merge queue readiness still blocks uncovered scenarios
- [ ] Test output contract includes trace matrix fields (`scenarioTrace`, `traceCompleteness`, `assertionSignals`, `antiSlopFlags`)
- [ ] Policy review schemas are present and validated (`security_review`, `performance_review`, `operational_review`)
- [ ] Policy status schema is present and validated (`policy_status`)
- [ ] Tier gate blocks when `traceCompleteness !== true`
- [ ] Tier gate blocks on blocking anti-slop flags
- [ ] Medium/large tier gate blocks `high`/`critical` policy severity
- [ ] Medium severity policy findings require remediation or explicit acceptance rationale
- [ ] Trace artifacts are generated for merge-eligible units at `.agentix/generated/traces/<unit-id>.json`
- [ ] `agentix.policy.json` exists (or defaults are intentionally relied on) and thresholds are reviewed
- [ ] Policy parse/config warnings are captured in structured output and visible in monitor UI

## Runtime Safety

- [ ] `.agentix/` runtime artifacts are excluded from git
- [ ] `.smithers/executions/` logs are excluded from git
- [ ] `.agentix/events.jsonl` telemetry is present and readable locally
- [ ] `agentix analytics summary --window 7d` runs successfully
- [ ] `.agentix/analytics/daily-YYYY-MM-DD.json` snapshot is generated for current review cycle
- [ ] `agentix analytics failures --window 7d --top 10` has been reviewed
- [ ] `docs/ops/quality-report.md` is generated and assigned follow-up owners for recurring failures
- [ ] No secrets or credentials are committed
- [ ] Security/performance review evidence is retained in workflow outputs

## Documentation

- [ ] `README.md` reflects current CLI/scripts and quality doctrine
- [ ] `CONTRIBUTING.md` reflects current contributor workflow
- [ ] `CLAUDE.md` and `agents.md` match actual code behavior
- [ ] Thesis/roadmap docs reflect current implementation state

## Release Hygiene

- [ ] Version/tag strategy is clear and consistent
- [ ] `CHANGELOG.md` has an entry for the release version
- [ ] Release notes summarize contract changes and migration impact
- [ ] Publish pipeline includes quality + release checks before publish
