/**
 * agentix monitor — Attach TUI to a running or completed workflow.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { getAgentixDir, type ParsedArgs } from "./shared";
import { appendAgentixEvent } from "./events";
import { agentixConfigSchema } from "../scheduled/types";

export async function runMonitor(opts: {
  flags: ParsedArgs["flags"];
  repoRoot: string;
}): Promise<void> {
  const { repoRoot } = opts;
  const agentixDir = getAgentixDir(repoRoot);
  const configPath = join(agentixDir, "config.json");
  const startedAt = Date.now();

  await appendAgentixEvent(agentixDir, {
    level: "info",
    event: "command.started",
    command: "monitor",
    details: { repoRoot },
  });

  try {
    if (!existsSync(configPath)) {
      console.error("Error: No agentix workflow found. Run `agentix init` first.");
      await appendAgentixEvent(agentixDir, {
        level: "error",
        event: "command.failed",
        command: "monitor",
        details: { reason: "missing-config" },
      });
      process.exit(1);
    }

    const config = agentixConfigSchema.parse(
      JSON.parse(await readFile(configPath, "utf8")),
    );

    const dbPath = join(agentixDir, "workflow.db");
    if (!existsSync(dbPath)) {
      console.error("Error: No workflow database found. Run `agentix run` first.");
      await appendAgentixEvent(agentixDir, {
        level: "error",
        event: "command.failed",
        command: "monitor",
        details: { reason: "missing-workflow-db" },
      });
      process.exit(1);
    }

    // Find latest run ID
    let runId: string;
    try {
      const { Database } = require("bun:sqlite");
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .prepare(`SELECT run_id FROM _smithers_runs ORDER BY rowid DESC LIMIT 1`)
        .get() as { run_id: string } | null;
      db.close();
      if (!row?.run_id) throw new Error("No runs found");
      runId = row.run_id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: Could not find a run in the database: ${message}`);
      await appendAgentixEvent(agentixDir, {
        level: "error",
        event: "command.failed",
        command: "monitor",
        details: { reason: "missing-run-id", message },
      });
      process.exit(1);
      return;
    }

    const projectName = basename(repoRoot);
    const prompt = config.rfcPath ?? "";

    console.log(`Launching monitor for run ${runId}...\n`);

    const cliDir = import.meta.dir;
    const monitorScript = join(cliDir, "monitor-standalone.ts");

    const proc = Bun.spawn(
      ["bun", monitorScript, dbPath, runId, projectName, prompt],
      {
        cwd: repoRoot,
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      },
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`monitor process exited with code ${exitCode}`);
    }

    await appendAgentixEvent(agentixDir, {
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
    await appendAgentixEvent(agentixDir, {
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
