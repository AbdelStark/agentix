# PRD: Agentix Observability Dashboard (Local-First)

## Document Control
- Status: Draft v1
- Date: 2026-03-03
- Owners: Agentix Core
- Scope: Scheduled Work mode (`agentix run`, `agentix monitor`, `agentix analytics`)

## Executive Decision
Build a web-based observability platform now, keep the TUI as a lightweight fallback.

Rationale:
- The current architecture already exposes enough structured data for a high-value web cockpit (run/task/attempt/events/outputs/trace/policy/merge risk).
- The current TUI can be improved, but it is the wrong surface for deep drill-downs, cross-run analytics, correlation workflows, and timeline-heavy debugging.
- “Ultimate” granularity (especially in-agent tool calls for Codex/Claude harnesses) is not fully available today, but is feasible with targeted instrumentation upgrades without changing the core orchestration model.

## Context and Problem
Agentix currently has:
- A CLI monitor (TUI) focused on live state snapshots.
- Command-level telemetry (`.agentix/events.jsonl`) and analytics commands.
- Rich structured workflow output persisted in `.agentix/workflow.db` (Smithers tables + stage output tables).
- Trace artifacts (`.agentix/generated/traces/*.json`) for scenario-to-test evidence.

Pain points:
- Operational visibility is fragmented across SQLite tables, JSONL files, and artifacts.
- Root-cause workflows are manual and slow.
- No single UI for run timeline, stage attempts, logs, policy gates, merge risk, and scenario coverage.
- Tool-level observability for external CLIs (Codex/Claude) is partial.

## Goals
1. Deliver a modern, local-first, web dashboard for real-time and historical Agentix observability.
2. Provide granular run intelligence across orchestration, quality gates, merge queue, and telemetry trends.
3. Keep the dashboard fully local (no required SaaS backend).
4. Support deterministic debugging and postmortem workflows with evidence linkage.
5. Preserve fast terminal ergonomics by keeping `agentix monitor` (TUI) as a fallback mode.

## Non-Goals
- Multi-tenant cloud hosting in v1.
- Replacing Smithers execution engine.
- Replacing existing CLI analytics commands (they remain the canonical batch rollup path).

## Feasibility Research Summary

### What is available now (high confidence)
1. Orchestration lifecycle and run metadata
- Source: `_smithers_runs`, `_smithers_nodes`, `_smithers_attempts`, `_smithers_frames`, `_smithers_approvals`, `_smithers_events` in `.agentix/workflow.db`.
- Granularity: run, node, iteration, attempt, state transitions, timing.

2. Stage-level structured outputs
- Source: workflow output tables (`research`, `plan`, `implement`, `test`, `*_review`, `review_fix`, `final_review`, `policy_status`, `merge_queue`, `completion_report`, `pass_tracker`).
- Granularity: semantic payloads for every stage.

3. Command lifecycle telemetry
- Source: `.agentix/events.jsonl`.
- Granularity: command started/completed/failed/cancelled + reason fields.

4. Scenario trace artifacts
- Source: `.agentix/generated/traces/<unit-id>.json`.
- Granularity: scenario coverage completeness and anti-slop evidence.

5. Merge queue risk intelligence
- Source: `merge_queue.riskSnapshot` output persisted in DB.
- Granularity: risk table, order, bands, speculative/sequential strategy.

6. Live node stdout/stderr stream
- Source: `_smithers_events` entries (`NodeOutput`).
- Granularity: streamed chunk logs per node/attempt.

### What is partially available (needs instrumentation)
1. In-agent tool call telemetry for Codex/Claude CLI harnesses
- Current status: not normalized in Agentix read model; Smithers `_smithers_tool_calls` is mainly populated by built-in tool-loop paths, not CLI-agent internal tool events.
- Feasibility: high, via CLI event streaming modes and parser adapters.

2. Token/cost metrics
- Current status: not reliably emitted into Agentix telemetry.
- Feasibility: medium, depends on each CLI exposing usage fields in stream/debug outputs.

