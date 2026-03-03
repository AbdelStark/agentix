/**
 * agentix status — Show current workflow state.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getAgentixDir } from "./shared";
import { appendAgentixEvent } from "./events";
import { agentixConfigSchema } from "../scheduled/types";

export async function runStatus(opts: { repoRoot: string }): Promise<void> {
  const { repoRoot } = opts;
  const agentixDir = getAgentixDir(repoRoot);
  const configPath = join(agentixDir, "config.json");
  const startedAt = Date.now();

  await appendAgentixEvent(agentixDir, {
    level: "info",
    event: "command.started",
    command: "status",
    details: { repoRoot },
  });

  try {
    if (!existsSync(configPath)) {
      console.log("No agentix workflow initialized in this directory.\n");
      console.log("Run `agentix init` to get started.");
      await appendAgentixEvent(agentixDir, {
        level: "info",
        event: "command.completed",
        command: "status",
        details: {
          durationMs: Date.now() - startedAt,
          initialized: false,
        },
      });
      return;
    }

    const config = agentixConfigSchema.parse(
      JSON.parse(await readFile(configPath, "utf8")),
    );

    console.log(`agentix — Status\n`);
    console.log(`  Mode: ${config.mode}`);
    console.log(`  Repo: ${config.repoRoot}`);
    console.log(`  Created: ${config.createdAt}`);
    console.log(
      `  Agents: claude=${config.agents.claude} codex=${config.agents.codex}`,
    );

    let unitCount = 0;
    if (config.mode === "scheduled-work") {
      const planPath = join(agentixDir, "work-plan.json");
      if (existsSync(planPath)) {
        const plan = JSON.parse(await readFile(planPath, "utf8"));
        unitCount = plan.units?.length ?? 0;
        console.log(`  RFC: ${config.rfcPath}`);
        console.log(`  Work units: ${unitCount}`);
      } else {
        console.log("  Work plan: not generated yet");
      }
    }

    let latestRunId: string | null = null;
    const dbPath = join(agentixDir, "workflow.db");
    if (existsSync(dbPath)) {
      latestRunId = getLatestRunId(dbPath);
      if (latestRunId) {
        console.log(`  Latest run: ${latestRunId}`);
      }
    }

    const workflowPath = join(agentixDir, "generated", "workflow.tsx");
    const workflowGenerated = existsSync(workflowPath);
    console.log(
      `  Workflow generated: ${workflowGenerated ? "yes" : "no"}`,
    );

    console.log();

    await appendAgentixEvent(agentixDir, {
      level: "info",
      event: "command.completed",
      command: "status",
      runId: latestRunId ?? undefined,
      details: {
        durationMs: Date.now() - startedAt,
        initialized: true,
        unitCount,
        workflowGenerated,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendAgentixEvent(agentixDir, {
      level: "error",
      event: "command.failed",
      command: "status",
      details: {
        durationMs: Date.now() - startedAt,
        message,
      },
    });
    throw error;
  }
}

function getLatestRunId(dbPath: string): string | null {
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
