type UnknownRecord = Record<string, unknown>;

export type StepBoardState =
  | "in-progress"
  | "pending"
  | "failed"
  | "blocked"
  | "completed"
  | "unknown";

export type StepBoardFilter = "all" | StepBoardState;

export type StepBoardSort =
  | "newest"
  | "failing-first"
  | "pending-first"
  | "longest-running";

export type StepBoardRow = {
  unitId: string;
  stage: string;
  nodeId: string;
  state: StepBoardState;
  attempt: number;
  durationMs: number | null;
  startedAtMs: number | null;
  lastUpdateMs: number;
  lastUpdate: string;
  source: "execution" | "node" | "live";
  errorMessage?: string | null;
  promptAvailable?: boolean;
};

export type StepBoardFilterState = {
  state: StepBoardFilter;
  query: string;
};

export type TimelineSeverity = "critical" | "high" | "medium" | "low";

export type TimelineStatus =
  | "failed"
  | "blocked"
  | "retry"
  | "started"
  | "finished"
  | "running"
  | "info";

export type TimelineDomain = "system" | "tool" | "resource";

export type TimelineFilterState = {
  criticalOnly: boolean;
  failuresOnly: boolean;
  systemEvents: boolean;
  toolEvents: boolean;
  resourceAnomalies: boolean;
  query: string;
};

export type TimelineRow = {
  source: string;
  category: string;
  domain: TimelineDomain;
  eventType: string;
  eventKey: string;
  summary: string;
  timestamp: string;
  timestampMs: number;
  absoluteTime: string;
  relativeTime: string;
  nodeId: string | null;
  attempt: number | null;
  unitId: string | null;
  stage: string | null;
  severity: TimelineSeverity;
  status: TimelineStatus;
  critical: boolean;
  failure: boolean;
  isResourceAnomaly: boolean;
  payload: UnknownRecord;
};

export type LatestNavigationTargets = {
  latestFailed: StepBoardRow | null;
  latestPending: StepBoardRow | null;
  latestInProgress: StepBoardRow | null;
};

export type RunPulseSummary = {
  runStatus: string;
  latestStep: StepBoardRow | null;
  inProgressCount: number;
  pendingCount: number;
  failedCount: number;
  blockedCount: number;
  completedCount: number;
  lastCriticalEvent: TimelineRow | null;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toTimestampMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function splitNodeId(nodeId: string | null | undefined): { unitId: string; stage: string } {
  const normalized = normalizeText(nodeId);
  const index = normalized.indexOf(":");
  if (index <= 0) {
    return {
      unitId: normalized || "-",
      stage: "unknown",
    };
  }
  return {
    unitId: normalized.slice(0, index) || "-",
    stage: normalized.slice(index + 1) || "unknown",
  };
}

export function normalizeStepState(value: unknown): StepBoardState {
  const state = normalizeText(value).toLowerCase();
  if (
    state === "in-progress" ||
    state === "running" ||
    state === "active" ||
    state === "started"
  ) {
    return "in-progress";
  }
  if (state === "pending" || state === "queued" || state === "ready") {
    return "pending";
  }
  if (state === "failed" || state === "error") {
    return "failed";
  }
  if (state === "blocked" || state === "evicted") {
    return "blocked";
  }
  if (
    state === "finished" ||
    state === "completed" ||
    state === "pass" ||
    state === "passed" ||
    state === "success"
  ) {
    return "completed";
  }
  return "unknown";
}

function normalizeLiveEventState(eventType: string): StepBoardState | null {
  const normalized = eventType.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("fail") || normalized.includes("error")) return "failed";
  if (normalized.includes("block") || normalized.includes("evict")) return "blocked";
  if (normalized.includes("retry")) return "pending";
  if (normalized.includes("start") || normalized.includes("running")) return "in-progress";
  if (normalized.includes("finish") || normalized.includes("complete")) return "completed";
  return null;
}

