export type RunHealthSummary = {
  totalNodes: number;
  runningNodes: number;
  failedNodes: number;
  finishedNodes: number;
  inFlightAttempts: number;
  failedAttempts: number;
  passRate: number;
  blockingNodes: string[];
};

export type SelectedUnitTimelineEntry = {
  nodeId: string;
  iteration: number;
  attempt: number;
  state: string;
  startedAt: string | null;
  durationMs: number | null;
};

export type SelectedUnitGateReason = {
  state: "pass" | "fail" | "unknown";
  reason: string;
};

export type SelectedUnitChangeSummary = {
  table: string;
  nodeId: string;
  iteration: number;
  changedFields: string[];
};

function normalizeState(state: unknown): string {
  return String(state ?? "").toLowerCase();
}

export function computeRunHealthSummary(opts: {
  nodes: Array<{ nodeId: string; state: string }>;
  attempts: Array<{ nodeId: string; state: string }>;
}): RunHealthSummary {
  const nodes = opts.nodes ?? [];
  const attempts = opts.attempts ?? [];

  const runningNodes = nodes.filter((node) => normalizeState(node.state) === "in-progress").length;
  const failedNodes = nodes.filter((node) => normalizeState(node.state) === "failed").length;
  const finishedNodes = nodes.filter((node) => normalizeState(node.state) === "finished").length;

  const inFlightAttempts = attempts.filter(
    (attempt) => normalizeState(attempt.state) === "in-progress",
  ).length;
  const failedAttempts = attempts.filter(
    (attempt) => normalizeState(attempt.state) === "failed",
  ).length;

  const terminalAttempts = attempts.filter((attempt) => {
    const state = normalizeState(attempt.state);
    return state === "finished" || state === "failed";
  });

  const passedAttempts = terminalAttempts.filter(
    (attempt) => normalizeState(attempt.state) === "finished",
  ).length;

  const passRate = terminalAttempts.length
    ? Number((passedAttempts / terminalAttempts.length).toFixed(4))
    : 0;

  const blockingNodes = nodes
    .filter((node) => {
      const state = normalizeState(node.state);
      return state === "failed" || state === "blocked";
    })
    .map((node) => node.nodeId)
    .sort((a, b) => a.localeCompare(b));

  return {
    totalNodes: nodes.length,
    runningNodes,
    failedNodes,
    finishedNodes,
    inFlightAttempts,
    failedAttempts,
    passRate,
    blockingNodes,
  };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (entry == null ? "" : String(entry)))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function buildSelectedUnitTimeline(opts: {
  selectedUnitId: string | null;
  attempts: Array<{
    nodeId: string;
    iteration: number;
    attempt: number;
    state: string;
    startedAt: string | null;
    durationMs: number | null;
  }>;
}): SelectedUnitTimelineEntry[] {
  const selectedUnitId = opts.selectedUnitId?.trim();
  if (!selectedUnitId) return [];

  const rows = (opts.attempts ?? [])
    .filter((attempt) => String(attempt.nodeId ?? "").startsWith(`${selectedUnitId}:`))
    .map((attempt) => ({
      nodeId: String(attempt.nodeId ?? ""),
      iteration: toNumber(attempt.iteration) ?? 0,
      attempt: toNumber(attempt.attempt) ?? 0,
      state: String(attempt.state ?? "unknown"),
      startedAt: attempt.startedAt == null ? null : String(attempt.startedAt),
      durationMs: toNumber(attempt.durationMs),
    }));

  rows.sort((a, b) => {
    const aTs = a.startedAt ? Date.parse(a.startedAt) : 0;
    const bTs = b.startedAt ? Date.parse(b.startedAt) : 0;
    if (aTs !== bTs) return aTs - bTs;
    if (a.iteration !== b.iteration) return a.iteration - b.iteration;
    return a.attempt - b.attempt;
  });

  return rows;
}

