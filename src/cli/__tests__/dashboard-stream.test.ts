import { describe, expect, test } from "bun:test";

import {
  createDashboardEventEnvelope,
  DashboardEventStream,
} from "../dashboard-stream";

describe("dashboard SSE stream", () => {
  test("obs02-s1: subscription with no cursor replays recent window then emits live updates", async () => {
    const stream = new DashboardEventStream({ heartbeatMs: 1_000, replayLimit: 3 });

    stream.publish(
      createDashboardEventEnvelope({
        runId: "sw-1",
        source: "smithers",
        type: "NodeStarted",
        timestampMs: 10,
        eventKey: "e-1",
        payload: { nodeId: "node-a" },
      }),
    );
    stream.publish(
      createDashboardEventEnvelope({
        runId: "sw-1",
        source: "smithers",
        type: "NodeFinished",
        timestampMs: 20,
        eventKey: "e-2",
        payload: { nodeId: "node-a" },
      }),
    );

    const replay = stream.getReplay({ afterSeq: null });
    expect(replay.map((event) => event.eventKey)).toEqual(["e-1", "e-2"]);

    stream.publish(
      createDashboardEventEnvelope({
        runId: "sw-1",
        source: "agentix",
        type: "command.completed",
        timestampMs: 30,
        eventKey: "e-3",
        payload: { command: "run" },
      }),
    );

    const replayAfter = stream.getReplay({ afterSeq: replay[1]?.seq ?? 0 });
    expect(replayAfter.map((event) => event.eventKey)).toEqual(["e-3"]);
  });

  test("obs02-s2: reconnecting with afterSeq is idempotent and avoids duplicates", () => {
    const stream = new DashboardEventStream({ heartbeatMs: 1_000, replayLimit: 10 });

    const firstSeq = stream.publish(
      createDashboardEventEnvelope({
        runId: "sw-2",
        source: "smithers",
        type: "NodeOutput",
        timestampMs: 50,
        eventKey: "dup-key",
        payload: { text: "line 1" },
      }),
    );

    const duplicateSeq = stream.publish(
      createDashboardEventEnvelope({
        runId: "sw-2",
        source: "smithers",
        type: "NodeOutput",
        timestampMs: 55,
        eventKey: "dup-key",
        payload: { text: "line 1 duplicate" },
      }),
    );

    expect(duplicateSeq).toBe(firstSeq);

    stream.publish(
      createDashboardEventEnvelope({
        runId: "sw-2",
        source: "smithers",
        type: "NodeOutput",
        timestampMs: 60,
        eventKey: "unique-key",
        payload: { text: "line 2" },
      }),
    );

    const firstCatchup = stream.getReplay({ afterSeq: null });
    expect(firstCatchup.map((event) => event.eventKey)).toEqual([
      "dup-key",
      "unique-key",
    ]);

    const secondCatchup = stream.getReplay({ afterSeq: firstCatchup[0]?.seq ?? 0 });
    expect(secondCatchup.map((event) => event.eventKey)).toEqual(["unique-key"]);
  });

  test("obs02-s3: heartbeats are emitted when stream is idle", async () => {
    const stream = new DashboardEventStream({ heartbeatMs: 15, replayLimit: 5 });

    const heartbeats: string[] = [];
    const unsubscribe = stream.subscribe((event) => {
      if (event.type === "heartbeat" && "cursor" in event) {
        heartbeats.push(String(event.cursor));
      }
    });

    await Bun.sleep(70);
    unsubscribe();

    expect(heartbeats.length).toBeGreaterThanOrEqual(3);
    expect(heartbeats.every((cursor) => /^\d+$/.test(cursor))).toBe(true);
  });
});
