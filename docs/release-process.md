# Release Process

Use this process for every tagged release.

## 1. Prepare Release Branch/Commit

1. Ensure working tree is clean.
2. Run:
   - `bun install --frozen-lockfile`
   - `bun run check`
3. Review policy gate configuration:
   - Confirm `agentix.policy.json` thresholds match release risk posture.
   - Confirm medium severity acceptance requires rationale.
   - Confirm `high`/`critical` remain blocking for medium/large units.
   - Confirm `operational` policy enablement matches rollout risk.
   - Confirm `policy_status` output shows no unresolved config warnings.
4. Update `CHANGELOG.md`:
   - Move completed items from `[Unreleased]` to a new version section.
   - Use heading format: `## [x.y.z] - YYYY-MM-DD`.
5. Verify release consistency:
   - `bun run release:check`
6. Run telemetry analytics review:
   - `bun run cli -- analytics summary --window 7d --write-report --exclude-command analytics`
   - `bun run cli -- analytics failures --window 7d --top 10 --exclude-command analytics`
   - Review `docs/ops/quality-report.md` and assign owner/actions for top recurring failures.
   - If telemetry hard gate is enabled in `agentix.policy.json`, treat summary command exit code `1` as release-blocking.

## 2. Version and Tag

1. Update `package.json` version if needed.
2. Commit release metadata (`package.json`, `CHANGELOG.md`, docs updates).
3. Create and push annotated tag:
   - `git tag vX.Y.Z`
   - `git push origin vX.Y.Z`

## 3. CI Publish Gate

`publish.yml` runs these mandatory gates before `npm publish`:
- `bun run check`
- `bun run release:check`
- policy gate enforcement via workflow unit tests (including security/performance/operational severity blocking)

If any gate fails, publish is blocked.

## 4. Post-Release

1. Confirm package on npm.
2. Confirm GitHub release was created from tag.
3. Archive telemetry artifacts for the release:
   - `.agentix/analytics/daily-YYYY-MM-DD.json`
   - `docs/ops/quality-report.md`
4. Add follow-up items back into `[Unreleased]` in `CHANGELOG.md`.
