import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runAnalyticsCommand } from "../analytics-cmd";
import {
  cleanupTempRepos,
  createExitStub,
  createTempRepo,
  expectEvent,
  expectProcessExit,
  readAgentixEvents,
} from "./fixtures";

afterEach(async () => {
  await cleanupTempRepos();
});

function eventLine(event: Record<string, unknown>): string {
  return JSON.stringify(event);
}

describe("analytics command integration", () => {
  test("summary emits deterministic JSON and writes snapshot/report artifacts", async () => {
    const repoRoot = await createTempRepo();
    const agentixDir = join(repoRoot, ".agentix");
    await mkdir(agentixDir, { recursive: true });

    const raw = [
      eventLine({
        ts: "2026-03-02T09:00:00.000Z",
        level: "info",
        event: "command.completed",
        command: "run",
        details: { durationMs: 2000, mode: "run", exitCode: 0 },
      }),
      eventLine({
        ts: "2026-03-02T09:05:00.000Z",
        level: "error",
        event: "command.failed",
        command: "plan",
        details: { reason: "missing-rfc", durationMs: 300 },
      }),
    ].join("\n");

    await writeFile(join(agentixDir, "events.jsonl"), raw + "\n", "utf8");

    const lines: string[] = [];

    await runAnalyticsCommand({
      positional: ["summary"],
      flags: {
        window: "7d",
        json: true,
        "write-report": true,
      },
      repoRoot,
      deps: {
        now: () => new Date("2026-03-03T12:00:00.000Z"),
        writeLine: (line) => lines.push(line),
      },
    });

    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0]) as {
      summary: {
        totals: { completed: number; failed: number };
      };
      snapshotPath: string;
      reportPath: string;
    };

    expect(payload.summary.totals.completed).toBe(1);
    expect(payload.summary.totals.failed).toBe(1);
    expect(payload.snapshotPath.endsWith(".agentix/analytics/daily-2026-03-03.json")).toBe(true);
    expect(payload.reportPath.endsWith("docs/ops/quality-report.md")).toBe(true);

    const events = await readAgentixEvents(repoRoot);
    expectEvent(events, "command.started");
    const completed = events.find(
      (event) => event.event === "command.completed" && event.command === "analytics",
    );
    expect(completed).toBeDefined();
    expect(completed.command).toBe("analytics");
    expect(completed.details?.action).toBe("summary");
  });

  test("failures command honors --top and returns stable ordering", async () => {
    const repoRoot = await createTempRepo();
    const agentixDir = join(repoRoot, ".agentix");
    await mkdir(agentixDir, { recursive: true });

    const raw = [
      eventLine({
        ts: "2026-03-02T09:00:00.000Z",
        level: "error",
        event: "command.failed",
        command: "plan",
        details: { reason: "missing-rfc" },
      }),
      eventLine({
        ts: "2026-03-02T09:01:00.000Z",
        level: "error",
        event: "command.failed",
        command: "plan",
        details: { reason: "missing-rfc" },
      }),
      eventLine({
        ts: "2026-03-02T09:02:00.000Z",
        level: "error",
        event: "command.failed",
        command: "run",
        details: { reason: "missing-work-plan" },
      }),
      eventLine({
        ts: "2026-03-02T09:03:00.000Z",
        level: "error",
        event: "command.failed",
        command: "run",
        details: { reason: "missing-smithers-cli" },
      }),
      eventLine({
        ts: "2026-03-02T09:04:00.000Z",
        level: "error",
        event: "command.failed",
        command: "run",
        details: { reason: "missing-smithers-cli" },
      }),
    ].join("\n");

    await writeFile(join(agentixDir, "events.jsonl"), raw + "\n", "utf8");

    const lines: string[] = [];

    await runAnalyticsCommand({
      positional: ["failures"],
      flags: {
        window: "7d",
        top: "2",
        json: true,
      },
      repoRoot,
      deps: {
        now: () => new Date("2026-03-03T12:00:00.000Z"),
        writeLine: (line) => lines.push(line),
      },
    });

    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0]) as {
      failures: Array<{ command: string; reason: string; count: number }>;
    };

    expect(payload.failures).toEqual([
      expect.objectContaining({ command: "plan", reason: "missing-rfc", count: 2 }),
      expect.objectContaining({ command: "run", reason: "missing-smithers-cli", count: 2 }),
    ]);
  });

  test("summary supports --exclude-command analytics", async () => {
    const repoRoot = await createTempRepo();
    const agentixDir = join(repoRoot, ".agentix");
    await mkdir(agentixDir, { recursive: true });

    const raw = [
      eventLine({
        schemaVersion: 2,
        ts: "2026-03-02T09:00:00.000Z",
        level: "info",
        event: "command.completed",
        command: "analytics",
        details: { durationMs: 7 },
      }),
      eventLine({
        schemaVersion: 2,
        ts: "2026-03-02T09:02:00.000Z",
        level: "error",
        event: "command.failed",
        command: "run",
        details: { reason: "missing-smithers-cli", durationMs: 300 },
      }),
    ].join("\n");

    await writeFile(join(agentixDir, "events.jsonl"), raw + "\n", "utf8");

    const lines: string[] = [];
    await runAnalyticsCommand({
      positional: ["summary"],
      flags: {
        window: "7d",
        json: true,
        "exclude-command": "analytics",
      },
      repoRoot,
      deps: {
        now: () => new Date("2026-03-03T12:00:00.000Z"),
        writeLine: (line) => lines.push(line),
      },
    });

    const payload = JSON.parse(lines[0]) as {
      summary: {
        source: { excludedCommands: string[] };
        commands: Record<string, unknown>;
      };
    };
    expect(payload.summary.source.excludedCommands).toEqual(["analytics"]);
    expect(payload.summary.commands.analytics).toBeUndefined();
    expect(payload.summary.commands.run).toBeDefined();
  });

  test("summary enforces configured hard gate for recurring non-zero run exits", async () => {
    const repoRoot = await createTempRepo();
    const agentixDir = join(repoRoot, ".agentix");
    await mkdir(agentixDir, { recursive: true });

    const raw = [
      eventLine({
        schemaVersion: 2,
        ts: "2026-03-02T09:00:00.000Z",
        level: "error",
        event: "command.failed",
        command: "run",
        details: { message: "Scheduled Work exited with code 7", durationMs: 1000 },
      }),
      eventLine({
        schemaVersion: 2,
        ts: "2026-03-02T09:05:00.000Z",
        level: "error",
        event: "command.failed",
        command: "run",
        details: { message: "Scheduled Work exited with code 9", durationMs: 1200 },
      }),
    ].join("\n");

    await writeFile(join(agentixDir, "events.jsonl"), raw + "\n", "utf8");
    await writeFile(
      join(repoRoot, "agentix.policy.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          telemetry: {
            runNonZeroExitHardGate: {
              enabled: true,
              threshold: 2,
            },
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const exitStub = createExitStub();

    await expectProcessExit(
      runAnalyticsCommand({
        positional: ["summary"],
        flags: {
          window: "7d",
        },
        repoRoot,
        deps: {
          now: () => new Date("2026-03-03T12:00:00.000Z"),
          exit: exitStub.exit,
        },
      }),
      1,
    );

    const events = await readAgentixEvents(repoRoot);
    const failed = events.find(
      (event) =>
        event.event === "command.failed" &&
        event.command === "analytics" &&
        String(event.details?.reason) === "policy-run-non-zero-hard-gate",
    );
    expect(failed).toBeDefined();
  });
});