3. Process resource telemetry (CPU/RAM/IO per run/task)
- Current status: not captured.
- Feasibility: high, via local process sampler sidecar.

### What is not realistically accessible (v1)
1. Provider-private internal reasoning traces.
2. Any metric not emitted by CLI/provider and not derivable from local process/runtime signals.

## Product Strategy
Web-first, TUI-second:
- Primary investment: web dashboard (`agentix dashboard`) for deep observability.
- Secondary investment: small TUI upgrades for parity shortcuts and “terminal attach” convenience.
- Do not attempt to make TUI the primary deep-observability surface.

## Users and Core Jobs
1. Orchestrator Operator
- Needs live confidence: “Is this run healthy, blocked, or regressing?”

2. Reviewer / Release Owner
- Needs gate confidence: “Are policy/scenario/build gates truly satisfied?”

3. Engineer Investigating Failure
- Needs root cause path: “Which stage/attempt/log/prompt/event caused this failure?”

## Functional Requirements

### A. Run Cockpit
- FR-A1: List runs with status, duration, pass count, landed/evicted counts.
- FR-A2: Live run header with phase, in-flight tasks, and recent critical events.
- FR-A3: Instant run switching without full page reload.

### B. Pipeline and DAG Visibility
- FR-B1: DAG view of units with dependency edges and per-stage status badges.
- FR-B2: Unit detail drawer with stage timeline and latest gate decisions.
- FR-B3: Filter by tier, priority, failed state, evicted state, policy severity.

### C. Stage Attempt Explorer
- FR-C1: Attempt timeline (start/end/duration/retries per node).
- FR-C2: Prompt + response inspection for attempts (from `meta_json` and `response_text`).
- FR-C3: Diff-focused “what changed” summary from stage outputs.

### D. Event and Log Correlation
- FR-D1: Unified event stream (Smithers events + Agentix command events).
- FR-D2: Correlate selected node/attempt with stdout/stderr chunks.
- FR-D3: Time-range query and full-text search.

### E. Quality, Policy, and Readiness Gates
- FR-E1: Gate board showing test/build/scenario/policy/final-review status.
- FR-E2: Uncovered scenario and anti-slop flag visualization.
- FR-E3: Policy warning and hard-gate explanation panel.

### F. Merge Queue Intelligence
- FR-F1: Risk table and recommended order visualization.
- FR-F2: Landed/evicted/skipped ticket history by iteration.
- FR-F3: Eviction context view and conflict trend summaries.

### G. Telemetry and Trends
- FR-G1: Command reliability and failure taxonomy charts from analytics snapshots.
- FR-G2: Run stability trends (resume rate, non-zero exits).
- FR-G3: Recommendation panel derived from analytics report data.

### H. Local Operations
- FR-H1: Launch with one command (`agentix dashboard`).
- FR-H2: Works entirely against local files/db in repo `.agentix`.
- FR-H3: Read-only mode by default; no mutation of orchestration state.

## Technical Architecture (v1)

### Data Sources
1. `.agentix/workflow.db`
2. `.agentix/events.jsonl`
3. `.agentix/work-plan.json`
4. `.agentix/generated/traces/*.json`
5. `.agentix/analytics/daily-*.json`
6. `docs/ops/quality-report.md` (optional render source)
7. `scheduled-tasks.db` (optional if present)

### Backend
- Local Bun service embedded in Agentix CLI command (`agentix dashboard`).
- Query adapters:
  - SQLite adapter for workflow DB.
  - JSONL tail parser for command events.
  - File watcher for traces/analytics snapshots.
- Transport:
  - REST for snapshots.
  - SSE for live event stream.

### Frontend
- SPA with panel-based observability layout:
  - Run list + live cockpit.
  - DAG/pipeline map.
  - Attempts/log/event explorer.
  - Gate/risk/telemetry tabs.
