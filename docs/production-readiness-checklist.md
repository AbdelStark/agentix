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

## Runtime Safety

- [ ] `.agentix/` runtime artifacts are excluded from git
- [ ] `.smithers/executions/` logs are excluded from git
- [ ] `.agentix/events.jsonl` telemetry is present and readable locally
- [ ] No secrets or credentials are committed

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