function compareStepFreshness(left: StepBoardRow, right: StepBoardRow): number {
  if (left.lastUpdateMs !== right.lastUpdateMs) {
    return right.lastUpdateMs - left.lastUpdateMs;
  }
  if (left.attempt !== right.attempt) {
    return right.attempt - left.attempt;
  }
  return left.nodeId.localeCompare(right.nodeId);
}

function ensureDuration(row: StepBoardRow, nowMs: number): StepBoardRow {
  if (row.state !== "in-progress") return row;
  if (row.startedAtMs && row.startedAtMs > 0) {
    return {
      ...row,
      durationMs: Math.max(0, nowMs - row.startedAtMs),
    };
  }
  return row;
}

type StepLike = {
  unitId?: unknown;
  stage?: unknown;
  nodeId?: unknown;
  attempt?: unknown;
  state?: unknown;
  durationMs?: unknown;
  startedAt?: unknown;
  timestamp?: unknown;
  errorMessage?: unknown;
  promptAvailable?: unknown;
};

type NodeLike = {
  nodeId?: unknown;
  state?: unknown;
  lastAttempt?: unknown;
  updatedAt?: unknown;
};

type LiveEventLike = {
  type?: unknown;
  timestamp?: unknown;
  timestampMs?: unknown;
  payload?: unknown;
};

function getLiveEventPayload(event: LiveEventLike): UnknownRecord {
  return event.payload && typeof event.payload === "object"
    ? (event.payload as UnknownRecord)
    : {};
}

function readLiveEventNodeId(event: LiveEventLike): string | null {
  const payload = getLiveEventPayload(event);
  const candidate =
    payload.nodeId ??
    payload.node_id ??
    payload.stepNodeId ??
    null;
  const normalized = normalizeText(candidate);
  return normalized || null;
}

function readLiveEventAttempt(event: LiveEventLike): number | null {
  const payload = getLiveEventPayload(event);
  return toNumber(payload.attempt ?? payload.attemptNumber);
}

