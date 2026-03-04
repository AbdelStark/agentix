/**
 * agentix run — Execute or resume a scheduled workflow.
 *
 * Reads .agentix/config.json and the generated workflow file,
 * then launches execution.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  findSmithersCliPath as findSmithersCliPathDefault,
  getAgentixDir,
  launchSmithers as launchSmithersDefault,
  promptChoice as promptChoiceDefault,
  type ParsedArgs,
} from "./shared";
import { renderScheduledWorkflow } from "./render-scheduled-workflow";
import { appendAgentixEvent } from "./events";
import { agentixConfigSchema, type AgentixConfig } from "../scheduled/types";
import type {
  ExitAdapter,
  LaunchAdapter,
  LatestRunIdAdapter,
  PromptAdapter,
  RunIdAdapter,
} from "./adapters";

type RunWorkflowDeps = {
  findSmithersCliPath?: (repoRoot: string) => string | null;
  launchSmithers?: LaunchAdapter;
  promptChoice?: PromptAdapter;
  appendAgentixEvent?: typeof appendAgentixEvent;
  getLatestRunId?: LatestRunIdAdapter;
  createRunId?: RunIdAdapter;
  exit?: ExitAdapter;
};

class WorkflowExitError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number, label: string) {
    super(`${label} exited with code ${exitCode}`);
    this.exitCode = exitCode;
  }
}

function parseBooleanFlag(value: string | boolean | undefined): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function parseResumeRecoveryEnabled(flags: ParsedArgs["flags"]): boolean {
  const disableFlag = parseBooleanFlag(flags["no-resume-recovery"]);
  if (disableFlag === true) return false;

  const enableFlag = parseBooleanFlag(flags["resume-recovery"]);
  if (enableFlag != null) return enableFlag;

  return true;
}

function parseResumeForceEnabled(flags: ParsedArgs["flags"]): boolean {
  const disableFlag = parseBooleanFlag(flags["no-resume-force"]);
  if (disableFlag === true) return false;

  const enableFlag = parseBooleanFlag(flags["resume-force"]);
  if (enableFlag != null) return enableFlag;

  return false;
}

type ResumeRecoverySummary = {
  enabled: boolean;
  attempted: boolean;
  recovered: boolean;
  runExists: boolean;
  runStatus: string | null;
  recoveredNodes: number;
  recoveredAttempts: number;
  backupPath: string | null;
  skippedReason: string | null;
};

type ResumeFailureAttemptSummary = {
  nodeId: string;
  iteration: number;
  attempt: number;
  finishedAtMs: number | null;
  message: string | null;
};

type ResumeFailureSnapshot = {
  runId: string;
  runStatus: string | null;
  failedNodeCount: number;
  failedAttemptCount: number;
  latestFailedAttempts: ResumeFailureAttemptSummary[];
};

function tableExists(db: any, tableName: string): boolean {
  try {
    const row = db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(tableName) as Record<string, unknown> | null;
    return !!row;
  } catch {
    return false;
  }
}

function extractFailureMessage(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractFailureMessage(item);
      if (nested) return nested;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const payload = value as Record<string, unknown>;
    for (const key of [
      "message",
      "error",
      "reason",
      "detail",
      "stderr",
      "stdout",
    ] as const) {
      const nested = extractFailureMessage(payload[key]);
      if (nested) return nested;
    }
  }
  return null;
}

function parseAttemptErrorMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return extractFailureMessage(parsed) ?? trimmed;
  } catch {
    return trimmed;
  }
}

function truncateText(text: string | null, maxChars = 240): string | null {
  if (!text || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

async function loadResumeFailureSnapshot(opts: {
  dbPath: string;
  runId: string;
  maxAttempts?: number;
}): Promise<ResumeFailureSnapshot | null> {
  const { dbPath, runId, maxAttempts = 5 } = opts;
  if (!existsSync(dbPath)) return null;

  let db: any | null = null;
  try {
    const { Database } = require("bun:sqlite");
    db = new Database(dbPath, { readonly: true });

    if (!tableExists(db, "_smithers_runs")) return null;

    const runRow = db
      .query("SELECT status FROM _smithers_runs WHERE run_id = ? LIMIT 1")
      .get(runId) as { status?: string } | null;
    if (!runRow) return null;

    const hasNodesTable = tableExists(db, "_smithers_nodes");
    const hasAttemptsTable = tableExists(db, "_smithers_attempts");

    const failedNodeCount = hasNodesTable
      ? Number(
          (
            db
              .query(
                "SELECT COUNT(*) AS count FROM _smithers_nodes WHERE run_id = ? AND state = 'failed'",
              )
              .get(runId) as { count?: number } | null
          )?.count ?? 0,
        )
      : 0;
    const failedAttemptCount = hasAttemptsTable
      ? Number(
          (
            db
              .query(
                "SELECT COUNT(*) AS count FROM _smithers_attempts WHERE run_id = ? AND state = 'failed'",
              )
              .get(runId) as { count?: number } | null
          )?.count ?? 0,
        )
      : 0;

    const latestFailedAttempts = hasAttemptsTable
      ? (db
          .query(
            `SELECT node_id, iteration, attempt, finished_at_ms, error_json
               FROM _smithers_attempts
              WHERE run_id = ? AND state = 'failed'
              ORDER BY COALESCE(finished_at_ms, 0) DESC, node_id ASC, iteration DESC, attempt DESC
              LIMIT ?`,
          )
          .all(runId, maxAttempts) as Array<{
          node_id?: string;
          iteration?: number;
          attempt?: number;
          finished_at_ms?: number | null;
          error_json?: string | null;
        }>)
          .map((row) => ({
            nodeId: String(row.node_id ?? "unknown-node"),
            iteration: Number(row.iteration ?? 0),
            attempt: Number(row.attempt ?? 0),
            finishedAtMs:
              row.finished_at_ms == null ? null : Number(row.finished_at_ms),
            message: parseAttemptErrorMessage(row.error_json),
          }))
      : [];

    return {
      runId,
      runStatus: runRow.status == null ? null : String(runRow.status),
      failedNodeCount,
      failedAttemptCount,
      latestFailedAttempts,
    };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

async function createResumeRecoveryBackup(
  dbPath: string,
  runId: string,
): Promise<string | null> {
  const backupDir = join(dirname(dbPath), "recovery-backups");
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const base = join(backupDir, `${runId}-${stamp}`);
  const dbBackupPath = `${base}.db`;

  try {
    await mkdir(backupDir, { recursive: true });
    await copyFile(dbPath, dbBackupPath);
    for (const suffix of ["-wal", "-shm"] as const) {
      const source = `${dbPath}${suffix}`;
      if (existsSync(source)) {
        await copyFile(source, `${dbBackupPath}${suffix}`);
      }
    }
    return dbBackupPath;
  } catch {
    return null;
  }
}

async function maybeRecoverResumeRun(opts: {
  dbPath: string;
  runId: string;
  enabled: boolean;
}): Promise<ResumeRecoverySummary> {
  const summary: ResumeRecoverySummary = {
    enabled: opts.enabled,
    attempted: false,
    recovered: false,
    runExists: false,
    runStatus: null,
    recoveredNodes: 0,
    recoveredAttempts: 0,
    backupPath: null,
    skippedReason: null,
  };

  if (!opts.enabled) {
    summary.skippedReason = "disabled-by-flag";
    return summary;
  }

  if (!existsSync(opts.dbPath)) {
    summary.skippedReason = "missing-db";
    return summary;
  }

  let db: any | null = null;
  let began = false;
  try {
    const { Database } = require("bun:sqlite");
    db = new Database(opts.dbPath);
    summary.attempted = true;

    if (
      !tableExists(db, "_smithers_runs") ||
      !tableExists(db, "_smithers_nodes") ||
      !tableExists(db, "_smithers_attempts")
    ) {
      summary.skippedReason = "missing-smithers-tables";
      return summary;
    }

    const runRow = db
      .query("SELECT status FROM _smithers_runs WHERE run_id = ? LIMIT 1")
      .get(opts.runId) as { status?: string } | null;
    if (!runRow) {
      summary.skippedReason = "run-not-found";
      return summary;
    }

    summary.runExists = true;
    summary.runStatus = runRow.status == null ? null : String(runRow.status);
    if (summary.runStatus !== "failed") {
      summary.skippedReason = `run-status-${summary.runStatus ?? "unknown"}`;
      return summary;
    }

    const failedNodes = db
      .query(
        `SELECT node_id, iteration
         FROM _smithers_nodes
         WHERE run_id = ? AND state = 'failed'
         ORDER BY node_id ASC, iteration ASC`,
      )
      .all(opts.runId) as Array<{ node_id: string; iteration: number }>;

    if (failedNodes.length === 0) {
      summary.skippedReason = "no-failed-nodes";
      return summary;
    }

    summary.backupPath = await createResumeRecoveryBackup(opts.dbPath, opts.runId);

    db.exec("BEGIN IMMEDIATE");
    began = true;

    const now = Date.now();
    for (const failedNode of failedNodes) {
      const attemptsResult = db
        .query(
          `UPDATE _smithers_attempts
             SET state = 'cancelled'
           WHERE run_id = ?
             AND node_id = ?
             AND iteration = ?
             AND state = 'failed'`,
        )
        .run(opts.runId, failedNode.node_id, failedNode.iteration) as
        | { changes?: number }
        | undefined;
      const changedAttempts = Number(attemptsResult?.changes ?? 0);
      if (changedAttempts > 0) {
        summary.recoveredNodes += 1;
      }
      summary.recoveredAttempts += changedAttempts;

      db.query(
        `UPDATE _smithers_nodes
            SET state = 'pending',
                updated_at_ms = ?
          WHERE run_id = ?
            AND node_id = ?
            AND iteration = ?
            AND state = 'failed'`,
      ).run(now, opts.runId, failedNode.node_id, failedNode.iteration);
    }

    if (summary.recoveredAttempts > 0) {
      db.query(
        `UPDATE _smithers_runs
            SET finished_at_ms = NULL
          WHERE run_id = ?`,
      ).run(opts.runId);
    }

    db.exec("COMMIT");
    began = false;

    summary.recovered = summary.recoveredAttempts > 0;
    if (!summary.recovered) {
      summary.skippedReason = "failed-nodes-without-failed-attempts";
    }
    return summary;
  } catch (error) {
    if (db && began) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // best-effort rollback
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    summary.skippedReason = `recovery-error:${message}`;
    return summary;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

async function emitResumeRecoveryEvent(opts: {
  appendEvent: typeof appendAgentixEvent;
  agentixDir: string;
  runId: string;
  summary: ResumeRecoverySummary;
}): Promise<void> {
  const { appendEvent, agentixDir, runId, summary } = opts;
  if (!summary.attempted && !summary.enabled) return;

  await appendEvent(agentixDir, {
    level: "info",
    event: summary.recovered
      ? "run.resume.recovered"
      : "run.resume.recovery_skipped",
    command: "run",
    runId,
    details: summary,
  });
}

async function emitResumeFailureSnapshotEvent(opts: {
  appendEvent: typeof appendAgentixEvent;
  agentixDir: string;
  runId: string;
  snapshot: ResumeFailureSnapshot | null;
}): Promise<void> {
  const { appendEvent, agentixDir, runId, snapshot } = opts;
  if (!snapshot || snapshot.failedAttemptCount === 0) return;

  await appendEvent(agentixDir, {
    level: "info",
    event: "run.resume.failure_snapshot",
    command: "run",
    runId,
    details: {
      runStatus: snapshot.runStatus,
      failedNodeCount: snapshot.failedNodeCount,
      failedAttemptCount: snapshot.failedAttemptCount,
      latestFailedAttempts: snapshot.latestFailedAttempts.map((attempt) => ({
        ...attempt,
        message: truncateText(attempt.message, 500),
      })),
    },
  });
}

function printResumeRecoverySummary(summary: ResumeRecoverySummary): void {
  if (!summary.enabled) {
    console.log("↺ Resume recovery disabled by --no-resume-recovery.\n");
    return;
  }

  if (summary.recovered) {
    console.log(
      `↺ Resume recovery reopened ${summary.recoveredNodes} node(s) and ${summary.recoveredAttempts} failed attempt(s).`,
    );
    if (summary.backupPath) {
      console.log(`  Backup snapshot: ${summary.backupPath}`);
    }
    console.log();
    return;
  }

  if (summary.runStatus === "failed" || summary.skippedReason?.startsWith("recovery-error:")) {
    console.log(
      `↺ Resume recovery skipped (${summary.skippedReason ?? "unknown"}).`,
    );
    console.log();
  }
}

function printResumeFailureSnapshot(snapshot: ResumeFailureSnapshot | null): void {
  if (!snapshot || snapshot.failedAttemptCount === 0) return;

  console.log(
    `↺ Resume context: prior run was ${snapshot.runStatus ?? "unknown"} with ${snapshot.failedNodeCount} failed node(s) and ${snapshot.failedAttemptCount} failed attempt(s).`,
  );

  if (snapshot.latestFailedAttempts.length > 0) {
    console.log("  Latest failed attempts:");
    for (const attempt of snapshot.latestFailedAttempts) {
      const finishedAt =
        attempt.finishedAtMs == null
          ? "unknown-time"
          : new Date(attempt.finishedAtMs).toISOString();
      const message =
        truncateText(attempt.message, 220) ?? "No error message recorded";
      console.log(
        `  - ${attempt.nodeId} [iteration ${attempt.iteration}, attempt ${attempt.attempt}] @ ${finishedAt}: ${message}`,
      );
    }
  }
  console.log();
}

export async function runWorkflow(opts: {
  flags: ParsedArgs["flags"];
  repoRoot: string;
  deps?: RunWorkflowDeps;
}): Promise<void> {
  const { flags, repoRoot, deps } = opts;
  const findSmithersCliPath =
    deps?.findSmithersCliPath ?? findSmithersCliPathDefault;
  const launchSmithers = deps?.launchSmithers ?? launchSmithersDefault;
  const promptChoice = deps?.promptChoice ?? promptChoiceDefault;
  const appendEvent = deps?.appendAgentixEvent ?? appendAgentixEvent;
  const getLatestRunId = deps?.getLatestRunId ?? getLatestRunIdFromDb;
  const createRunId = deps?.createRunId ?? defaultRunId;
  const exit: ExitAdapter =
    deps?.exit ?? ((code: number) => process.exit(code));
  const agentixDir = getAgentixDir(repoRoot);
  const configPath = join(agentixDir, "config.json");
  const startedAt = Date.now();
  const enableResumeRecovery = parseResumeRecoveryEnabled(flags);
  const enableResumeForce = parseResumeForceEnabled(flags);

  const resumeRunId =
    typeof flags.resume === "string" ? flags.resume : null;
  let activeRunId: string | undefined = resumeRunId ?? undefined;

  await appendEvent(agentixDir, {
    level: "info",
    event: "command.started",
    command: "run",
    details: {
      repoRoot,
      resumeRunId,
    },
  });

  try {
    // ── Load config ─────────────────────────────────────────────────────
    if (!existsSync(configPath)) {
      console.error(
        "Error: No workflow initialized. Run `agentix init` first.",
      );
      await appendEvent(agentixDir, {
        level: "error",
        event: "command.failed",
        command: "run",
        details: { reason: "missing-config" },
      });
      exit(1);
    }

    const config: AgentixConfig = agentixConfigSchema.parse(
      JSON.parse(await readFile(configPath, "utf8")),
    );

    // ── Find Smithers ───────────────────────────────────────────────────
    const smithersCliPath = findSmithersCliPath(repoRoot);
    if (!smithersCliPath) {
      console.error(
        "Error: Could not find smithers CLI. Install smithers-orchestrator:\n  bun add smithers-orchestrator",
      );
      await appendEvent(agentixDir, {
        level: "error",
        event: "command.failed",
        command: "run",
        details: { reason: "missing-smithers-cli" },
      });
      exit(1);
    }

    const maxConcurrency =
      typeof flags["max-concurrency"] === "string"
        ? Math.max(1, Number(flags["max-concurrency"]) || config.maxConcurrency)
        : config.maxConcurrency;

    // ── Execute scheduled work ──────────────────────────────────────────
    const planPath = join(agentixDir, "work-plan.json");
    if (!existsSync(planPath)) {
      console.error(
        "Error: No work plan found. Run `agentix plan` or `agentix init` first.",
      );
      await appendEvent(agentixDir, {
        level: "error",
        event: "command.failed",
        command: "run",
        details: { reason: "missing-work-plan" },
      });
      exit(1);
    }

    const dbPath = join(agentixDir, "workflow.db");
    const generatedDir = join(agentixDir, "generated");
    const workflowPath = join(generatedDir, "workflow.tsx");

    if (!existsSync(workflowPath)) {
      console.error(
        "Error: No workflow file found. Run `agentix init` first.",
      );
      await appendEvent(agentixDir, {
        level: "error",
        event: "command.failed",
        command: "run",
        details: { reason: "missing-workflow-file" },
      });
      exit(1);
    }

    // Keep generated workflow aligned with current runtime code so timeout and
    // observability improvements apply to existing .agentix directories.
    await writeFile(
      workflowPath,
      renderScheduledWorkflow({ repoRoot }),
      "utf8",
    );

    // ── Resume path ─────────────────────────────────────────────────────
    if (resumeRunId) {
      if (!existsSync(dbPath)) {
        console.error("Error: No database found. Cannot resume.");
        await appendEvent(agentixDir, {
          level: "error",
          event: "command.failed",
          command: "run",
          details: { reason: "missing-db-for-resume", resumeRunId },
        });
        exit(1);
      }

      const resumeFailureSnapshot = await loadResumeFailureSnapshot({
        dbPath,
        runId: resumeRunId,
      });
      await emitResumeFailureSnapshotEvent({
        appendEvent,
        agentixDir,
        runId: resumeRunId,
        snapshot: resumeFailureSnapshot,
      });
      printResumeFailureSnapshot(resumeFailureSnapshot);

      const resumeRecovery = await maybeRecoverResumeRun({
        dbPath,
        runId: resumeRunId,
        enabled: enableResumeRecovery,
      });
      await emitResumeRecoveryEvent({
        appendEvent,
        agentixDir,
        runId: resumeRunId,
        summary: resumeRecovery,
      });
      printResumeRecoverySummary(resumeRecovery);

      const exitCode = await launchAndReport({
        mode: "resume",
        workflowPath,
        repoRoot,
        runId: resumeRunId,
        maxConcurrency,
        smithersCliPath,
        forceResume: enableResumeForce,
        label: "Scheduled Work (resume)",
        launchSmithers,
      });
      await appendEvent(agentixDir, {
        level: "info",
        event: "command.completed",
        command: "run",
        runId: resumeRunId,
        details: {
          durationMs: Date.now() - startedAt,
          mode: "resume",
          exitCode,
          maxConcurrency,
          forceResume: enableResumeForce,
          resumeRecovery,
        },
      });
      return;
    }

    // ── Check for existing run ──────────────────────────────────────────
    if (existsSync(workflowPath) && existsSync(dbPath)) {
      const latestRunId = await getLatestRunId(dbPath);

      console.log("Found an existing scheduled-work run.\n");
      const options = [
        "Start fresh (new run ID)",
      ];
      if (latestRunId) {
        options.push(`Resume previous run (${latestRunId})`);
      }
      options.push("Cancel");

      const choice = await promptChoice("What would you like to do?", options);

      if (choice === 1 && latestRunId) {
        activeRunId = latestRunId;
        const resumeFailureSnapshot = await loadResumeFailureSnapshot({
          dbPath,
          runId: latestRunId,
        });
        await emitResumeFailureSnapshotEvent({
          appendEvent,
          agentixDir,
          runId: latestRunId,
          snapshot: resumeFailureSnapshot,
        });
        printResumeFailureSnapshot(resumeFailureSnapshot);
        const resumeRecovery = await maybeRecoverResumeRun({
          dbPath,
          runId: latestRunId,
          enabled: enableResumeRecovery,
        });
        await emitResumeRecoveryEvent({
          appendEvent,
          agentixDir,
          runId: latestRunId,
          summary: resumeRecovery,
        });
        printResumeRecoverySummary(resumeRecovery);
        const exitCode = await launchAndReport({
          mode: "resume",
          workflowPath,
          repoRoot,
          runId: latestRunId,
          maxConcurrency,
          smithersCliPath,
          forceResume: enableResumeForce,
          label: "Scheduled Work (resume)",
          launchSmithers,
        });
        await appendEvent(agentixDir, {
          level: "info",
          event: "command.completed",
          command: "run",
          runId: latestRunId,
          details: {
            durationMs: Date.now() - startedAt,
            mode: "resume",
            exitCode,
            maxConcurrency,
            forceResume: enableResumeForce,
            resumeRecovery,
          },
        });
        return;
      }
      if (
        (choice === 2 && latestRunId) ||
        (choice === 1 && !latestRunId)
      ) {
        await appendEvent(agentixDir, {
          level: "info",
          event: "command.cancelled",
          command: "run",
          details: {
            reason: "user-cancelled-existing-run-choice",
            durationMs: Date.now() - startedAt,
          },
        });
        exit(0);
      }
      // choice 0: fall through to fresh run
    }

    // ── Confirm before running ──────────────────────────────────────────
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    const unitCount = plan.units?.length ?? 0;

    console.log(`\n🚀 agentix — Scheduled Work\n`);
    console.log(`  RFC: ${config.rfcPath}`);
    console.log(`  Work units: ${unitCount}`);
    console.log(`  Max concurrency: ${maxConcurrency}`);
    console.log(`  Agents: claude=${config.agents.claude} codex=${config.agents.codex}\n`);

    const confirmChoice = await promptChoice(
      `Execute ${unitCount} work units?`,
      ["Yes, start", "No, cancel"],
    );
    if (confirmChoice !== 0) {
      console.log("Cancelled.\n");
      await appendEvent(agentixDir, {
        level: "info",
        event: "command.cancelled",
        command: "run",
        details: {
          reason: "user-cancelled-pre-run-confirmation",
          durationMs: Date.now() - startedAt,
        },
      });
      exit(0);
    }

    const runId = createRunId();
    activeRunId = runId;

    const exitCode = await launchAndReport({
      mode: "run",
      workflowPath,
      repoRoot,
      runId,
      maxConcurrency,
      smithersCliPath,
      label: "Scheduled Work",
      launchSmithers,
    });
    await appendEvent(agentixDir, {
      level: "info",
      event: "command.completed",
      command: "run",
      runId,
      details: {
        durationMs: Date.now() - startedAt,
        mode: "run",
        exitCode,
        maxConcurrency,
        unitCount,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendEvent(agentixDir, {
      level: "error",
      event: "command.failed",
      command: "run",
      runId: activeRunId,
      details: {
        durationMs: Date.now() - startedAt,
        message,
      },
    });
    if (error instanceof WorkflowExitError) {
      exit(error.exitCode);
    }
    throw error;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

async function launchAndReport(opts: {
  mode: "run" | "resume";
  workflowPath: string;
  repoRoot: string;
  runId: string;
  maxConcurrency: number;
  smithersCliPath: string;
  forceResume?: boolean;
  label: string;
  launchSmithers: LaunchAdapter;
}): Promise<number> {
  const { label, launchSmithers, ...launchOpts } = opts;

  console.log(`🎬 ${label} — Starting execution...`);
  console.log(`  Run ID: ${launchOpts.runId}\n`);

  const exitCode = await launchSmithers(launchOpts);
  reportExit(exitCode, label);
  return exitCode;
}

function reportExit(exitCode: number, label: string): void {
  if (exitCode === 0) {
    console.log(`\n✅ ${label} completed successfully!\n`);
  } else {
    throw new WorkflowExitError(exitCode, label);
  }
}

function defaultRunId(): string {
  return `sw-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

async function getLatestRunIdFromDb(dbPath: string): Promise<string | null> {
  try {
    const { Database } = require("bun:sqlite");
    const db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare(
        `SELECT run_id FROM _smithers_runs ORDER BY rowid DESC LIMIT 1`,
      )
      .get() as { run_id: string } | null;
    db.close();
    return row?.run_id ?? null;
  } catch {
    return null;
  }
}
