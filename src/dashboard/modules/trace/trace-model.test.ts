import { describe, expect, test } from "bun:test";

import { summarizeTraceArtifacts } from "./trace-model";

describe("trace summary", () => {
  test("aggregates uncovered scenarios and anti-slop flags", () => {
    const summary = summarizeTraceArtifacts([
      {
        traceCompleteness: true,
        uncoveredScenarios: [],
        antiSlopFlags: ["weak-assertions"],
      },
      {
        traceCompleteness: false,
        uncoveredScenarios: ["obs06-s1", "obs06-s2"],
        antiSlopFlags: ["weak-assertions", "no-failure-path"],
      },
    ]);

    expect(summary.totalUnits).toBe(2);
    expect(summary.completeUnits).toBe(1);
    expect(summary.incompleteUnits).toBe(1);
    expect(summary.uncoveredScenarios).toEqual(["obs06-s1", "obs06-s2"]);
    expect(summary.antiSlopFlags).toEqual(["no-failure-path", "weak-assertions"]);
  });
});