export function deriveStepBoardRows(
  input: {
    nodes?: NodeLike[];
    executionSteps?: StepLike[];
    liveEvents?: LiveEventLike[];
  },
  opts: { nowMs?: number } = {},
): StepBoardRow[] {
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  const byNode = new Map<string, StepBoardRow>();

  const commitRow = (candidate: StepBoardRow) => {
    const existing = byNode.get(candidate.nodeId);
    if (!existing) {
      byNode.set(candidate.nodeId, candidate);
      return;
    }
    const candidateIsFresher =
      candidate.lastUpdateMs > existing.lastUpdateMs ||
      (candidate.lastUpdateMs === existing.lastUpdateMs && candidate.attempt >= existing.attempt);
    byNode.set(candidate.nodeId, candidateIsFresher ? candidate : existing);
  };

  for (const step of input.executionSteps ?? []) {
    const nodeId = normalizeText(step.nodeId);
    if (!nodeId) continue;
    const parsed = splitNodeId(nodeId);
    const timestampMs = toTimestampMs(step.timestamp);
    const startedAtMs = toTimestampMs(step.startedAt) || null;
    const row: StepBoardRow = {
      unitId: normalizeText(step.unitId) || parsed.unitId,
      stage: normalizeText(step.stage) || parsed.stage,
      nodeId,
      state: normalizeStepState(step.state),
      attempt: Math.max(0, toNumber(step.attempt) ?? 0),
      durationMs: toNumber(step.durationMs),
      startedAtMs,
      lastUpdateMs: timestampMs || startedAtMs || 0,
      lastUpdate: (timestampMs ? new Date(timestampMs) : new Date(0)).toISOString(),
      source: "execution",
      errorMessage: normalizeText(step.errorMessage) || null,
      promptAvailable: step.promptAvailable === true,
    };
    commitRow(ensureDuration(row, nowMs));
  }

  for (const node of input.nodes ?? []) {
    const nodeId = normalizeText(node.nodeId);
    if (!nodeId) continue;
    const parsed = splitNodeId(nodeId);
    const timestampMs = toTimestampMs(node.updatedAt);
    const row: StepBoardRow = {
      unitId: parsed.unitId,
      stage: parsed.stage,
      nodeId,
      state: normalizeStepState(node.state),
      attempt: Math.max(0, toNumber(node.lastAttempt) ?? 0),
      durationMs: null,
      startedAtMs: null,
      lastUpdateMs: timestampMs,
      lastUpdate: (timestampMs ? new Date(timestampMs) : new Date(0)).toISOString(),
      source: "node",
    };
    commitRow(ensureDuration(row, nowMs));
  }

  for (const event of input.liveEvents ?? []) {
    const eventType = normalizeText(event.type);
    const nextState = normalizeLiveEventState(eventType);
    if (!nextState) continue;
    const nodeId = readLiveEventNodeId(event);
    if (!nodeId) continue;
    const payloadAttempt = readLiveEventAttempt(event);
    const existing = byNode.get(nodeId);
    const parsed = splitNodeId(nodeId);
    const timestampMs = toTimestampMs(event.timestampMs) || toTimestampMs(event.timestamp);
    const attempt = Math.max(0, payloadAttempt ?? existing?.attempt ?? 0);
    const startedAtMs =
      nextState === "in-progress"
        ? timestampMs || existing?.startedAtMs || null
        : existing?.startedAtMs ?? null;

    const row: StepBoardRow = {
      unitId: existing?.unitId ?? parsed.unitId,
      stage: existing?.stage ?? parsed.stage,
      nodeId,
      state: nextState,
      attempt,
      durationMs: existing?.durationMs ?? null,
      startedAtMs,
      lastUpdateMs: timestampMs || existing?.lastUpdateMs || 0,
      lastUpdate: (timestampMs ? new Date(timestampMs) : new Date(0)).toISOString(),
      source: "live",
      errorMessage: existing?.errorMessage ?? null,
      promptAvailable: existing?.promptAvailable ?? false,
    };
    commitRow(ensureDuration(row, nowMs));
  }

  return [...byNode.values()]
    .map((row) => ensureDuration(row, nowMs))
    .sort(compareStepFreshness);
}

export function filterStepBoardRows(
  rows: StepBoardRow[],
  filters: StepBoardFilterState,
): StepBoardRow[] {
  const query = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.state !== "all" && row.state !== filters.state) return false;
    if (!query) return true;
    const haystack = `${row.unitId} ${row.stage} ${row.nodeId} ${row.state}`.toLowerCase();
    return haystack.includes(query);
  });
}

function stateSortWeight(state: StepBoardState, sort: StepBoardSort): number {
  if (sort === "failing-first") {
    if (state === "failed") return 5;
    if (state === "blocked") return 4;
    if (state === "in-progress") return 3;
    if (state === "pending") return 2;
    if (state === "completed") return 1;
    return 0;
  }
  if (sort === "pending-first") {
    if (state === "pending") return 5;
    if (state === "blocked") return 4;
    if (state === "in-progress") return 3;
    if (state === "failed") return 2;
    if (state === "completed") return 1;
    return 0;
  }
  return 0;
}

function runningDuration(row: StepBoardRow, nowMs: number): number {
  if (row.state !== "in-progress") return -1;
  if (row.durationMs != null && Number.isFinite(row.durationMs)) {
    return Number(row.durationMs);
  }
  if (row.startedAtMs != null) {
    return Math.max(0, nowMs - row.startedAtMs);
  }
  return Math.max(0, nowMs - row.lastUpdateMs);
}

export function sortStepBoardRows(
  rows: StepBoardRow[],
  sort: StepBoardSort,
  opts: { nowMs?: number } = {},
): StepBoardRow[] {
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  return [...rows].sort((left, right) => {
    if (sort === "newest") return compareStepFreshness(left, right);

    if (sort === "longest-running") {
      const leftRunning = runningDuration(left, nowMs);
      const rightRunning = runningDuration(right, nowMs);
      if (leftRunning !== rightRunning) return rightRunning - leftRunning;
      return compareStepFreshness(left, right);
    }

    const leftWeight = stateSortWeight(left.state, sort);
    const rightWeight = stateSortWeight(right.state, sort);
    if (leftWeight !== rightWeight) return rightWeight - leftWeight;
    return compareStepFreshness(left, right);
  });
}

