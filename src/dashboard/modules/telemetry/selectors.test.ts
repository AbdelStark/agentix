import { describe, expect, test } from "bun:test";

import {
  deriveLatestNavigationTargets,
  deriveRunPulseSummary,
  deriveStepBoardRows,
  deriveTimelineRows,
  filterStepBoardRows,
  sortStepBoardRows,
  type StepBoardRow,
  type TimelineFilterState,
} from "./selectors";

describe("telemetry selectors", () => {
  test("derives step board rows from execution steps, node snapshots, and live events", () => {
    const rows = deriveStepBoardRows(
      {
        nodes: [
          {
            nodeId: "obs01:implement",
            state: "in-progress",
            lastAttempt: 1,
            updatedAt: "2026-03-04T10:00:05.000Z",
          },
          {
            nodeId: "obs02:test",
            state: "failed",
            lastAttempt: 2,
            updatedAt: "2026-03-04T10:00:08.000Z",
          },
          {
            nodeId: "obs03:review",
            state: "pending",
            lastAttempt: null,
            updatedAt: "2026-03-04T10:00:09.000Z",
          },
        ],
        executionSteps: [
          {
            unitId: "obs01",
            stage: "implement",
            nodeId: "obs01:implement",
            attempt: 1,
            state: "finished",
            durationMs: 1200,
            startedAt: "2026-03-04T10:00:00.000Z",
            timestamp: "2026-03-04T10:00:02.000Z",
          },
          {
            unitId: "obs02",
            stage: "test",
            nodeId: "obs02:test",
            attempt: 2,
            state: "failed",
            durationMs: 4000,
            startedAt: "2026-03-04T10:00:03.000Z",
            timestamp: "2026-03-04T10:00:07.000Z",
          },
        ],
        liveEvents: [
          {
            type: "NodeStarted",
            timestamp: "2026-03-04T10:00:10.000Z",
            payload: { nodeId: "obs01:implement", attempt: 2 },
          },
          {
            type: "NodeBlocked",
            timestamp: "2026-03-04T10:00:11.000Z",
            payload: { nodeId: "obs04:plan", attempt: 1 },
          },
        ],
      },
      { nowMs: Date.parse("2026-03-04T10:00:20.000Z") },
    );

    const byNode = new Map(rows.map((row) => [row.nodeId, row] as const));

    expect(byNode.get("obs01:implement")).toMatchObject({
      attempt: 2,
      state: "in-progress",
    });
    expect(byNode.get("obs02:test")).toMatchObject({
      attempt: 2,
      state: "failed",
    });
    expect(byNode.get("obs03:review")).toMatchObject({
      state: "pending",
    });
    expect(byNode.get("obs04:plan")).toMatchObject({
      state: "blocked",
    });
  });

  test("filters and sorts step rows deterministically", () => {
    const rows: StepBoardRow[] = [
      {
        unitId: "obs01",
        stage: "implement",
        nodeId: "obs01:implement",
        state: "in-progress",
        attempt: 2,
        durationMs: 20_000,
        startedAtMs: Date.parse("2026-03-04T10:00:00.000Z"),
        lastUpdateMs: Date.parse("2026-03-04T10:00:10.000Z"),
        lastUpdate: "2026-03-04T10:00:10.000Z",
        source: "live",
      },
      {
        unitId: "obs02",
        stage: "test",
        nodeId: "obs02:test",
        state: "failed",
        attempt: 1,
        durationMs: 2000,
        startedAtMs: Date.parse("2026-03-04T10:00:05.000Z"),
        lastUpdateMs: Date.parse("2026-03-04T10:00:07.000Z"),
        lastUpdate: "2026-03-04T10:00:07.000Z",
        source: "execution",
      },
      {
        unitId: "obs03",
        stage: "review",
        nodeId: "obs03:review",
        state: "pending",
        attempt: 0,
        durationMs: null,
        startedAtMs: null,
        lastUpdateMs: Date.parse("2026-03-04T10:00:11.000Z"),
        lastUpdate: "2026-03-04T10:00:11.000Z",
        source: "node",
      },
    ];

    const filtered = filterStepBoardRows(rows, {
      state: "failed",
      query: "",
    });
    expect(filtered.map((row) => row.nodeId)).toEqual(["obs02:test"]);

    const sorted = sortStepBoardRows(rows, "longest-running", {
      nowMs: Date.parse("2026-03-04T10:00:20.000Z"),
    });
    expect(sorted[0]?.nodeId).toBe("obs01:implement");
  });

  test("derives latest navigation targets from current board", () => {
    const rows: StepBoardRow[] = [
      {
        unitId: "obs01",
        stage: "implement",
        nodeId: "obs01:implement",
        state: "failed",
        attempt: 2,
        durationMs: 800,
        startedAtMs: null,
        lastUpdateMs: Date.parse("2026-03-04T10:00:09.000Z"),
        lastUpdate: "2026-03-04T10:00:09.000Z",
        source: "execution",
      },
      {
        unitId: "obs02",
        stage: "plan",
        nodeId: "obs02:plan",
        state: "pending",
        attempt: 0,
        durationMs: null,
        startedAtMs: null,
        lastUpdateMs: Date.parse("2026-03-04T10:00:11.000Z"),
        lastUpdate: "2026-03-04T10:00:11.000Z",
        source: "node",
      },
      {
        unitId: "obs03",
        stage: "test",
        nodeId: "obs03:test",
        state: "in-progress",
        attempt: 1,
        durationMs: null,
        startedAtMs: Date.parse("2026-03-04T10:00:12.000Z"),
        lastUpdateMs: Date.parse("2026-03-04T10:00:12.000Z"),
        lastUpdate: "2026-03-04T10:00:12.000Z",
        source: "live",
      },
    ];

    const targets = deriveLatestNavigationTargets(rows);
    expect(targets.latestFailed?.nodeId).toBe("obs01:implement");
    expect(targets.latestPending?.nodeId).toBe("obs02:plan");
    expect(targets.latestInProgress?.nodeId).toBe("obs03:test");
  });

  test("prioritizes and filters timeline with critical-first semantics", () => {
    const rows = deriveTimelineRows(
      [
        {
          source: "smithers",
          category: "node",
          eventType: "NodeStarted",
          eventKey: "a",
          summary: "obs01:implement started",
          timestamp: "2026-03-04T10:00:10.000Z",
          timestampMs: Date.parse("2026-03-04T10:00:10.000Z"),
          payload: { nodeId: "obs01:implement", attempt: 1 },
        },
        {
          source: "agentix",
          category: "command",
          eventType: "command.failed",
          eventKey: "b",
          summary: "run failed",
          timestamp: "2026-03-04T10:00:09.000Z",
          timestampMs: Date.parse("2026-03-04T10:00:09.000Z"),
          payload: {},
        },
        {
          source: "resource",
          category: "resource",
          eventType: "resource.sample",
          eventKey: "c",
          summary: "cpu 97%",
          timestamp: "2026-03-04T10:00:12.000Z",
          timestampMs: Date.parse("2026-03-04T10:00:12.000Z"),
          payload: { cpuPercent: 97, memoryRssMb: 1200 },
        },
      ],
      {
        criticalOnly: false,
        failuresOnly: false,
        systemEvents: true,
        toolEvents: true,
        resourceAnomalies: false,
        query: "",
      },
      { nowMs: Date.parse("2026-03-04T10:00:20.000Z") },
    );

    expect(rows[0]?.eventType).toBe("command.failed");
    expect(rows[0]?.severity).toBe("critical");

    const criticalOnly = deriveTimelineRows(
      rows,
      {
        criticalOnly: true,
        failuresOnly: false,
        systemEvents: true,
        toolEvents: true,
        resourceAnomalies: false,
        query: "",
      },
      { nowMs: Date.parse("2026-03-04T10:00:20.000Z") },
    );
    expect(criticalOnly.map((entry) => entry.eventType)).toEqual(["command.failed"]);
  });

  test("supports resource-anomaly-only timeline filtering", () => {
    const rows = deriveTimelineRows(
      [
        {
          source: "resource",
          category: "resource",
          eventType: "resource.sample",
          eventKey: "resource-ok",
          summary: "cpu 12%",
          timestamp: "2026-03-04T10:00:12.000Z",
          timestampMs: Date.parse("2026-03-04T10:00:12.000Z"),
          payload: { cpuPercent: 12, memoryRssMb: 300 },
        },
        {
          source: "resource",
          category: "resource",
          eventType: "resource.sample",
          eventKey: "resource-high",
          summary: "cpu 95%",
          timestamp: "2026-03-04T10:00:13.000Z",
          timestampMs: Date.parse("2026-03-04T10:00:13.000Z"),
          payload: { cpuPercent: 95, memoryRssMb: 1500 },
        },
      ],
      {
        criticalOnly: false,
        failuresOnly: false,
        systemEvents: true,
        toolEvents: true,
        resourceAnomalies: true,
        query: "",
      },
      { nowMs: Date.parse("2026-03-04T10:00:20.000Z") },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventKey).toBe("resource-high");
  });

  test("derives pulse summary with deterministic empty states", () => {
    const empty = deriveRunPulseSummary({
      runStatus: null,
      stepRows: [],
      timelineRows: [],
    });
    expect(empty.runStatus).toBe("no-run");
    expect(empty.inProgressCount).toBe(0);
    expect(empty.pendingCount).toBe(0);
    expect(empty.failedCount).toBe(0);
    expect(empty.blockedCount).toBe(0);
    expect(empty.lastCriticalEvent).toBeNull();

    const rows: StepBoardRow[] = [
      {
        unitId: "obs07",
        stage: "test",
        nodeId: "obs07:test",
        state: "failed",
        attempt: 1,
        durationMs: 1200,
        startedAtMs: Date.parse("2026-03-04T10:00:00.000Z"),
        lastUpdateMs: Date.parse("2026-03-04T10:00:03.000Z"),
        lastUpdate: "2026-03-04T10:00:03.000Z",
        source: "execution",
      },
    ];

    const filters: TimelineFilterState = {
      criticalOnly: false,
      failuresOnly: false,
      systemEvents: true,
      toolEvents: true,
      resourceAnomalies: false,
      query: "",
    };

    const timeline = deriveTimelineRows(
      [
        {
          source: "agentix",
          category: "command",
          eventType: "command.failed",
          eventKey: "evt-1",
          summary: "run failed",
          timestamp: "2026-03-04T10:00:04.000Z",
          timestampMs: Date.parse("2026-03-04T10:00:04.000Z"),
          payload: {},
        },
      ],
      filters,
      { nowMs: Date.parse("2026-03-04T10:00:06.000Z") },
    );

    const pulse = deriveRunPulseSummary({
      runStatus: "running",
      stepRows: rows,
      timelineRows: timeline,
    });
    expect(pulse.runStatus).toBe("running");
    expect(pulse.failedCount).toBe(1);
    expect(pulse.latestStep?.nodeId).toBe("obs07:test");
    expect(pulse.lastCriticalEvent?.eventKey).toBe("evt-1");
  });
});