export function deriveSelectedUnitGateReason(opts: {
  selectedUnitId: string | null;
  stageOutputs: Array<{
    table: string;
    nodeId?: string;
    row: Record<string, unknown>;
  }>;
  traces: Array<{
    unitId: string;
    traceCompleteness: boolean | null;
    uncoveredScenarios: string[];
    antiSlopFlags: string[];
  }>;
}): SelectedUnitGateReason {
  const selectedUnitId = opts.selectedUnitId?.trim();
  if (!selectedUnitId) {
    return {
      state: "unknown",
      reason: "Select a unit to inspect gate decisions.",
    };
  }

  const unitStageRows = (opts.stageOutputs ?? []).filter((entry) => {
    if (typeof entry.nodeId === "string" && entry.nodeId.startsWith(`${selectedUnitId}:`)) {
      return true;
    }
    const rowNodeId = entry.row.node_id;
    return typeof rowNodeId === "string" && rowNodeId.startsWith(`${selectedUnitId}:`);
  });

  const latestTestRow = unitStageRows.find((entry) => entry.table === "test")?.row ?? null;
  if (latestTestRow) {
    const total = toNumber(latestTestRow.scenarios_total ?? latestTestRow.scenariosTotal) ?? 0;
    const covered = toNumber(
      latestTestRow.scenarios_covered ?? latestTestRow.scenariosCovered,
    ) ?? 0;
    const uncovered = toStringList(
      latestTestRow.uncovered_scenarios ?? latestTestRow.uncoveredScenarios,
    );
    if (total > 0 && (covered < total || uncovered.length > 0)) {
      return {
        state: "fail",
        reason: `Scenario coverage blocked (${covered}/${total}) • ${uncovered.slice(0, 3).join(", ")}`,
      };
    }
  }

  const unitTrace = (opts.traces ?? []).find((trace) => trace.unitId === selectedUnitId);
  if (unitTrace) {
    if (unitTrace.traceCompleteness === false) {
      return {
        state: "fail",
        reason: `Trace incomplete • ${unitTrace.uncoveredScenarios.slice(0, 3).join(", ")}`,
      };
    }
    if ((unitTrace.antiSlopFlags ?? []).length > 0) {
      return {
        state: "fail",
        reason: `Anti-slop flags present • ${unitTrace.antiSlopFlags.slice(0, 2).join(", ")}`,
      };
    }
  }

  const finalReview = unitStageRows.find((entry) => entry.table === "final_review")?.row ?? null;
  if (finalReview) {
    const ready = finalReview.ready_to_move_on ?? finalReview.readyToMoveOn;
    if (ready === false || ready === "false" || ready === 0) {
      const reasoning = finalReview.reasoning == null
        ? "Final review blocked."
        : String(finalReview.reasoning);
      return {
        state: "fail",
        reason: reasoning,
      };
    }
  }

  if (unitStageRows.length === 0 && !unitTrace) {
    return {
      state: "unknown",
      reason: "No gate evidence found for selected unit yet.",
    };
  }

  return {
    state: "pass",
    reason: "Latest gate evidence is green for this unit.",
  };
}

function stableStringify(value: unknown): string {
  if (value == null) return "null";
  if (typeof value !== "object") return String(value);
  try {
    return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
  } catch {
    return String(value);
  }
}

export function summarizeSelectedUnitChanges(opts: {
  selectedUnitId: string | null;
  stageOutputs: Array<{
    table: string;
    nodeId?: string;
    iteration?: number;
    row: Record<string, unknown>;
  }>;
}): SelectedUnitChangeSummary[] {
  const selectedUnitId = opts.selectedUnitId?.trim();
  if (!selectedUnitId) return [];

  const filtered = (opts.stageOutputs ?? []).filter((entry) => {
    if (typeof entry.nodeId === "string" && entry.nodeId.startsWith(`${selectedUnitId}:`)) {
      return true;
    }
    const rowNodeId = entry.row.node_id;
    return typeof rowNodeId === "string" && rowNodeId.startsWith(`${selectedUnitId}:`);
  });

  const grouped = new Map<string, Array<{
    table: string;
    nodeId: string;
    iteration: number;
    row: Record<string, unknown>;
  }>>();

  for (const entry of filtered) {
    const table = String(entry.table ?? "");
    const nodeId =
      typeof entry.nodeId === "string"
        ? entry.nodeId
        : typeof entry.row.node_id === "string"
          ? entry.row.node_id
          : "";
    const iteration = toNumber(entry.iteration ?? entry.row.iteration) ?? 0;
    const key = `${table}::${nodeId}`;
    const rows = grouped.get(key) ?? [];
    rows.push({ table, nodeId, iteration, row: entry.row });
    grouped.set(key, rows);
  }

  const summaries: SelectedUnitChangeSummary[] = [];
  const ignoredKeys = new Set([
    "run_id",
    "node_id",
    "nodeId",
    "iteration",
    "attempt",
    "created_at",
    "createdAt",
    "updated_at",
    "updatedAt",
  ]);

  for (const rows of grouped.values()) {
    rows.sort((a, b) => b.iteration - a.iteration);
    const latest = rows[0];
    const previous = rows[1];
    if (!latest) continue;

    if (!previous) {
      summaries.push({
        table: latest.table,
        nodeId: latest.nodeId,
        iteration: latest.iteration,
        changedFields: ["initial-stage-output"],
      });
      continue;
    }

    const keys = new Set([
      ...Object.keys(latest.row ?? {}),
      ...Object.keys(previous.row ?? {}),
    ]);

    const changedFields = [...keys]
      .filter((key) => !ignoredKeys.has(key))
      .filter((key) => stableStringify(latest.row[key]) !== stableStringify(previous.row[key]))
      .sort((a, b) => a.localeCompare(b));

    summaries.push({
      table: latest.table,
      nodeId: latest.nodeId,
      iteration: latest.iteration,
      changedFields: changedFields.length > 0 ? changedFields : ["no-material-change"],
    });
  }

  summaries.sort((a, b) => {
    if (a.iteration !== b.iteration) return b.iteration - a.iteration;
    if (a.table !== b.table) return a.table.localeCompare(b.table);
    return a.nodeId.localeCompare(b.nodeId);
  });

  return summaries;
}