export function deriveLatestNavigationTargets(rows: StepBoardRow[]): LatestNavigationTargets {
  const newest = sortStepBoardRows(rows, "newest");
  return {
    latestFailed: newest.find((row) => row.state === "failed") ?? null,
    latestPending: newest.find((row) => row.state === "pending") ?? null,
    latestInProgress: newest.find((row) => row.state === "in-progress") ?? null,
  };
}

function classifyTimelineStatus(eventType: string, summary: string): TimelineStatus {
  const signal = `${eventType} ${summary}`.toLowerCase();
  if (signal.includes("fail") || signal.includes("error")) return "failed";
  if (signal.includes("block") || signal.includes("evict")) return "blocked";
  if (signal.includes("retry") || signal.includes("rerun")) return "retry";
  if (signal.includes("start")) return "started";
  if (
    signal.includes("finish") ||
    signal.includes("complete") ||
    signal.includes("success")
  ) {
    return "finished";
  }
  if (signal.includes("running") || signal.includes("heartbeat")) return "running";
  return "info";
}

function timelineDomain(source: string, category: string): TimelineDomain {
  if (source === "telemetry" || category === "tool") return "tool";
  if (source === "resource" || category === "resource") return "resource";
  return "system";
}

function isResourceAnomaly(payload: UnknownRecord): boolean {
  const cpu = toNumber(payload.cpuPercent);
  const memory = toNumber(payload.memoryRssMb);
  return (cpu != null && cpu >= 85) || (memory != null && memory >= 1400);
}

function classifyTimelineSeverity(
  row: Pick<TimelineRow, "status" | "eventType" | "summary" | "isResourceAnomaly">,
): TimelineSeverity {
  const signal = `${row.eventType} ${row.summary}`.toLowerCase();
  const isPolicyGateBlock =
    (signal.includes("policy") || signal.includes("gate")) && signal.includes("block");
  if (row.status === "failed" || row.status === "blocked" || isPolicyGateBlock) {
    return "critical";
  }
  if (row.status === "retry" || row.isResourceAnomaly) {
    return "high";
  }
  if (row.status === "started" || row.status === "finished" || row.status === "running") {
    return "medium";
  }
  return "low";
}

function relativeFromNow(timestampMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - timestampMs);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

type TimelineLike = {
  source?: unknown;
  category?: unknown;
  eventType?: unknown;
  type?: unknown;
  eventKey?: unknown;
  summary?: unknown;
  timestamp?: unknown;
  timestampMs?: unknown;
  nodeId?: unknown;
  attempt?: unknown;
  payload?: unknown;
  severity?: unknown;
  status?: unknown;
  critical?: unknown;
  failure?: unknown;
  isResourceAnomaly?: unknown;
  domain?: unknown;
};

