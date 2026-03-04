import { describe, expect, test } from "bun:test";

import { runDashboard } from "../dashboard-cmd";

describe("dashboard command", () => {
  test("launches server and emits command lifecycle telemetry", async () => {
    const telemetry: Array<{ event: string; command: string; details?: Record<string, unknown> }> = [];
    let stopCalls = 0;

    await runDashboard({
      repoRoot: "/tmp/repo",
      flags: {
        host: "127.0.0.1",
        port: "43110",
      },
      deps: {
        appendAgentixEvent: async (_agentixDir, payload) => {
          telemetry.push({
            event: payload.event,
            command: payload.command,
            details: payload.details as Record<string, unknown> | undefined,
          });
        },
        startServer: async () => ({
          host: "127.0.0.1",
          port: 43110,
          baseUrl: "http://127.0.0.1:43110",
          stop: async () => {
            stopCalls += 1;
          },
        }),
        waitForSignal: async () => undefined,
      },
    });

    expect(stopCalls).toBe(1);
    expect(telemetry.map((entry) => entry.event)).toEqual([
      "command.started",
      "command.completed",
    ]);
    expect(telemetry.every((entry) => entry.command === "dashboard")).toBe(true);
  });

  test("fails closed for non-local bind without token", async () => {
    await expect(
      runDashboard({
        repoRoot: "/tmp/repo",
        flags: {
          host: "0.0.0.0",
          port: "43110",
        },
      }),
    ).rejects.toThrow(
      "Refusing non-local dashboard binding without auth token. Use --token <value>.",
    );
  });
});
