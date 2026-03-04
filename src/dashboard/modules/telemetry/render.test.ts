import { describe, expect, test } from "bun:test";

import { renderTelemetryCockpit } from "./render";

describe("telemetry cockpit rendering", () => {
  test("renders summary, step, prompt, and timeline panels with populated data", () => {
    const html = renderTelemetryCockpit({
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
    });

    expect(html).toContain("Telemetry Health");
    expect(html).toContain("Execution Steps");
    expect(html).toContain("Prompt Audit");
    expect(html).toContain("Unified Timeline");
    expect(html).toContain("functions.exec_command");
    expect(html).toContain("obs13:implement");
  });

  test("renders empty-state diagnostics when telemetry sources are missing", () => {
    const html = renderTelemetryCockpit({
      toolEvents: [],
      resources: [],
      prompts: [],
      executionSteps: [],
      timeline: [],
      liveEvents: [],
    });

    expect(html).toContain("No execution-step telemetry yet");
    expect(html).toContain("No prompt audit records yet");
    expect(html).toContain("No timeline telemetry yet");
  });
});