function toTimelineRow(entry: TimelineLike, nowMs: number): TimelineRow {
  const source = normalizeText(entry.source) || "smithers";
  const category = normalizeText(entry.category) || "node";
  const eventType = normalizeText(entry.eventType ?? entry.type) || "unknown";
  const timestampMs = toTimestampMs(entry.timestampMs) || toTimestampMs(entry.timestamp);
  const timestamp = normalizeText(entry.timestamp) || new Date(timestampMs || 0).toISOString();
  const payload =
    entry.payload && typeof entry.payload === "object"
      ? (entry.payload as UnknownRecord)
      : {};
  const nodeId = normalizeText(entry.nodeId ?? payload.nodeId ?? payload.node_id) || null;
  const attempt = toNumber(entry.attempt ?? payload.attempt);
  const parsed = splitNodeId(nodeId);
  const summary = normalizeText(entry.summary) || eventType;
  const domain = timelineDomain(source, category);
  const resourceAnomaly = domain === "resource" ? isResourceAnomaly(payload) : false;
  const status = classifyTimelineStatus(eventType, summary);
  const severity = classifyTimelineSeverity({
    status,
    eventType,
    summary,
    isResourceAnomaly: resourceAnomaly,
  });
  const failure = status === "failed" || status === "blocked";
  const critical = severity === "critical";

  return {
    source,
    category,
    domain,
    eventType,
    eventKey: normalizeText(entry.eventKey) || `${source}:${eventType}:${timestampMs}`,
    summary,
    timestamp,
    timestampMs,
    absoluteTime: new Date(timestampMs || 0).toISOString(),
    relativeTime: relativeFromNow(timestampMs || 0, nowMs),
    nodeId,
    attempt,
    unitId: nodeId ? parsed.unitId : null,
    stage: nodeId ? parsed.stage : null,
    severity,
    status,
    critical,
    failure,
    isResourceAnomaly: resourceAnomaly,
    payload,
  };
}

function timelineSeverityWeight(value: TimelineSeverity): number {
  if (value === "critical") return 4;
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function timelineStatusWeight(value: TimelineStatus): number {
  if (value === "failed") return 6;
  if (value === "blocked") return 5;
  if (value === "retry") return 4;
  if (value === "started") return 3;
  if (value === "running") return 2;
  if (value === "finished") return 1;
  return 0;
}

function applyTimelineFilters(
  rows: TimelineRow[],
  filters: TimelineFilterState,
): TimelineRow[] {
  const query = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.criticalOnly && !row.critical) return false;
    if (filters.failuresOnly && !row.failure) return false;
    if (!filters.systemEvents && row.domain === "system") return false;
    if (!filters.toolEvents && row.domain === "tool") return false;
    if (filters.resourceAnomalies && !row.isResourceAnomaly) return false;
    if (!query) return true;
    const payload = JSON.stringify(row.payload);
    const haystack = `${row.eventType} ${row.summary} ${row.source} ${row.nodeId ?? ""} ${payload}`
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function deriveTimelineRows(
  events: TimelineLike[],
  filters: TimelineFilterState,
  opts: { nowMs?: number } = {},
): TimelineRow[] {
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  const rows = (events ?? []).map((entry) => toTimelineRow(entry, nowMs));
  const filtered = applyTimelineFilters(rows, filters);
  return filtered.sort((left, right) => {
    const severityDelta = timelineSeverityWeight(right.severity) - timelineSeverityWeight(left.severity);
    if (severityDelta !== 0) return severityDelta;
    const statusDelta = timelineStatusWeight(right.status) - timelineStatusWeight(left.status);
    if (statusDelta !== 0) return statusDelta;
    if (left.timestampMs !== right.timestampMs) return right.timestampMs - left.timestampMs;
    return right.eventKey.localeCompare(left.eventKey);
  });
}

export function deriveRunPulseSummary(input: {
  runStatus: string | null | undefined;
  stepRows: StepBoardRow[];
  timelineRows: TimelineRow[];
}): RunPulseSummary {
  const rows = input.stepRows ?? [];
  const timelineRows = input.timelineRows ?? [];
  const latest = sortStepBoardRows(rows, "newest")[0] ?? null;
  const counts = {
    inProgressCount: rows.filter((row) => row.state === "in-progress").length,
    pendingCount: rows.filter((row) => row.state === "pending").length,
    failedCount: rows.filter((row) => row.state === "failed").length,
    blockedCount: rows.filter((row) => row.state === "blocked").length,
    completedCount: rows.filter((row) => row.state === "completed").length,
  };
  const lastCriticalEvent =
    [...timelineRows]
      .filter((row) => row.critical)
      .sort((left, right) => right.timestampMs - left.timestampMs)[0] ?? null;

  return {
    runStatus: normalizeText(input.runStatus) || "no-run",
    latestStep: latest,
    ...counts,
    lastCriticalEvent,
  };
}
