# Plan 01: Deterministic CLI Integration Test Harness

## Objective

Build deterministic end-to-end integration tests for `agentix init`, `plan`, `run`, `run --resume`, `status`, and `monitor` without relying on real AI calls, live Smithers execution, or interactive prompts.

## Problem Statement

- Current test coverage is strong for schema and utility units, but not for command-level orchestration.
- External dependencies (`claude`, Smithers CLI, stdin prompts, filesystem state) make tests flaky unless controlled.
- Production confidence requires command-path determinism and failure-mode assertions.

## Scope

- In scope:
  - Test seams for injectable dependencies in CLI commands.
  - Temp-repo integration harness for `.agentix` lifecycle.
  - Deterministic success/failure/cancel path coverage.
  - CI execution for integration suite.
- Out of scope:
  - Live network calls to Anthropic.
  - Real long-running Smithers workflow execution.

## Architecture Changes

1. Add dependency injection interfaces for command modules:
   - `src/cli/init-scheduled.ts`
   - `src/cli/plan.ts`
   - `src/cli/run.ts`
   - `src/cli/status.ts`
   - `src/cli/monitor-cmd.ts`
2. Encapsulate external side effects behind overridable adapters:
   - AI decomposition caller.
   - Smithers launcher.
   - prompt choice reader.
   - command existence checks.
3. Keep default runtime behavior unchanged when no test adapter is provided.

## Work Breakdown

### Phase 1: Testability Seams

1. Add optional `deps` arg to each CLI command entry function.
2. Introduce small adapter contracts:
   - `DecomposeAdapter`
   - `LaunchAdapter`
   - `PromptAdapter`
   - `AgentDetectionAdapter`
3. Ensure adapters are local to CLI layer to avoid leaking test concerns into core components.

### Phase 2: Integration Harness

1. Create `src/cli/integration/fixtures.ts`:
   - temp repo factory.
   - minimal RFC generator.
   - package script scaffold.
2. Create deterministic stubs:
   - fixed decomposition output.
   - controlled launch exit codes.
   - scripted prompt responses.
3. Add helper to read/write `.agentix/*` artifacts and assert invariants.

### Phase 3: Command Integration Tests

1. `init` happy path:
   - writes `config.json`, `work-plan.json`, generated workflow file.
   - logs telemetry.
2. `init` failure paths:
   - missing RFC path.
   - no detected agents.
3. `plan` happy/failure paths:
   - rewrites plan.
   - fails when config/RFC missing.
4. `run` paths:
   - fresh run with confirm.
   - cancel flow.
   - explicit resume.
   - missing db on resume.
   - launcher non-zero exit code.
5. `status`/`monitor` paths:
   - initialized vs uninitialized repos.
   - missing db/run-id failures.

### Phase 4: CI and Guardrails

1. Keep unit tests in `bun test` default run.
2. If integration duration grows, split into `bun test --preload ...` groups with clear naming.
3. Ensure tests are non-interactive and do not require installed CLIs.

## File-Level Plan

- New:
  - `src/cli/integration/fixtures.ts`
  - `src/cli/integration/init.integration.test.ts`
  - `src/cli/integration/plan.integration.test.ts`
  - `src/cli/integration/run.integration.test.ts`
  - `src/cli/integration/status-monitor.integration.test.ts`
- Updated:
  - `src/cli/init-scheduled.ts`
  - `src/cli/plan.ts`
  - `src/cli/run.ts`
  - `src/cli/status.ts`
  - `src/cli/monitor-cmd.ts`

## Acceptance Criteria

- All command-path tests deterministic across repeated runs.
- No test depends on live network or installed `claude` CLI.
- `bun run check` remains green.
- At least one explicit assertion per command failure mode.
- Telemetry events are asserted for `started/completed/failed/cancelled`.

## Risks and Mitigations

- Risk: Over-abstracting runtime code for tests.
  - Mitigation: keep adapters minimal and default-first.
- Risk: Brittle assertions on log text.
  - Mitigation: assert structured artifacts/events, not console formatting.

## Exit Criteria

- Integration harness merged.
- CI stable for 10 consecutive runs without flaky retries.
