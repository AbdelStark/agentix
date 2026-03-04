import { describe, expect, test } from "bun:test";

import {
  buildSelectedUnitTimeline,
  computeRunHealthSummary,
  deriveSelectedUnitGateReason,
  summarizeSelectedUnitChanges,
} from "./selectors";

describe("run cockpit selectors", () => {
  test("computes deterministic health summary and blocking nodes", () => {
    const summary = computeRunHealthSummary({
      nodes: [
        { nodeId: "unit-a:implement", state: "finished" },
        { nodeId: "unit-b:test", state: "in-progress" },
        { nodeId: "unit-c:review", state: "failed" },
      ],
      attempts: [
        { nodeId: "unit-a:implement", state: "finished" },
        { nodeId: "unit-b:test", state: "in-progress" },
        { nodeId: "unit-c:review", state: "failed" },
      ],
    });

    expect(summary.totalNodes).toBe(3);
    expect(summary.runningNodes).toBe(1);
    expect(summary.failedNodes).toBe(1);
    expect(summary.finishedNodes).toBe(1);
    expect(summary.inFlightAttempts).toBe(1);
    expect(summary.failedAttempts).toBe(1);
    expect(summary.passRate).toBe(0.5);
    expect(summary.blockingNodes).toEqual(["unit-c:review"]);
  });

  test("builds selected unit stage timeline ordered by attempt chronology", () => {
    const timeline = buildSelectedUnitTimeline({
      selectedUnitId: "obs-04",
      attempts: [
        {
          nodeId: "obs-04:implement",
          iteration: 0,
          attempt: 2,
          state: "finished",
          startedAt: "2026-03-03T10:00:10.000Z",
          durationMs: 9_000,
        },
        {
          nodeId: "obs-04:implement",
          iteration: 0,
          attempt: 1,
          state: "failed",
          startedAt: "2026-03-03T10:00:00.000Z",
          durationMs: 5_000,
        },
        {
          nodeId: "obs-06:test",
          iteration: 0,
          attempt: 1,
          state: "finished",
          startedAt: "2026-03-03T10:00:20.000Z",
          durationMs: 4_000,
        },
      ],
    });

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({
      nodeId: "obs-04:implement",
      attempt: 1,
      state: "failed",
    });
    expect(timeline[1]).toMatchObject({
      nodeId: "obs-04:implement",
      attempt: 2,
      state: "finished",
    });
  });

  test("derives selected unit gate blocker from stage outputs and traces", () => {
    const gate = deriveSelectedUnitGateReason({
      selectedUnitId: "obs-06",
      stageOutputs: [
        {
          table: "test",
          nodeId: "obs-06:test",
          row: {
            scenarios_total: 3,
            scenarios_covered: 2,
            uncovered_scenarios: ["obs06-s1"],
          },
        },
      ],
      traces: [
        {
          unitId: "obs-06",
          traceCompleteness: false,
          uncoveredScenarios: ["obs06-s1"],
          antiSlopFlags: ["weak-assertions"],
        },
      ],
    });

    expect(gate.state).toBe("fail");
    expect(gate.reason).toContain("obs06-s1");
  });

  test("summarizes selected unit stage output diffs by table and iteration", () => {
    const changes = summarizeSelectedUnitChanges({
      selectedUnitId: "obs-04",
      stageOutputs: [
        {
          table: "implement",
          nodeId: "obs-04:implement",
          iteration: 2,
          row: {
            node_id: "obs-04:implement",
            iteration: 2,
            filesModified: ["a.ts", "b.ts"],
            whatWasDone: "patched api",
          },
        },
        {
          table: "implement",
          nodeId: "obs-04:implement",
          iteration: 1,
          row: {
            node_id: "obs-04:implement",
            iteration: 1,
            filesModified: ["a.ts"],
            whatWasDone: "created api",
          },
        },
      ],
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      table: "implement",
      nodeId: "obs-04:implement",
      iteration: 2,
    });
    expect(changes[0]?.changedFields).toEqual(["filesModified", "whatWasDone"]);
  });
});
