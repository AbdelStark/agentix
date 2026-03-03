/**
 * agentix run — Execute or resume a scheduled workflow.
 *
 * Reads .agentix/config.json and the generated workflow file,
 * then launches execution.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  findSmithersCliPath as findSmithersCliPathDefault,
  getAgentixDir,
  launchSmithers as launchSmithersDefault,
  promptChoice as promptChoiceDefault,
  type ParsedArgs,
} from "./shared";
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

      const exitCode = await launchAndReport({
        mode: "resume",
        workflowPath,
        repoRoot,
        runId: resumeRunId,
        maxConcurrency,
        smithersCliPath,
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
        const exitCode = await launchAndReport({
          mode: "resume",
          workflowPath,
          repoRoot,
          runId: latestRunId,
          maxConcurrency,
          smithersCliPath,
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
