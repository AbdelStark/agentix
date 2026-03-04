export type DashboardPagination = {
  limit: number;
  offset: number;
};

export type DashboardListMeta = {
  limit: number;
  offset: number;
  total: number;
  warnings: string[];
};

export type DashboardListResponse<T> = {
  items: T[];
  meta: DashboardListMeta;
};

export type DashboardRunSnapshot = {
  runId: string;
  workflowName: string;
  workflowPath: string | null;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: unknown;
  config: unknown;
};

export type DashboardNodeSnapshot = {
  runId: string;
  nodeId: string;
  iteration: number;
  state: string;
  lastAttempt: number | null;
  updatedAt: string;
  outputTable: string;
  label: string | null;
};

export type DashboardAttemptSnapshot = {
  runId: string;
  nodeId: string;
  iteration: number;
  attempt: number;
  state: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  cached: boolean;
  jjPointer: string | null;
  jjCwd: string | null;
  responseText: string | null;
  error: unknown;
  meta: Record<string, unknown> | null;
};

export type DashboardNodeEventSnapshot = {
  runId: string;
  seq: number;
  timestampMs: number;
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
};

export type DashboardNodeLogSnapshot = {
  runId: string;
  seq: number;
  timestampMs: number;
  timestamp: string;
  nodeId: string;
  iteration: number;
  attempt: number | null;
  stream: "stdout" | "stderr";
  text: string;
};

export type DashboardStageOutputSnapshot = {
  table: string;
  runId: string;
  nodeId: string;
  iteration: number;
  row: Record<string, unknown>;
};

export type DashboardCommandEventSnapshot = {
  line: number;
  timestampMs: number;
  timestamp: string;
  schemaVersion: number;
  level: string;
  event: string;
  command: string;
  runId: string | null;
  sessionId: string | null;
  unitId: string | null;
  details: Record<string, unknown>;
};

export type DashboardMergeRiskSnapshot = {
  runId: string;
  nodeId: string;
  iteration: number;
  summary: string | null;
  riskSnapshot: Record<string, unknown> | null;
  ticketsLanded: Array<Record<string, unknown>>;
  ticketsEvicted: Array<Record<string, unknown>>;
  ticketsSkipped: Array<Record<string, unknown>>;
};

export type DashboardTraceArtifact = {
  unitId: string;
  path: string;
  generatedAt: string | null;
  traceCompleteness: boolean | null;
  scenariosTotal: number;
  scenariosCovered: number;
  uncoveredScenarios: string[];
  antiSlopFlags: string[];
  payload: Record<string, unknown>;
};

export type DashboardAnalyticsSnapshot = {
  date: string;
  path: string;
  generatedAt: string;
  payload: Record<string, unknown>;
};

export type DashboardAgentToolEvent = {
  runId: string;
  nodeId: string | null;
  iteration: number | null;
  attempt: number | null;
  timestampMs: number;
  timestamp: string;
  provider: "codex" | "claude";
  eventType: string;
  eventKey: string;
  toolName: string | null;
  tokenUsage: {
    input: number | null;
    output: number | null;
    total: number | null;
  };
  payload: Record<string, unknown>;
};

export type DashboardPromptAuditSnapshot = {
  runId: string;
  nodeId: string;
  unitId: string | null;
  stage: string | null;
  iteration: number;
  attempt: number;
  state: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  timestampMs: number;
  timestamp: string;
  promptText: string;
  promptPreview: string;
  promptHash: string | null;
  responseChars: number;
  responsePreview: string;
};

export type DashboardExecutionStepSnapshot = {
  runId: string;
  nodeId: string;
  unitId: string | null;
  stage: string | null;
  iteration: number;
  attempt: number;
  state: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  timestampMs: number;
  timestamp: string;
  promptAvailable: boolean;
  promptPreview: string;
  promptHash: string | null;
  responseChars: number;
  cached: boolean;
  errorMessage: string | null;
};

export type DashboardTimelineSource =
  | "smithers"
  | "agentix"
  | "telemetry"
  | "resource";

export type DashboardTimelineCategory =
  | "node"
  | "command"
  | "tool"
  | "resource";

export type DashboardTimelineEvent = {
  runId: string;
  nodeId: string | null;
  iteration: number | null;
  attempt: number | null;
  timestampMs: number;
  timestamp: string;
  source: DashboardTimelineSource;
  category: DashboardTimelineCategory;
  eventType: string;
  eventKey: string;
  summary: string;
  payload: Record<string, unknown>;
};

export type DashboardResourceSample = {
  runId: string;
  nodeId: string | null;
  timestampMs: number;
  timestamp: string;
  cpuPercent: number | null;
  memoryRssMb: number | null;
  metadata: Record<string, unknown>;
};

export type DashboardEventEnvelope = {
  seq: number;
  runId: string | null;
  source: "smithers" | "agentix" | "telemetry";
  type: string;
  timestampMs: number;
  timestamp: string;
  eventKey: string;
  payload: Record<string, unknown>;
};

export type DashboardLiveEvent = DashboardEventEnvelope | {
  type: "heartbeat";
  cursor: string;
  timestamp: string;
};

export type DashboardReadModelSourceStatus = {
  repoRoot: string;
  agentixDir: string;
  workflowDbPath: string;
  eventsPath: string;
  workPlanPath: string;
  tracesDir: string;
  analyticsDir: string;
  telemetryDir: string;
  resourceSamplesPath: string;
};

export type DashboardWorkUnit = {
  id: string;
  name: string;
  tier: string;
  priority: string;
  deps: string[];
  boundedContext: string;
  acceptance: string[];
};

export type DashboardWorkPlan = {
  source: string;
  generatedAt: string;
  units: DashboardWorkUnit[];
};
