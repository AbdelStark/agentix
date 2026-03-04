import { expect } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import type { AgentixEvent } from "../events";
import { AGENTIX_DIR, type RepoConfig } from "../shared";
import type { AgentixConfig, WorkPlan, WorkUnit } from "../../scheduled/types";

const tempRepos: string[] = [];

export async function createTempRepo(prefix = "agentix-cli-int-"): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), prefix));
  tempRepos.push(repoRoot);
  await writeMinimalPackageScaffold(repoRoot);
  return repoRoot;
}

export async function cleanupTempRepos(): Promise<void> {
  await Promise.all(
    tempRepos.splice(0).map((repoRoot) => rm(repoRoot, { recursive: true, force: true })),
  );
}

export async function writeMinimalPackageScaffold(repoRoot: string): Promise<void> {
  await writeFile(join(repoRoot, "bun.lock"), "", "utf8");
  await writeFile(
    join(repoRoot, "package.json"),
    JSON.stringify(
      {
        name: "fixture-repo",
        version: "0.0.0",
        scripts: {
          typecheck: "tsc --noEmit",
          build: "bun run build",
          lint: "bun run lint",
          test: "bun test",
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

export async function writeRfc(
  repoRoot: string,
  relativePath = "docs/rfc.md",
  content = "# RFC\n\nDeterministic CLI integration harness",
): Promise<string> {
  const rfcPath = join(repoRoot, relativePath);
  await mkdir(dirname(rfcPath), { recursive: true });
  await writeFile(rfcPath, content, "utf8");
  return rfcPath;
}

export function agentixPath(repoRoot: string, ...parts: string[]): string {
  return join(repoRoot, AGENTIX_DIR, ...parts);
}

export async function writeAgentixConfig(
  repoRoot: string,
  overrides: Partial<AgentixConfig> = {},
): Promise<AgentixConfig> {
  const config: AgentixConfig = {
    mode: "scheduled-work",
    repoRoot,
    rfcPath: overrides.rfcPath ?? join(repoRoot, "docs/rfc.md"),
    agents: overrides.agents ?? { claude: true, codex: false, gh: false },
    maxConcurrency: overrides.maxConcurrency ?? 6,
    baseBranch: overrides.baseBranch ?? "main",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  };

  await mkdir(agentixPath(repoRoot), { recursive: true });
  await writeFile(
    agentixPath(repoRoot, "config.json"),
    JSON.stringify(config, null, 2) + "\n",
    "utf8",
  );

  return config;
}

export function makeDeterministicPlan(source = "fixture-rfc.md"): {
  plan: WorkPlan;
  layers: WorkUnit[][];
} {
  const unit: WorkUnit = {
    id: "cli-harness",
    name: "CLI Harness",
    rfcSections: ["§1"],
    description: "Implement deterministic CLI integration harness",
    deps: [],
    acceptance: ["integration harness is deterministic"],
    boundedContext: "cli-testing",
    ubiquitousLanguage: ["harness", "workflow", "run-id"],
    domainInvariants: ["Workflow run IDs are tracked consistently across events"],
    gherkinFeature: "Run deterministic CLI commands",
    gherkinRule: "External boundaries are mocked",
    gherkinScenarios: [
      {
        id: "deterministic-init",
        title: "Init writes deterministic artifacts",
        given: ["a fixture repository with an RFC"],
        when: ["agentix init runs with deterministic adapters"],
        then: ["config and plan artifacts are written"],
      },
    ],
    tier: "small",
  };

  return {
    plan: {
      source,
      generatedAt: "2026-01-01T00:00:00.000Z",
      repo: {
        projectName: "fixture-repo",
        buildCmds: { typecheck: "bun run typecheck" },
        testCmds: { test: "bun run test" },
      },
      units: [unit],
    },
    layers: [[unit]],
  };
}

export async function writeAgentixWorkPlan(
  repoRoot: string,
  plan = makeDeterministicPlan().plan,
): Promise<WorkPlan> {
  await mkdir(agentixPath(repoRoot), { recursive: true });
  await writeFile(
    agentixPath(repoRoot, "work-plan.json"),
    JSON.stringify(plan, null, 2) + "\n",
    "utf8",
  );
  return plan;
}

export async function writeGeneratedWorkflow(
  repoRoot: string,
  source = "export const workflow = {};\n",
): Promise<string> {
  const workflowPath = agentixPath(repoRoot, "generated", "workflow.tsx");
  await mkdir(dirname(workflowPath), { recursive: true });
  await writeFile(workflowPath, source, "utf8");
  return workflowPath;
}

export async function writeWorkflowDbWithRuns(
  repoRoot: string,
  runIds: string[],
): Promise<string> {
  const dbPath = agentixPath(repoRoot, "workflow.db");
  await mkdir(agentixPath(repoRoot), { recursive: true });

  const { Database } = await import("bun:sqlite");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE IF NOT EXISTS _smithers_runs (run_id TEXT NOT NULL)");
  db.exec("DELETE FROM _smithers_runs");
  const stmt = db.prepare("INSERT INTO _smithers_runs (run_id) VALUES (?)");
  for (const runId of runIds) stmt.run(runId);
  db.close();

  return dbPath;
}

export async function writeWorkflowDbWithFailedResumeNodes(
  repoRoot: string,
  runId: string,
): Promise<string> {
  const dbPath = agentixPath(repoRoot, "workflow.db");
  await mkdir(agentixPath(repoRoot), { recursive: true });

  const { Database } = await import("bun:sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS _smithers_runs (
      run_id TEXT PRIMARY KEY,
      status TEXT,
      finished_at_ms INTEGER
    );
    CREATE TABLE IF NOT EXISTS _smithers_nodes (
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      iteration INTEGER NOT NULL,
      state TEXT NOT NULL,
      last_attempt INTEGER,
      updated_at_ms INTEGER,
      output_table TEXT,
      label TEXT
    );
    CREATE TABLE IF NOT EXISTS _smithers_attempts (
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      iteration INTEGER NOT NULL,
      attempt INTEGER NOT NULL,
      state TEXT NOT NULL,
      started_at_ms INTEGER,
      finished_at_ms INTEGER,
      error_json TEXT
    );
  `);

  db.exec("DELETE FROM _smithers_runs");
  db.exec("DELETE FROM _smithers_nodes");
  db.exec("DELETE FROM _smithers_attempts");

  db.prepare(
    "INSERT INTO _smithers_runs (run_id, status, finished_at_ms) VALUES (?, ?, ?)",
  ).run(runId, "failed", Date.now());

  db.prepare(
    `INSERT INTO _smithers_nodes
      (run_id, node_id, iteration, state, last_attempt, updated_at_ms, output_table, label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId,
    "stuck-unit:final-review",
    4,
    "failed",
    2,
    Date.now(),
    "final_review",
    null,
  );

  db.prepare(
    `INSERT INTO _smithers_attempts
      (run_id, node_id, iteration, attempt, state, started_at_ms, finished_at_ms, error_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId,
    "stuck-unit:final-review",
    4,
    1,
    "failed",
    Date.now() - 10_000,
    Date.now() - 9_000,
    JSON.stringify({ message: "CLI timed out after 300000ms" }),
  );
  db.prepare(
    `INSERT INTO _smithers_attempts
      (run_id, node_id, iteration, attempt, state, started_at_ms, finished_at_ms, error_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId,
    "stuck-unit:final-review",
    4,
    2,
    "failed",
    Date.now() - 8_000,
    Date.now() - 7_000,
    JSON.stringify({ message: "CLI timed out after 300000ms" }),
  );

  db.close();
  return dbPath;
}

export async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function readAgentixJson<T>(
  repoRoot: string,
  filename: string,
): Promise<T> {
  return readJsonFile<T>(agentixPath(repoRoot, filename));
}

export async function readAgentixEvents(repoRoot: string): Promise<AgentixEvent[]> {
  const eventsPath = agentixPath(repoRoot, "events.jsonl");
  if (!existsSync(eventsPath)) return [];

  const raw = await readFile(eventsPath, "utf8");
  const lines = raw.trim().split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line) as AgentixEvent);
}

export type DecomposeCall = { rfcContent: string; repoConfig: RepoConfig };
export type LaunchCall = {
  mode: "run" | "resume";
  workflowPath: string;
  repoRoot: string;
  runId: string;
  maxConcurrency: number;
  smithersCliPath: string;
};
export type PromptCall = { message: string; options: string[] };
export type MonitorLaunchCall = {
  dbPath: string;
  runId: string;
  projectName: string;
  prompt: string;
  repoRoot: string;
};

export function createDecomposeStub(
  result = makeDeterministicPlan(),
): {
  decompose: (rfcContent: string, repoConfig: RepoConfig) => Promise<typeof result>;
  calls: DecomposeCall[];
} {
  const calls: DecomposeCall[] = [];
  return {
    decompose: async (rfcContent: string, repoConfig: RepoConfig) => {
      calls.push({ rfcContent, repoConfig });
      return result;
    },
    calls,
  };
}

export function createLaunchStub(
  exitCodes: number[] = [0],
): {
  launch: (opts: LaunchCall) => Promise<number>;
  calls: LaunchCall[];
} {
  let index = 0;
  const calls: LaunchCall[] = [];

  return {
    launch: async (opts: LaunchCall) => {
      calls.push(opts);
      const fallback = exitCodes.length > 0 ? exitCodes[exitCodes.length - 1] : 0;
      const code = exitCodes[index] ?? fallback;
      index += 1;
      return code;
    },
    calls,
  };
}

export function createPromptStub(
  choices: number[],
): {
  prompt: (message: string, options: string[]) => Promise<number>;
  calls: PromptCall[];
} {
  let index = 0;
  const calls: PromptCall[] = [];

  return {
    prompt: async (message: string, options: string[]) => {
      calls.push({ message, options });
      const fallback = choices.length > 0 ? choices[choices.length - 1] : 0;
      const choice = choices[index] ?? fallback;
      index += 1;
      return choice;
    },
    calls,
  };
}

export function createAgentDetectionStub(
  result: { claude: boolean; codex: boolean; gh: boolean },
): {
  detectAgents: (repoRoot: string) => Promise<typeof result>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    detectAgents: async (repoRoot: string) => {
      calls.push(repoRoot);
      return result;
    },
    calls,
  };
}

export function createMonitorLaunchStub(
  exitCodes: number[] = [0],
): {
  launchMonitor: (opts: MonitorLaunchCall) => Promise<number>;
  calls: MonitorLaunchCall[];
} {
  let index = 0;
  const calls: MonitorLaunchCall[] = [];

  return {
    launchMonitor: async (opts: MonitorLaunchCall) => {
      calls.push(opts);
      const fallback = exitCodes.length > 0 ? exitCodes[exitCodes.length - 1] : 0;
      const code = exitCodes[index] ?? fallback;
      index += 1;
      return code;
    },
    calls,
  };
}

export class ProcessExitError extends Error {
  readonly code: number;

  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

export function createExitStub(): {
  exit: (code: number) => never;
  calls: number[];
} {
  const calls: number[] = [];
  return {
    exit: (code: number): never => {
      calls.push(code);
      throw new ProcessExitError(code);
    },
    calls,
  };
}

export async function expectProcessExit(
  promise: Promise<unknown>,
  expectedCode: number,
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected process.exit(${expectedCode}) to be called`);
  } catch (error) {
    if (error instanceof ProcessExitError) {
      expect(error.code).toBe(expectedCode);
      return;
    }
    throw error;
  }
}

export function expectEvent(
  events: AgentixEvent[],
  eventName: string,
): AgentixEvent {
  const event = events.find((entry) => entry.event === eventName);
  expect(event).toBeDefined();
  return event as AgentixEvent;
}
