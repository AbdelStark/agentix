import { describe, expect, test } from "bun:test";

import {
  ingestClaudeTelemetryLines,
  parseClaudeTelemetryEvent,
} from "../dashboard-telemetry-adapters/claude";

describe("claude telemetry adapter", () => {
  test("obs08b-s1: normalizes claude stream-json telemetry records", () => {
    const event = parseClaudeTelemetryEvent({
      runId: "sw-claude",
      nodeId: "obs-08b:implement",
      iteration: 0,
      attempt: 1,
      timestampMs: 1_900_000_010_000,
      rawLine: JSON.stringify({
        type: "message_update",
        provider: "claude",
        id: "claude-evt-1",
        assistantMessageEvent: {
          type: "tool_use",
          name: "write_stdin",
        },
        usage: {
          input_tokens: 120,
          output_tokens: 64,
          total_tokens: 184,
        },
      }),
    });

    expect(event).not.toBeNull();
    expect(event?.eventType).toBe("message_update");
    expect(event?.toolName).toBe("write_stdin");
    expect(event?.tokenUsage.total).toBe(184);
  });

  test("ingest skips malformed lines and keeps valid records", () => {
    const result = ingestClaudeTelemetryLines({
      runId: "sw-claude",
      nodeId: "obs-08b:plan",
      iteration: 1,
      attempt: 2,
      timestampMs: 1_900_000_010_100,
      lines: [
        "",
        "{bad",
        JSON.stringify({ type: "turn_end", provider: "claude", id: "ok-1" }),
      ],
    });

    expect(result.malformedLines).toBe(2);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.eventType).toBe("turn_end");
  });

  test("obs08b-s2: correlation keys remain stable for same event id", () => {
    const result = ingestClaudeTelemetryLines({
      runId: "sw-claude-correlation",
      nodeId: "obs-08b:test",
      iteration: 6,
      attempt: 3,
      timestampMs: 1_900_000_011_000,
      lines: [JSON.stringify({ type: "message_end", provider: "claude", id: "evt-91" })],
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.eventKey).toContain("evt-91");
    expect(result.events[0]).toMatchObject({
      runId: "sw-claude-correlation",
      nodeId: "obs-08b:test",
      iteration: 6,
      attempt: 3,
    });
  });
});
