export type GateState = "pass" | "fail" | "unknown";

export type GateEntry = {
  key: string;
  label: string;
  state: GateState;
  reason: string;
  actionTarget: "attempts" | "readiness" | "analytics" | null;
  evidence: string[];
};

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function evaluateGateBoard(opts: {
  stageOutputs: Array<{ table: string; row: Record<string, unknown> }>;
  traces: Array<{
    traceCompleteness: boolean | null;
    scenariosTotal: number;
    scenariosCovered: number;
    uncoveredScenarios: string[];
    antiSlopFlags?: string[];
  }>;
}): GateEntry[] {
  const stageOutputs = opts.stageOutputs ?? [];
  const traces = opts.traces ?? [];

  const latestByTable = new Map<string, Record<string, unknown>>();
  for (const output of stageOutputs) {
    if (!latestByTable.has(output.table)) {
      latestByTable.set(output.table, output.row);
    }
  }

  const testRow = latestByTable.get("test") ?? null;
  const finalReview = latestByTable.get("final_review") ?? null;

  const testsPassed = asBoolean(testRow?.tests_passed ?? testRow?.testsPassed);
  const buildPassed = asBoolean(testRow?.build_passed ?? testRow?.buildPassed);
  const scenariosTotal =
    asNumber(testRow?.scenarios_total ?? testRow?.scenariosTotal) ?? 0;
  const scenariosCovered =
    asNumber(testRow?.scenarios_covered ?? testRow?.scenariosCovered) ?? 0;
  const uncoveredScenarios = Array.isArray(
    testRow?.uncovered_scenarios ?? testRow?.uncoveredScenarios,
  )
    ? (testRow?.uncovered_scenarios ?? testRow?.uncoveredScenarios) as string[]
    : [];

  const aggregateTrace = traces.reduce(
    (acc, trace) => {
      acc.total += trace.scenariosTotal ?? 0;
      acc.covered += trace.scenariosCovered ?? 0;
      acc.uncovered.push(...(trace.uncoveredScenarios ?? []));
      acc.antiSlop.push(...(trace.antiSlopFlags ?? []));
      if (trace.traceCompleteness === false) {
        acc.traceIncomplete = true;
      }
      return acc;
    },
    {
      total: 0,
      covered: 0,
      uncovered: [] as string[],
      antiSlop: [] as string[],
      traceIncomplete: false,
    },
  );

  const gateEntries: GateEntry[] = [];

  gateEntries.push({
    key: "build",
    label: "Build",
    state: buildPassed == null ? "unknown" : buildPassed ? "pass" : "fail",
    reason:
      buildPassed == null
        ? "No build evidence"
        : buildPassed
          ? "Build passed"
          : "Build failed",
    actionTarget: buildPassed === false ? "attempts" : null,
    evidence: [],
  });

  gateEntries.push({
    key: "tests",
    label: "Tests",
    state: testsPassed == null ? "unknown" : testsPassed ? "pass" : "fail",
    reason:
      testsPassed == null
        ? "No test evidence"
        : testsPassed
          ? "Tests passed"
          : "Tests failed",
    actionTarget: testsPassed === false ? "attempts" : null,
    evidence: [],
  });

  const scenarioPass =
    scenariosTotal > 0 && scenariosCovered >= scenariosTotal && uncoveredScenarios.length === 0;
  gateEntries.push({
    key: "scenarios",
    label: "Scenarios",
    state: scenarioPass ? "pass" : scenariosTotal === 0 ? "unknown" : "fail",
    reason: scenarioPass
      ? `Covered ${scenariosCovered}/${scenariosTotal}`
      : `Coverage ${scenariosCovered}/${scenariosTotal}; uncovered ${uncoveredScenarios.length}`,
    actionTarget: scenarioPass ? null : "attempts",
    evidence: uncoveredScenarios.slice(0, 12),
  });

  const antiSlopFlags = aggregateTrace.antiSlop.filter((flag) => Boolean(flag));
  const tracePass = !aggregateTrace.traceIncomplete && antiSlopFlags.length === 0;
  gateEntries.push({
    key: "trace",
    label: "Trace Completeness",
    state: tracePass ? "pass" : "fail",
    reason: aggregateTrace.traceIncomplete
      ? "At least one trace artifact is incomplete"
      : antiSlopFlags.length > 0
        ? `Trace anti-slop blocked (${antiSlopFlags.length} flags)`
        : `Traces covered ${aggregateTrace.covered}/${aggregateTrace.total}`,
    actionTarget: tracePass ? null : "attempts",
    evidence: antiSlopFlags.slice(0, 12),
  });

  const finalReady = asBoolean(finalReview?.ready_to_move_on ?? finalReview?.readyToMoveOn);
  gateEntries.push({
    key: "final-review",
    label: "Final Review",
    state: finalReady == null ? "unknown" : finalReady ? "pass" : "fail",
    reason:
      finalReady == null
        ? "No final review output"
        : finalReady
          ? "Final review approved"
          : "Final review blocked",
    actionTarget: finalReady === false ? "attempts" : null,
    evidence: [],
  });

  return gateEntries;
}
