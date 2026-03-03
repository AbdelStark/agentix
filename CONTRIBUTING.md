# Contributing

## Development Loop

1. Install dependencies: `bun install`
2. Make focused changes in one area.
3. Run quality gates locally:
   - `bun run typecheck`
   - `bun test`
   - `bun run test:integration` (deterministic CLI command harness; also included in `bun test`)
   - `bun run release:check` (required for release/tag prep)
   - `bun run ops:quality-report` (recommended before release/tag prep; uses `--exclude-command analytics`)
4. Update docs when behavior/contracts change.
5. Submit a scoped commit with clear intent.

## Quality Bar

Changes should be merge-ready only if all are true:

- Typecheck passes.
- Tests pass.
- Work-unit contract remains valid (DDD + BDD + TDD fields).
- No uncovered executable scenarios for affected units.
- Docs/context files are updated when operational behavior changes.
- `.agentix/events.jsonl` remains local runtime telemetry (never committed).
- Weekly telemetry rollup/report commands remain operational (`analytics:summary`, `analytics:failures`, `ops:quality-report`).
- If `telemetry.runNonZeroExitHardGate.enabled=true`, treat `ops:quality-report` failures as release blockers.

## Design Rules

- Prefer explicit data contracts over implicit conventions.
- Keep orchestration logic deterministic and inspectable.
- Avoid introducing `any` in critical execution paths.
- Do not weaken merge/readiness gates for convenience.

## CI

GitHub Actions runs:

- `bun install --frozen-lockfile`
- `bun run check`

Pull requests should be green before merge.
