import type { RepoConfig } from "./shared";
import type { WorkPlan, WorkUnit } from "../scheduled/types";

export type DecomposeResult = {
  plan: WorkPlan;
  layers: WorkUnit[][];
};

export type DecomposeAdapter = (
  rfcContent: string,
  repoConfig: RepoConfig,
) => Promise<DecomposeResult>;

export type AgentDetectionAdapter = (
  repoRoot: string,
) => Promise<{ claude: boolean; codex: boolean; gh: boolean }>;

export type LaunchRequest = {
  mode: "run" | "resume";
  workflowPath: string;
  repoRoot: string;
  runId: string;
  maxConcurrency: number;
  smithersCliPath: string;
};

export type LaunchAdapter = (opts: LaunchRequest) => Promise<number>;

export type PromptAdapter = (
  message: string,
  options: string[],
) => Promise<number>;

export type ExitAdapter = (code: number) => never;

export type RunIdAdapter = () => string;

export type LatestRunIdAdapter = (dbPath: string) => Promise<string | null>;

export type MonitorLaunchRequest = {
  dbPath: string;
  runId: string;
  projectName: string;
  prompt: string;
  repoRoot: string;
};

export type MonitorLaunchAdapter = (
  opts: MonitorLaunchRequest,
) => Promise<number>;
