export type TraceSummary = {
  totalUnits: number;
  completeUnits: number;
  incompleteUnits: number;
  uncoveredScenarios: string[];
  antiSlopFlags: string[];
};

export function summarizeTraceArtifacts(
  traces: Array<{
    traceCompleteness: boolean | null;
    uncoveredScenarios: string[];
    antiSlopFlags: string[];
  }>,
): TraceSummary {
  const totalUnits = traces.length;
  let completeUnits = 0;
  const uncovered = new Set<string>();
  const antiSlop = new Set<string>();

  for (const trace of traces) {
    if (trace.traceCompleteness === true) {
      completeUnits += 1;
    }
    for (const scenario of trace.uncoveredScenarios ?? []) {
      uncovered.add(scenario);
    }
    for (const flag of trace.antiSlopFlags ?? []) {
      antiSlop.add(flag);
    }
  }

  return {
    totalUnits,
    completeUnits,
    incompleteUnits: Math.max(0, totalUnits - completeUnits),
    uncoveredScenarios: [...uncovered].sort((a, b) => a.localeCompare(b)),
    antiSlopFlags: [...antiSlop].sort((a, b) => a.localeCompare(b)),
  };
}
