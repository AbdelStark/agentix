/**
 * agentix monitor — Attach TUI to a running or completed workflow.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { getAgentixDir, type ParsedArgs } from "./shared";
import { appendAgentixEvent } from "./events";
import { agentixConfigSchema } from "../scheduled/types";
import type {
  ExitAdapter,
  LatestRunIdAdapter,
  MonitorLaunchAdapter,
  MonitorLaunchRequest,
} from "./adapters";

type MonitorDeps = {
  getLatestRunId?: LatestRunIdAdapter;
  launchMonitor?: MonitorLaunchAdapter;
  appendAgentixEvent?: typeof appendAgentixEvent;
  exit?: ExitAdapter;
};

export async function runMonitor(opts: {
  flags: ParsedArgs["flags"];
  repoRoot: string;
  deps?: MonitorDeps;
}): Promise<void> {
  const { repoRoot, deps } = opts;
  const getLatestRunId = deps?.getLatestRunId ?? getLatestRunIdFromDb;
  const launchMonitor = deps?.launchMonitor ?? launchStandaloneMonitor;
  const appendEvent = deps?.appendAgentixEvent ?? appendAgentixEvent;
  const exit: ExitAdapter =
    deps?.exit ?? ((code: number) => process.exit(code));
  const agentixDir = getAgentixDir(repoRoot);
  const configPath = join(agentixDir, "config.json");
  const startedAt = Date.now();

  await appendEvent(agentixDir, {
    level: "info",
    event: "command.started",
    command: "monitor",
    details: { repoRoot },
  });

  try {
    if (!existsSync(configPath)) {
      console.error("Error: No agentix workflow found. Run `agentix init` first.");
      await appendEvent(agentixDir, {
        level: "error",
        event: "command.failed",
        command: "monitor",
        details: { reason: "missing-config" },
      });
      exit(1);
    }

    const config = agentixConfigSchema.parse(
      JSON.parse(await readFile(configPath, "utf8")),
    );

    const dbPath = join(agentixDir, "workflow.db");
    if (!existsSync(dbPath)) {
      console.error("Error: No workflow database found. Run `agentix run` first.");
      await appendEvent(agentixDir, {
        level: "error",
        event: "command.failed",
        command: "monitor",
        details: { reason: "missing-workflow-db" },
      });
      exit(1);
    }

    // Find latest run ID
    let runId: string | null;
    try {
      runId = await getLatestRunId(dbPath);
      if (!runId) throw new Error("No runs found");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: Could not find a run in the database: ${message}`);
      await appendEvent(agentixDir, {
        level: "error",
        event: "command.failed",
        command: "monitor",
        details: { reason: "missing-run-id", message },
      });
      exit(1);
      return;
    }

    const projectName = basename(repoRoot);
    const prompt = config.rfcPath ?? "";

    console.log(`Launching monitor for run ${runId}...\n`);

    const exitCode = await launchMonitor({
      dbPath,
      runId,
      projectName,
      prompt,
      repoRoot,
    });
    if (exitCode !== 0) {
      throw new Error(`monitor process exited with code ${exitCode}`);
    }

    await appendEvent(agentixDir, {
      level: "info",
      event: "command.completed",
      command: "monitor",
      runId,
      details: {
        durationMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendEvent(agentixDir, {
      level: "error",
      event: "command.failed",
      command: "monitor",
      details: {
        durationMs: Date.now() - startedAt,
        message,
      },
    });
    throw error;
  }
}

async function getLatestRunIdFromDb(dbPath: string): Promise<string | null> {
  try {
    const { Database } = require("bun:sqlite");
    const db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare(`SELECT run_id FROM _smithers_runs ORDER BY rowid DESC LIMIT 1`)
      .get() as { run_id: string } | null;
    db.close();
    return row?.run_id ?? null;
  } catch {
    return null;
  }
}

async function launchStandaloneMonitor(
  opts: MonitorLaunchRequest,
): Promise<number> {
  const { dbPath, runId, projectName, prompt, repoRoot } = opts;
  const monitorScript = join(import.meta.dir, "monitor-standalone.ts");
  const proc = Bun.spawn(
    ["bun", monitorScript, dbPath, runId, projectName, prompt],
    {
      cwd: repoRoot,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    },
  );

  return proc.exited;
}
