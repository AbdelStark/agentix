#!/usr/bin/env bun
/**
 * agentix — RFC-driven AI development workflow CLI
 *
 * Commands:
 *   agentix init ./rfc.md            Initialize workflow from RFC
 *   agentix plan                     (Re)generate work plan from RFC
 *   agentix run                      Execute the initialized workflow
 *   agentix run --resume <run-id>    Resume a previous run
 *   agentix monitor                  Attach TUI to running workflow
 *   agentix status                   Show current state
 *   agentix analytics summary         Telemetry summary + snapshots
 *   agentix analytics failures        Failure taxonomy/top reasons
 */

import { resolve } from "node:path";
import { parseArgs } from "./shared";

function printHelp() {
  console.log(`agentix — RFC-driven AI development workflow CLI

Usage:
  agentix init ./rfc-003.md

  agentix plan                             (Re)generate work plan from RFC
  agentix run                              Execute the initialized workflow
  agentix run --resume <run-id>            Resume a previous run
  agentix monitor                          Attach TUI to running workflow
  agentix status                           Show current state
  agentix analytics summary --window 7d    Telemetry summary + snapshot
  agentix analytics failures --top 10      Top failure reasons

Global Options:
  --cwd <path>                Repo root (default: current directory)
  --max-concurrency <n>       Max parallel work units (default: 6)
  --help                      Show this help

Init Options:
  --dry-run                   Generate work plan but don't execute

Examples:
  agentix init ./docs/rfc-003.md
  agentix plan
  agentix run
  agentix run --resume sw-m3abc12-deadbeef
  agentix analytics summary --window 7d --json
`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.flags.help) {
    printHelp();
    process.exit(0);
  }

  const repoRoot = resolve(
    typeof parsed.flags.cwd === "string"
      ? parsed.flags.cwd
      : process.cwd(),
  );

  const command = parsed.positional[0];

  switch (command) {
    case "init": {
      const { initScheduledWork } = await import("./init-scheduled");
      return initScheduledWork({
        positional: parsed.positional.slice(1),
        flags: parsed.flags,
        repoRoot,
      });
    }

    case "plan": {
      const { runPlan } = await import("./plan");
      return runPlan({ flags: parsed.flags, repoRoot });
    }

    case "run": {
      const { runWorkflow } = await import("./run");
      return runWorkflow({ flags: parsed.flags, repoRoot });
    }

    case "monitor": {
      const { runMonitor } = await import("./monitor-cmd");
      return runMonitor({ flags: parsed.flags, repoRoot });
    }

    case "status": {
      const { runStatus } = await import("./status");
      return runStatus({ repoRoot });
    }

    case "analytics": {
      const { runAnalyticsCommand } = await import("./analytics-cmd");
      return runAnalyticsCommand({
        positional: parsed.positional.slice(1),
        flags: parsed.flags,
        repoRoot,
      });
    }

    default: {
      if (!command) {
        const { runWorkflow } = await import("./run");
        return runWorkflow({ flags: parsed.flags, repoRoot });
      }

      console.error(
        `Unknown command: "${command}". Run "agentix --help" for usage.`,
      );
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error("\n❌ Error:", error.message);
  process.exit(1);
});
