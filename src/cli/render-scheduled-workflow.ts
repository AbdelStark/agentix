/**
 * Renders a Smithers workflow.tsx for Scheduled Work mode.
 *
 * The generated file is a thin wrapper that imports ScheduledWorkflow
 * from the library, configures agents, and renders.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { agentixSourceRoot, runningFromSource } from "./shared";

export function renderScheduledWorkflow(params: {
  repoRoot: string;
}): string {
  const { repoRoot } = params;

  // Determine import prefix — where to import library components from
  const isLibRepo =
    existsSync(join(repoRoot, "src/components/ScheduledWorkflow.tsx")) &&
    existsSync(join(repoRoot, "src/scheduled/schemas.ts"));

  let importPrefix: string;
  if (isLibRepo) {
    importPrefix = "../../src";
  } else if (runningFromSource) {
    importPrefix = agentixSourceRoot + "/src";
  } else {
    importPrefix = "agentix";
  }

  return `import React from "react";
import { readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createSmithers, ClaudeCodeAgent, CodexAgent } from "smithers-orchestrator";
import { scheduledOutputSchemas } from "${importPrefix}/scheduled/schemas";
import { ScheduledWorkflow } from "${importPrefix}/components";

// ── Load config ────────────────────────────────────────────────────────

const _agentixDir = join(import.meta.dir, "..");
const _config = JSON.parse(readFileSync(join(_agentixDir, "config.json"), "utf8"));

// ── Constants ─────────────────────────────────────────────────────────

const REPO_ROOT = _config.repoRoot as string;
const DB_PATH = join(_agentixDir, "workflow.db");
const PLAN_PATH = join(_agentixDir, "work-plan.json");
const HAS_CLAUDE = _config.agents.claude as boolean;
const HAS_CODEX = _config.agents.codex as boolean;
const MAX_CONCURRENCY = _config.maxConcurrency as number;
const MAX_PASSES = 9;
const BASE_BRANCH = _config.baseBranch as string;
const ENABLE_CODEX_TELEMETRY = process.env.AGENTIX_OBS_CODEX_TELEMETRY === "1";
const ENABLE_CLAUDE_TELEMETRY = process.env.AGENTIX_OBS_CLAUDE_TELEMETRY === "1";
const ENABLE_RESOURCE_SAMPLER = process.env.AGENTIX_OBS_RESOURCE_SAMPLER === "1";
const RESOURCE_SAMPLE_INTERVAL_MS = Math.max(
  250,
  Number(process.env.AGENTIX_OBS_RESOURCE_SAMPLE_MS ?? "2000") || 2000,
);
const RESOURCE_SAMPLES_PATH = join(_agentixDir, "resource-samples.jsonl");

// ── Load work plan ────────────────────────────────────────────────────

const workPlan = JSON.parse(readFileSync(PLAN_PATH, "utf8"));

// ── Agent setup ───────────────────────────────────────────────────────

const WORKSPACE_POLICY = \`
## WORKSPACE POLICY
Uncommitted changes in the worktree are expected and normal.
Do NOT refuse to work because of dirty git state. Proceed with implementation regardless.
\`;

const JSON_OUTPUT = \`
## CRITICAL: Output Rules
1. ALWAYS wait for ALL tasks and sub-agents to fully complete before producing final output.
2. Your FINAL message MUST end with a JSON object wrapped in a code fence.
3. Background tasks: if you used run_in_background: true, you MUST call TaskOutput to retrieve
   every background task's result before writing your final JSON.
\`;

function buildSystemPrompt(role: string): string {
  return ["# Role: " + role, WORKSPACE_POLICY, JSON_OUTPUT].join("\\n\\n");
}

function createClaude(role: string, model: string = "claude-sonnet-4-6") {
  return new ClaudeCodeAgent({
    model,
    systemPrompt: buildSystemPrompt(role),
    cwd: REPO_ROOT,
    dangerouslySkipPermissions: true,
    timeoutMs: 60 * 60 * 1000,
    outputFormat: ENABLE_CLAUDE_TELEMETRY ? "stream-json" : "text",
    includePartialMessages: ENABLE_CLAUDE_TELEMETRY ? true : undefined,
  });
}

function createCodex(role: string) {
  return new CodexAgent({
    model: "gpt-5.3-codex",
    systemPrompt: buildSystemPrompt(role),
    cwd: REPO_ROOT,
    yolo: true,
    timeoutMs: 60 * 60 * 1000,
    json: ENABLE_CODEX_TELEMETRY ? true : undefined,
  });
}

function chooseAgent(primary: "claude" | "codex" | "opus", role: string) {
  if (primary === "opus" && HAS_CLAUDE) return createClaude(role, "claude-opus-4-6");
  if (primary === "claude" && HAS_CLAUDE) return createClaude(role);
  if (primary === "codex" && HAS_CODEX) return createCodex(role);
  if (HAS_CLAUDE) return createClaude(role);
  return createCodex(role);
}

const agents = {
  researcher:    chooseAgent("claude", "Researcher — Build DDD context map (bounded context, ubiquitous language, invariants)"),
  planner:       chooseAgent("opus",   "Planner — Convert RFC into BDD/TDD implementation plan with scenario mapping"),
  implementer:   chooseAgent("codex",  "Implementer — Deliver scenario-driven code via strict RED->GREEN->REFACTOR"),
  tester:        chooseAgent("claude", "Tester — Validate scenario coverage, invariant safety, and production readiness"),
  prdReviewer:   chooseAgent("claude", "PRD Reviewer — Verify acceptance criteria, Gherkin scenarios, and spec compliance"),
  codeReviewer:  chooseAgent("opus",   "Code Reviewer — Enforce production-grade quality and maintainability"),
  securityReviewer: chooseAgent("opus", "Security Reviewer — Enforce policy-level security controls and severity blocking"),
  performanceReviewer: chooseAgent("opus", "Performance Reviewer — Enforce policy-level performance constraints and hot-path safety"),
  operationalReviewer: chooseAgent("opus", "Operational Reviewer — Enforce operational readiness, rollback safety, and resilience policy"),
  reviewFixer:   chooseAgent("codex",  "ReviewFixer — Fix issues found in code review"),
  finalReviewer: chooseAgent("opus",   "Final Reviewer — Gate merge readiness with zero-slop standards"),
  mergeQueue:    chooseAgent("opus",   "MergeQueue Coordinator — Rebase and land unit branches onto main"),
};

let _resourceSamplerPrevCpu = process.cpuUsage();
let _resourceSamplerPrevTs = Date.now();

async function sampleResourceEnvelope() {
  const nowMs = Date.now();
  const elapsedMs = Math.max(1, nowMs - _resourceSamplerPrevTs);
  const deltaCpu = process.cpuUsage(_resourceSamplerPrevCpu);
  _resourceSamplerPrevCpu = process.cpuUsage();
  _resourceSamplerPrevTs = nowMs;

  const cpuCount = Math.max(1, require("node:os").cpus()?.length ?? 1);
  const cpuPercent = Number(
    (((deltaCpu.user + deltaCpu.system) / 1000 / elapsedMs / cpuCount) * 100).toFixed(3),
  );
  const rssMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(3));

  let runId = "unknown";
  try {
    const { Database } = require("bun:sqlite");
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.query(
      "SELECT run_id FROM _smithers_runs ORDER BY created_at_ms DESC, run_id DESC LIMIT 1",
    ).get() as { run_id?: string } | null;
    db.close();
    if (row?.run_id) runId = row.run_id;
  } catch {
    // best effort only
  }

  const record = {
    runId,
    nodeId: null,
    timestampMs: nowMs,
    timestamp: new Date(nowMs).toISOString(),
    cpuPercent,
    memoryRssMb: rssMb,
    metadata: { pid: process.pid, platform: process.platform },
  };

  try {
    await mkdir(_agentixDir, { recursive: true });
    await appendFile(RESOURCE_SAMPLES_PATH, JSON.stringify(record) + "\\n", "utf8");
  } catch {
    // sampler must never break workflow execution
  }
}

if (ENABLE_RESOURCE_SAMPLER) {
  setInterval(() => {
    sampleResourceEnvelope().catch(() => undefined);
  }, RESOURCE_SAMPLE_INTERVAL_MS);
}

// ── Smithers setup ────────────────────────────────────────────────────

const { smithers, outputs, Workflow, db } = createSmithers(
  scheduledOutputSchemas,
  { dbPath: DB_PATH }
);

// Workaround for macOS SQLITE_IOERR_VNODE (6922): Apple's SQLite monitors
// WAL files via GCD vnode sources. Disabling mmap prevents the invalidation
// that rapid concurrent writes trigger.
(db as any).$client.exec("PRAGMA mmap_size = 0");
(db as any).$client.exec("PRAGMA synchronous = NORMAL");

// ── Workflow ──────────────────────────────────────────────────────────

export default smithers((ctx) => (
  <Workflow name="scheduled-work" cache>
    <ScheduledWorkflow
      ctx={ctx}
      outputs={outputs}
      workPlan={workPlan}
      repoRoot={REPO_ROOT}
      maxConcurrency={MAX_CONCURRENCY}
      maxPasses={MAX_PASSES}
      mainBranch={BASE_BRANCH}
      agents={agents}
    />
  </Workflow>
));
`;
}
