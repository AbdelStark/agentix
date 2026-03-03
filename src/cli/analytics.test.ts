import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  analyzeTelemetryFromJsonl,
  classifyFailureTaxonomy,
  renderQualityReport,
  writeDailySnapshot,
  writeQualityReport,
} from "./analytics";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function mkTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agentix-analytics-test-"));
  tempDirs.push(dir);
  return dir;
}

function eventLine(event: unknown): string {
  return JSON.stringify(event);
}

describe("telemetry analytics parser + aggregator", () => {
  test("tolerates malformed lines and drops invalid events without throwing", () => {
    const now = new Date("2026-03-03T12:00:00.000Z");
    const raw = [
      eventLine({
        ts: "2026-03-03T11:00:00.000Z",
        level: "info",
        event: "command.started",
        command: "run",
      }),
      "{ bad-json-line",
      eventLine("not-an-object"),
      eventLine({
        ts: "not-a-date",
        level: "error",
        event: "command.failed",
        command: "plan",
      }),
      eventLine({
        ts: "2026-03-03T11:05:00.000Z",
        level: "error",
        event: "command.failed",
        command: "plan",
        details: { reason: "missing-rfc", durationMs: 123 },
      }),
      "",
    ].join("\n");

    const summary = analyzeTelemetryFromJsonl(raw, {
      now,
      window: "7d",
    });

    expect(summary.source.malformedLines).toBe(1);
    expect(summary.source.droppedEvents).toBe(2);
    expect(summary.source.parsedEvents).toBe(2);
    expect(summary.totals.started).toBe(1);
    expect(summary.totals.failed).toBe(1);
    expect(summary.totals.terminal).toBe(1);
  });

  test("produces deterministic summary metrics for a fixed window", () => {
    const now = new Date("2026-03-03T12:00:00.000Z");

    const raw = [
      eventLine({
        ts: "2026-03-02T09:00:00.000Z",
        level: "info",
        event: "command.started",
        command: "run",
        details: { resumeRunId: null },
      }),
      eventLine({
        ts: "2026-03-02T09:05:00.000Z",
        level: "info",
        event: "command.completed",
        command: "run",
        details: { durationMs: 2000, mode: "run", exitCode: 0 },
      }),
      eventLine({
        ts: "2026-03-02T10:00:00.000Z",
        level: "info",
        event: "command.started",
        command: "plan",
      }),
      eventLine({
        ts: "2026-03-02T10:01:00.000Z",
        level: "error",
        event: "command.failed",
        command: "plan",
        details: { reason: "missing-rfc", durationMs: 300 },
      }),
      eventLine({
        ts: "2026-03-01T08:00:00.000Z",
        level: "info",
        event: "command.started",
        command: "run",
        details: { resumeRunId: "sw-prev" },
      }),
      eventLine({
        ts: "2026-03-01T08:05:00.000Z",
        level: "error",
        event: "command.failed",
        command: "run",
        details: { message: "Scheduled Work exited with code 7", durationMs: 1000 },
      }),
      eventLine({
        ts: "2026-03-01T11:00:00.000Z",
        level: "info",
        event: "command.started",
        command: "status",
      }),
      eventLine({
        ts: "2026-03-01T11:00:05.000Z",
        level: "info",
        event: "command.completed",
        command: "status",
        details: { durationMs: 120 },
      }),
      eventLine({
        ts: "2026-02-20T11:00:00.000Z",
        level: "error",
        event: "command.failed",
        command: "init",
        details: { reason: "missing-rfc-path", durationMs: 10 },
      }),
    ].join("\n");

    const summaryA = analyzeTelemetryFromJsonl(raw, {
      now,
      window: "7d",
    });
    const summaryB = analyzeTelemetryFromJsonl(raw, {
      now,
      window: "7d",
    });

    expect(JSON.stringify(summaryA)).toBe(JSON.stringify(summaryB));

    expect(summaryA.totals).toEqual({
      started: 4,
      completed: 2,
      failed: 2,
      cancelled: 0,
      terminal: 4,
      successRate: 0.5,
      failureRate: 0.5,
      cancellationRate: 0,
    });

    expect(summaryA.durationsMs).toEqual({
      samples: 4,
      median: 650,
      p95: 2000,
    });

    expect(summaryA.runStability).toEqual({
      runStarts: 2,
      resumedRuns: 1,
      resumeRate: 0.5,
      nonZeroExitCount: 1,
    });

    expect(summaryA.failures.taxonomy.config).toBe(1);
    expect(summaryA.failures.taxonomy.infra).toBe(1);
    expect(summaryA.failures.topByCommand[0]).toEqual(
      expect.objectContaining({ command: "plan", reason: "missing-rfc", count: 1 }),
    );
    expect(summaryA.failures.topByCommand[1]).toEqual(
      expect.objectContaining({ command: "run", reason: "workflow-exit-non-zero", count: 1 }),
    );
  });

  test("classifies failure reasons into stable taxonomy buckets", () => {
    expect(classifyFailureTaxonomy("missing-config")).toBe("config");
    expect(classifyFailureTaxonomy("missing-smithers-cli")).toBe("environment");
    expect(classifyFailureTaxonomy("invalid-event-schema")).toBe("schema");
    expect(classifyFailureTaxonomy("test-suite-failed")).toBe("tests");
    expect(classifyFailureTaxonomy("merge-conflict")).toBe("merge");
    expect(classifyFailureTaxonomy("policy-severity-blocked")).toBe("policy");
    expect(classifyFailureTaxonomy("workflow-timeout")).toBe("infra");
    expect(classifyFailureTaxonomy("some-unseen-reason")).toBe("unknown");
  });

  test("writes daily snapshot and actionable markdown report", async () => {
    const root = await mkTempDir();
    const repoRoot = join(root, "repo");
    const agentixDir = join(repoRoot, ".agentix");
    await mkdir(agentixDir, { recursive: true });

    const raw = [
      eventLine({
        ts: "2026-03-03T09:00:00.000Z",
        level: "error",
        event: "command.failed",
        command: "plan",
        details: { reason: "missing-rfc", durationMs: 300 },
      }),
      eventLine({
        ts: "2026-03-03T09:01:00.000Z",
        level: "info",
        event: "command.completed",
        command: "status",
        details: { durationMs: 80 },
      }),
    ].join("\n");

    const summary = analyzeTelemetryFromJsonl(raw, {
      now: new Date("2026-03-03T12:00:00.000Z"),
      window: "7d",
    });

    const snapshotPath = await writeDailySnapshot(agentixDir, summary, {
      now: new Date("2026-03-03T12:00:00.000Z"),
    });

    const reportMarkdown = renderQualityReport(summary);
    const reportPath = await writeQualityReport(repoRoot, reportMarkdown);

    expect(snapshotPath.endsWith(".agentix/analytics/daily-2026-03-03.json")).toBe(true);
    expect(reportPath.endsWith("docs/ops/quality-report.md")).toBe(true);
    expect(summary.recommendations.length).toBeGreaterThan(0);

    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as {
      window: { label: string };
      totals: { failed: number };
    };
    expect(snapshot.window.label).toBe("7d");
    expect(snapshot.totals.failed).toBe(1);

    const report = await readFile(reportPath, "utf8");
    expect(report).toContain("# Quality Report");
    expect(report).toContain("Prompt/Skill Improvement Candidates");
    expect(report).toContain("missing-rfc");
  });
});
