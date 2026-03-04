import { describe, expect, test } from "bun:test";

import {
  ingestCodexTelemetryLines,
  parseCodexTelemetryEvent,
} from "../dashboard-telemetry-adapters/codex";

describe("codex telemetry adapter", () => {
  test("obs08a-s1: normalizes codex tool telemetry events", () => {
    const event = parseCodexTelemetryEvent({
      runId: "sw-codex",
      nodeId: "obs-08a:implement",
      iteration: 0,
      attempt: 2,
      timestampMs: 1_900_000_000_000,
      rawLine: JSON.stringify({
        provider: "codex",
        type: "tool_call",
        id: "evt-1",
        tool_name: "functions.exec_command",
        usage: {
          input_tokens: 320,
          output_tokens: 80,
          total_tokens: 400,
        },
      }),
    });

    expect(event).not.toBeNull();
    expect(event?.eventType).toBe("tool_call");
    expect(event?.toolName).toBe("functions.exec_command");
    expect(event?.tokenUsage.total).toBe(400);
    expect(event?.eventKey).toContain("sw-codex");
  });

  test("obs08a-s2: malformed lines are counted and ignored", () => {
    const result = ingestCodexTelemetryLines({
      runId: "sw-codex",
      nodeId: "obs-08a:implement",
      iteration: 0,
      attempt: 1,
      timestampMs: 1_900_000_000_000,
      lines: [
        "{bad",
        "not-json",
        JSON.stringify({ provider: "codex", type: "tool_call", id: "ok", toolName: "tool" }),
      ],
    });

    expect(result.malformedLines).toBe(2);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.toolName).toBe("tool");
  });

  test("obs08a-s3: correlation keys include run/node/attempt context", () => {
    const result = ingestCodexTelemetryLines({
      runId: "sw-codex-correlation",
      nodeId: "obs-08a:test",
      iteration: 3,
      attempt: 4,
      timestampMs: 1_900_000_001_000,
      lines: [
        JSON.stringify({
          provider: "codex",
          type: "assistant_message",
          id: "evt-77",
        }),
      ],
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      runId: "sw-codex-correlation",
      nodeId: "obs-08a:test",
      iteration: 3,
      attempt: 4,
    });
    expect(result.events[0]?.eventKey).toContain("evt-77");
  });
});
