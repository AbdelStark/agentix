import { describe, expect, test } from "bun:test";

import { renderTelemetryCockpit } from "./render";

describe("telemetry cockpit rendering", () => {
  test("renders operator pulse, step board, and prioritized timeline with populated data", () => {
    const html = renderTelemetryCockpit({
      runStatus: "running",
      nodes: [
        {
          nodeId: "obs13:implement",
          state: "in-progress",
          lastAttempt: 1,
          updatedAt: "2026-03-04T10:00:03.000Z",
        },
      ],
      toolEvents: [
        {
          provider: "codex",
          eventType: "tool_call",
          toolName: "functions.exec_command",
          tokenUsage: { total: 123 },
          timestamp: "2026-03-04T10:00:00.000Z",
        },
      ],
      resources: [
        {
          timestamp: "2026-03-04T10:00:01.000Z",
          nodeId: "obs13:implement",
          cpuPercent: 10.2,
          memoryRssMb: 200.4,
        },
      ],
      prompts: [
        {
          nodeId: "obs13:implement",
          attempt: 1,
          promptPreview: "Implement scenario mapping.",
          promptHash: "abc123",
          responseChars: 345,
          timestamp: "2026-03-04T10:00:02.000Z",
        },
      ],
      executionSteps: [
        {
          unitId: "obs13",
          stage: "implement",
          nodeId: "obs13:implement",
          attempt: 1,
          iteration: 0,
          state: "finished",
          durationMs: 1600,
          promptAvailable: true,
          promptPreview: "Implement scenario mapping.",
          responseChars: 345,
          timestamp: "2026-03-04T10:00:02.000Z",
        },
      ],
      timeline: [
        {
          source: "smithers",
          category: "node",
          eventType: "NodeFinished",
          summary: "obs13:implement finished",
          timestamp: "2026-03-04T10:00:03.000Z",
        },
      ],
      liveEvents: [
        {
          type: "NodeOutput",
          timestamp: "2026-03-04T10:00:04.000Z",
        },
      ],
      stepBoardFilter: { state: "all", query: "" },
      stepBoardSort: "newest",
      timelineFilters: {
        criticalOnly: false,
        failuresOnly: false,
        systemEvents: true,
        toolEvents: true,
        resourceAnomalies: false,
        query: "",
      },
      timelineFocusEventKey: null,
    });

    expect(html).toContain("Step Status Board");
    expect(html).toContain("Latest Failed Step");
    expect(html).toContain("Quick jump");
    expect(html).toContain("Prompt Audit");
    expect(html).toContain("Critical-First Timeline");
    expect(html).toContain("critical only");
    expect(html).toContain("system events");
    expect(html).toContain("functions.exec_command");
    expect(html).toContain("obs13:implement");
    expect(html).toContain("data-step-jump");
  });

  test("renders empty-state diagnostics when telemetry sources are missing", () => {
    const html = renderTelemetryCockpit({
      runStatus: null,
      nodes: [],
      toolEvents: [],
      resources: [],
      prompts: [],
      executionSteps: [],
      timeline: [],
      liveEvents: [],
      stepBoardFilter: { state: "all", query: "" },
      stepBoardSort: "newest",
      timelineFilters: {
        criticalOnly: false,
        failuresOnly: false,
        systemEvents: true,
        toolEvents: true,
        resourceAnomalies: false,
        query: "",
      },
      timelineFocusEventKey: null,
    });

    expect(html).toContain("No step data for this run yet");
    expect(html).toContain("No timeline events for current filters");
    expect(html).toContain("No prompt audit records yet");
    expect(html).toContain("No telemetry events yet");
  });
});