- Design direction:
  - Modern, clean, high-polish, minimal visual noise.
  - Fast keyboard navigation and deep filtering.
  - Desktop-first with solid mobile fallback.

## Instrumentation Upgrades for “Ultimate” Granularity

### I1 (Must-have): Normalize existing rich sources
- Parse `_smithers_events` (`NodeStarted`, `NodeFinished`, `NodeFailed`, `NodeOutput`, etc.) into query-friendly read models.
- Parse `_smithers_attempts.meta_json` + `response_text` for prompt/response auditability.

### I2 (High-value): Codex CLI event stream capture
- Enable Codex JSON event mode in Agentix-generated agents.
- Ingest emitted JSONL into normalized `agent_tool_events` read model.

### I3 (High-value, validate first): Claude stream-json capture
- Enable Claude stream-json mode behind flag.
- Validate parsing reliability and output-schema compatibility.
- Roll out gradually by role.

### I4 (Nice-to-have): Resource sampler
- Collect per-run/per-node process CPU/RAM snapshots every N seconds.
- Correlate spikes with stage attempts and failures.

## Data Model (Read Layer)
- `runs`
- `nodes`
- `attempts`
- `node_events`
- `node_logs`
- `stage_outputs`
- `merge_risk_snapshots`
- `trace_artifacts`
- `command_events`
- `analytics_snapshots`
- `agent_tool_events` (post I2/I3)
- `resource_samples` (post I4)

## Security and Privacy
- Local-only by default, bind to `127.0.0.1`.
- No outbound telemetry unless explicitly enabled.
- Redaction layer for secrets in prompt/log views.
- Optional auth token for dashboard API if remote port binding is enabled.

## Non-Functional Requirements
- NFR-1: Live updates visible in UI within 1 second for active runs.
- NFR-2: Dashboard remains responsive with 100k+ event rows per run.
- NFR-3: Initial load under 2 seconds for last run on typical laptop.
- NFR-4: No impact on run correctness if dashboard process crashes.

## Rollout Plan

### Phase 0: Feasibility Spike (1 week)
- Build read-only data adapter over workflow DB + events.jsonl.
- Validate event throughput and schema assumptions.
- Produce query benchmarks.

### Phase 1: MVP Dashboard (2-3 weeks)
- Run list, live cockpit, node/attempt timeline, logs/events correlation.
- Gate board + merge risk + trace artifact panel.
- Local launch command.

### Phase 2: Advanced Observability (2 weeks)
- Cross-run analytics visualizations.
- Root-cause workflow shortcuts.
- Exportable incident report view.

### Phase 3: Instrumentation Expansion (2-3 weeks)
- Codex JSON event ingestion.
- Claude stream-json ingestion (feature flagged).
- Optional resource sampler.

## Success Metrics
- Time-to-root-cause reduced by >= 50%.
- Mean time to detect blocked/evicted units reduced by >= 40%.
- > 80% of run investigations completed without opening raw DB/JSONL files.
- No measurable regression in orchestration throughput from dashboard sidecar.

## Risks and Mitigations
1. Risk: CLI event formats change.
- Mitigation: parser versioning + tolerant decoding + feature flags.

2. Risk: Event volume causes UI lag.
- Mitigation: server-side pagination/indexing and incremental SSE windows.

3. Risk: Sensitive data exposure in prompts/logs.
- Mitigation: redaction filters, explicit “show raw” gated UX.

4. Risk: Tight coupling to Smithers internal tables.
- Mitigation: adapter abstraction + compatibility tests against schema fixtures.

## Final Recommendation: Web Dashboard vs TUI
- Choose web dashboard as the primary observability platform.
- Keep TUI for quick terminal attachment and minimal status checks.
- Do not make large strategic investment in TUI-only evolution.

Reason:
- The architecture already supports a rich local web platform today.
- Remaining granularity gaps are solvable with incremental instrumentation.
- A TUI-first path will hit usability and extensibility ceilings early for deep observability workflows.
