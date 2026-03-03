# Contributing

## Development Loop

1. Install dependencies: `bun install`
2. Make focused changes in one area.
3. Run quality gates locally:
   - `bun run typecheck`
   - `bun test`
4. Update docs when behavior/contracts change.
5. Submit a scoped commit with clear intent.

## Quality Bar

Changes should be merge-ready only if all are true:

- Typecheck passes.
- Tests pass.
- Work-unit contract remains valid (DDD + BDD + TDD fields).
- No uncovered executable scenarios for affected units.
- Docs/context files are updated when operational behavior changes.

## Design Rules

- Prefer explicit data contracts over implicit conventions.
- Keep orchestration logic deterministic and inspectable.
- Avoid introducing `any` in critical execution paths.
- Do not weaken merge/readiness gates for convenience.

## CI

GitHub Actions runs:

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `bun test`

Pull requests should be green before merge.
