# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog and uses semantic versioning.

## [Unreleased]

### Added
- Structured `.agentix/events.jsonl` command lifecycle telemetry (`init`, `plan`, `run`, `status`).
- Parser contract tests for scheduled RFC decomposition response handling.
- CLI utility contract tests and release consistency checks.
- Release process documentation and checklist automation.
- Deterministic CLI integration harness for `init`, `plan`, `run`, `run --resume`, `status`, and `monitor` with mocked external boundaries.
- CLI adapter seams (`DecomposeAdapter`, `LaunchAdapter`, `PromptAdapter`, `AgentDetectionAdapter`) to support command-level integration testing without runtime behavior changes.
- Telemetry analytics loop (`agentix analytics summary|failures`), failure taxonomy rollups, daily snapshots, and actionable quality report generation.
- Weekly analytics workflow automation and release checklist hooks for telemetry review.

## [0.3.1] - 2026-03-03

### Added
- DDD + BDD + TDD doctrine embedded in work-unit schema, prompts, gates, and docs.
- Agent context layer (`CLAUDE.md`, `agents.md`, skills index and doctrine skills).
- Production-readiness checklist and contributor guide.

### Changed
- Project and CLI naming fully rebranded to `agentix`.
- Local quality gates hardened (`typecheck`, `test`, `check`) and CI updated to enforce them.

### Fixed
- Runtime config/workflow path usage and scheduled workflow gating edge cases.
- Git hygiene for generated/runtime artifacts (`.smithers/executions` ignored).
