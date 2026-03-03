/**
 * agentix init scheduled-work — Initialize an RFC-driven workflow.
 *
 * 1. Reads the RFC file
 * 2. Scans the repo for build/test commands
 * 3. Detects available agents
 * 4. AI decomposes RFC into work units + dependency DAG
 * 5. Writes .agentix/config.json and .agentix/work-plan.json
 * 6. Prints summary
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  detectAgents as detectAgentsDefault,
  detectCurrentBranch as detectCurrentBranchDefault,
  ensureJjColocated as ensureJjColocatedDefault,
  getAgentixDir,
  agentixSourceRoot,
  scanRepo as scanRepoDefault,
  type RepoConfig,
  type ParsedArgs,
} from "./shared";
import { appendAgentixEvent } from "./events";
import {
  decomposeRFC as decomposeRFCDefault,
  printPlanSummary,
} from "../scheduled/decompose";
import type { AgentixConfig } from "../scheduled/types";
import { renderScheduledWorkflow as renderScheduledWorkflowDefault } from "./render-scheduled-workflow";
import type {
  AgentDetectionAdapter,
  DecomposeAdapter,
  ExitAdapter,
} from "./adapters";

type InitScheduledDeps = {
  detectAgents?: AgentDetectionAdapter;
  decomposeRFC?: DecomposeAdapter;
  ensureJjColocated?: (repoRoot: string) => Promise<void>;
  scanRepo?: (repoRoot: string) => Promise<RepoConfig>;
  detectCurrentBranch?: (repoRoot: string) => Promise<string>;
  appendAgentixEvent?: typeof appendAgentixEvent;
  renderScheduledWorkflow?: typeof renderScheduledWorkflowDefault;
  exit?: ExitAdapter;
};

export async function initScheduledWork(opts: {
  positional: string[];
  flags: ParsedArgs["flags"];
  repoRoot: string;
  deps?: InitScheduledDeps;
}): Promise<void> {
  const { positional, flags, repoRoot, deps } = opts;
  const appendEvent = deps?.appendAgentixEvent ?? appendAgentixEvent;
  const detectAgents = deps?.detectAgents ?? detectAgentsDefault;
  const decomposeRFC = deps?.decomposeRFC ?? decomposeRFCDefault;
  const ensureJjColocated = deps?.ensureJjColocated ?? ensureJjColocatedDefault;
  const scanRepo = deps?.scanRepo ?? scanRepoDefault;
  const detectCurrentBranch =
    deps?.detectCurrentBranch ?? detectCurrentBranchDefault;
  const renderScheduledWorkflow =
    deps?.renderScheduledWorkflow ?? renderScheduledWorkflowDefault;
  const exit: ExitAdapter =
    deps?.exit ?? ((code: number) => process.exit(code));
  const agentixDir = getAgentixDir(repoRoot);
  const startedAt = Date.now();

  await appendEvent(agentixDir, {
    level: "info",
    event: "command.started",
    command: "init",
    details: {
      repoRoot,
      rfcArg: positional[0] ?? null,
    },
  });

  try {
    console.log("🗂️  agentix — Scheduled Work Mode\n");

    // ── Read RFC file ───────────────────────────────────────────────────
    const rfcArg = positional[0];
    if (!rfcArg) {
      console.error("Error: RFC file path is required.");
      console.error("Usage: agentix init ./path/to/rfc.md");
      await appendEvent(agentixDir, {
        level: "error",
        event: "command.failed",
        command: "init",
        details: { reason: "missing-rfc-path" },
      });
      exit(1);
    }

    const rfcPath = resolve(repoRoot, rfcArg);
    if (!existsSync(rfcPath)) {
      console.error(`Error: RFC file not found: ${rfcPath}`);
      await appendEvent(agentixDir, {
        level: "error",
        event: "command.failed",
        command: "init",
        details: { reason: "rfc-not-found", rfcPath },
      });
      exit(1);
    }

    const rfcContent = await readFile(rfcPath, "utf8");
    console.log(`  RFC: ${rfcPath}`);
    console.log(`  Repo: ${repoRoot}`);

    // ── Check prerequisites ─────────────────────────────────────────────
    await ensureJjColocated(repoRoot);

    // ── Scan repo ───────────────────────────────────────────────────────
    const repoConfig = await scanRepo(repoRoot);
    console.log(`  Project: ${repoConfig.projectName}`);
    console.log(`  Package manager: ${repoConfig.runner}`);

    if (Object.keys(repoConfig.buildCmds).length > 0) {
      console.log(
        `  Build: ${Object.values(repoConfig.buildCmds).join(", ")}`,
      );
    }
    if (Object.keys(repoConfig.testCmds).length > 0) {
      console.log(
        `  Test: ${Object.values(repoConfig.testCmds).join(", ")}`,
      );
    }

    // ── Detect agents ───────────────────────────────────────────────────
    const agents = await detectAgents(repoRoot);
    console.log(
      `  Agents: claude=${agents.claude} codex=${agents.codex}`,
    );

    if (!agents.claude && !agents.codex) {
      console.error(
        "\nError: No supported agent CLI detected. Install claude and/or codex.",
      );
      await appendEvent(agentixDir, {
        level: "error",
        event: "command.failed",
        command: "init",
        details: { reason: "no-supported-agents" },
      });
      exit(1);
    }

    // ── Decompose RFC ───────────────────────────────────────────────────
    console.log();
    const { plan, layers } = await decomposeRFC(rfcContent, repoConfig);
    plan.source = rfcPath;

    printPlanSummary(plan, layers);

    // ── Write outputs ───────────────────────────────────────────────────
    await mkdir(agentixDir, { recursive: true });

    const maxConcurrency =
      typeof flags["max-concurrency"] === "string"
        ? Math.max(1, Number(flags["max-concurrency"]) || 6)
        : 6;

    const baseBranch =
      typeof flags["base-branch"] === "string"
        ? flags["base-branch"]
        : await detectCurrentBranch(repoRoot);
    console.log(`  Base branch: ${baseBranch}`);

    const config: AgentixConfig = {
      mode: "scheduled-work",
      repoRoot,
      rfcPath,
      agents,
      maxConcurrency,
      baseBranch,
      createdAt: new Date().toISOString(),
    };

    const configPath = join(agentixDir, "config.json");
    const planPath = join(agentixDir, "work-plan.json");

    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    await writeFile(planPath, JSON.stringify(plan, null, 2) + "\n", "utf8");

    // ── Generate workflow file ──────────────────────────────────────────
    const generatedDir = join(agentixDir, "generated");
    await mkdir(generatedDir, { recursive: true });

    const workflowPath = join(generatedDir, "workflow.tsx");

    const workflowSource = renderScheduledWorkflow({ repoRoot });
    await writeFile(workflowPath, workflowSource, "utf8");

    // Ensure node_modules symlink so the generated file can resolve imports
    const generatedNodeModules = join(generatedDir, "node_modules");
    const sourceNodeModules = join(agentixSourceRoot, "node_modules");
    if (!existsSync(generatedNodeModules) && existsSync(sourceNodeModules)) {
      try {
        const { symlinkSync } = await import("fs");
        symlinkSync(sourceNodeModules, generatedNodeModules, "dir");
      } catch {
        // ignore
      }
    }

    console.log(`  Written:`);
    console.log(`    ${configPath}`);
    console.log(`    ${planPath}`);
    console.log(`    ${workflowPath}`);
    console.log();
    console.log(
      `  Review and edit ${planPath} if needed, then run:`,
    );
    console.log(`    agentix run`);
    console.log();

    await appendEvent(agentixDir, {
      level: "info",
      event: "command.completed",
      command: "init",
      details: {
        durationMs: Date.now() - startedAt,
        unitCount: plan.units.length,
        layerCount: layers.length,
        maxConcurrency,
      },
    });

    if (flags["dry-run"]) {
      console.log("  (dry-run: workflow not executed)\n");
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendEvent(agentixDir, {
      level: "error",
      event: "command.failed",
      command: "init",
      details: {
        durationMs: Date.now() - startedAt,
        message,
      },
    });
    throw error;
  }
}
