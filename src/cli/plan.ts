/**
 * agentix plan — (Re)generate the work plan from an RFC.
 *
 * Reads the RFC path from .agentix/config.json, re-runs decomposition,
 * and overwrites .agentix/work-plan.json.
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getAgentixDir, scanRepo, type ParsedArgs } from "./shared";
import { decomposeRFC, printPlanSummary } from "../scheduled/decompose";
import { agentixConfigSchema, type AgentixConfig } from "../scheduled/types";

export async function runPlan(opts: {
  flags: ParsedArgs["flags"];
  repoRoot: string;
}): Promise<void> {
  const { repoRoot } = opts;
  const agentixDir = getAgentixDir(repoRoot);
  const configPath = join(agentixDir, "config.json");

  if (!existsSync(configPath)) {
    console.error(
      "Error: No agentix config found. Run `agentix init ./rfc.md` first.",
    );
    process.exit(1);
  }

  const config: AgentixConfig = agentixConfigSchema.parse(
    JSON.parse(await readFile(configPath, "utf8")),
  );

  if (config.mode !== "scheduled-work") {
    console.error(
      "Error: `agentix plan` only works in scheduled-work mode.",
    );
    process.exit(1);
  }

  if (!config.rfcPath || !existsSync(config.rfcPath)) {
    console.error(`Error: RFC file not found: ${config.rfcPath}`);
    process.exit(1);
  }

  console.log("🗂️  agentix plan — Regenerating work plan\n");
  console.log(`  RFC: ${config.rfcPath}`);

  const rfcContent = await readFile(config.rfcPath, "utf8");
  const repoConfig = await scanRepo(repoRoot);

  const { plan, layers } = await decomposeRFC(rfcContent, repoConfig);
  plan.source = config.rfcPath;

  printPlanSummary(plan, layers);

  const planPath = join(agentixDir, "work-plan.json");
  await writeFile(planPath, JSON.stringify(plan, null, 2) + "\n", "utf8");

  console.log(`  Updated: ${planPath}`);
  console.log();
}
