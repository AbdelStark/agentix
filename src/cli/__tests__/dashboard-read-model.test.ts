import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createDashboardReadModel } from "../dashboard-read-model";

const tempRepos: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRepos.splice(0).map((repo) => rm(repo, { recursive: true, force: true })),
  );
});

async function createTempRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "agentix-dashboard-read-model-"));
  tempRepos.push(repo);
  await mkdir(join(repo, ".agentix"), { recursive: true });
  return repo;
}

async function createWorkflowDb(repoRoot: string): Promise<string> {
  const dbPath = join(repoRoot, ".agentix", "workflow.db");
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE _smithers_runs (
      run_id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      workflow_path TEXT,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      started_at_ms INTEGER,
      finished_at_ms INTEGER,
      error_json TEXT,
      config_json TEXT
    );

    CREATE TABLE _smithers_attempts (
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      iteration INTEGER NOT NULL DEFAULT 0,
      attempt INTEGER NOT NULL,
      state TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      finished_at_ms INTEGER,
      error_json TEXT,
      jj_pointer TEXT,
      response_text TEXT,
      jj_cwd TEXT,
      cached INTEGER DEFAULT 0,
      meta_json TEXT,
      PRIMARY KEY (run_id, node_id, iteration, attempt)
    );

    CREATE TABLE _smithers_events (
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    );
  `);

  db.close();
  return dbPath;
}

describe("dashboard read model", () => {
  test("obs01-s1: listRuns sorts runs by creation timestamp descending", async () => {
    const repoRoot = await createTempRepo();
    const dbPath = await createWorkflowDb(repoRoot);
    const db = new Database(dbPath);

    db.prepare(
      `INSERT INTO _smithers_runs (run_id, workflow_name, workflow_path, status, created_at_ms, started_at_ms, finished_at_ms, error_json, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "sw-old",
      "scheduled-work",
      ".agentix/generated/workflow.tsx",
      "finished",
      1_700_000_000_000,
      1_700_000_000_100,
      1_700_000_010_000,
      null,
      "{}",
    );

    db.prepare(
      `INSERT INTO _smithers_runs (run_id, workflow_name, workflow_path, status, created_at_ms, started_at_ms, finished_at_ms, error_json, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "sw-new",
      "scheduled-work",
      ".agentix/generated/workflow.tsx",
      "running",
      1_800_000_000_000,
      1_800_000_000_050,
      null,
      null,
      "{}",
    );

    db.prepare(
      `INSERT INTO _smithers_runs (run_id, workflow_name, workflow_path, status, created_at_ms, started_at_ms, finished_at_ms, error_json, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "sw-dashboard-demo",
      "scheduled-work",
      ".agentix/generated/workflow.tsx",
      "running",
      1_900_000_000_000,
      1_900_000_000_010,
      null,
      null,
      "{}",
    );

    db.close();

    const model = createDashboardReadModel({ repoRoot });
    const result = model.listRuns({ limit: 10, offset: 0 });

    expect(result.items.map((run) => run.runId)).toEqual(["sw-new", "sw-old"]);
    expect(result.meta.total).toBe(2);
    expect(result.meta.warnings).toEqual([]);
  });

  test("obs01-s2: listCommandEvents returns empty list and warning when events.jsonl is missing", async () => {
    const repoRoot = await createTempRepo();
    await createWorkflowDb(repoRoot);

    const model = createDashboardReadModel({ repoRoot });
    const result = await model.listCommandEvents({ limit: 25, offset: 0 });

    expect(result.items).toEqual([]);
    expect(result.meta.total).toBe(0);
    expect(result.meta.warnings).toContain("events.jsonl is missing");
  });

  test("obs01-s3: listAttempts includes start/end/state/duration and tolerates malformed meta_json", async () => {
    const repoRoot = await createTempRepo();
    const dbPath = await createWorkflowDb(repoRoot);
    const db = new Database(dbPath);

    db.prepare(
      `INSERT INTO _smithers_runs (run_id, workflow_name, workflow_path, status, created_at_ms, started_at_ms, finished_at_ms, error_json, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "sw-attempts",
      "scheduled-work",
      ".agentix/generated/workflow.tsx",
      "running",
      1_900_000_000_000,
      1_900_000_000_010,
      null,
      null,
      "{}",
    );

    db.prepare(
      `INSERT INTO _smithers_attempts (run_id, node_id, iteration, attempt, state, started_at_ms, finished_at_ms, error_json, jj_pointer, response_text, jj_cwd, cached, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "sw-attempts",
      "obs-node:implement",
      0,
      1,
      "finished",
      1_900_000_100_000,
      1_900_000_101_250,
      null,
      "@-",
      "implementation done",
      "/tmp/worktree",
      0,
      "{not-json",
    );

    db.close();

    const model = createDashboardReadModel({ repoRoot });
    const result = model.listAttempts("sw-attempts", { limit: 20, offset: 0 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      runId: "sw-attempts",
      nodeId: "obs-node:implement",
      state: "finished",
      durationMs: 1250,
    });
    expect(result.items[0]?.startedAt).toContain("T");
    expect(result.items[0]?.finishedAt).toContain("T");
    expect(result.items[0]?.meta).toBeNull();
    expect(result.meta.warnings.some((warning) => warning.includes("meta_json"))).toBe(
      true,
    );
  });

  test("listTraceArtifacts gracefully handles missing trace directory", async () => {
    const repoRoot = await createTempRepo();
    await createWorkflowDb(repoRoot);

    const model = createDashboardReadModel({ repoRoot });
    const traces = await model.listTraceArtifacts();

    expect(traces.items).toEqual([]);
    expect(traces.meta.warnings).toContain("trace artifact directory is missing");
  });

  test("listAnalyticsSnapshots parses daily snapshots and ignores malformed files", async () => {
    const repoRoot = await createTempRepo();
    await createWorkflowDb(repoRoot);

    const analyticsDir = join(repoRoot, ".agentix", "analytics");
    await mkdir(analyticsDir, { recursive: true });

    await writeFile(
      join(analyticsDir, "daily-2026-03-01.json"),
      JSON.stringify({ generatedAt: "2026-03-01T00:00:00.000Z", totals: { failed: 2 } }),
      "utf8",
    );
    await writeFile(join(analyticsDir, "daily-2026-03-02.json"), "{bad", "utf8");

    const model = createDashboardReadModel({ repoRoot });
    const snapshots = await model.listAnalyticsSnapshots();

    expect(snapshots.items).toHaveLength(1);
    expect(snapshots.items[0]?.date).toBe("2026-03-01");
    expect(
      snapshots.meta.warnings.some((warning) => warning.includes("daily-2026-03-02.json")),
    ).toBe(true);
  });

  test("listAgentToolEvents parses telemetry sidecar files and ignores malformed records", async () => {
    const repoRoot = await createTempRepo();
    await createWorkflowDb(repoRoot);

    const telemetryDir = join(repoRoot, ".agentix", "telemetry");
    await mkdir(telemetryDir, { recursive: true });

    await writeFile(
      join(telemetryDir, "codex-runtime.jsonl"),
      [
        JSON.stringify({
          provider: "codex",
          type: "tool_call",
          id: "evt-11",
          tool_name: "functions.exec_command",
          timestampMs: 1_900_000_000_000,
        }),
        "{bad",
      ].join("\n"),
      "utf8",
    );

    const model = createDashboardReadModel({ repoRoot });
    const toolEvents = await model.listAgentToolEvents("sw-missing", {
      limit: 20,
      offset: 0,
    });

    expect(toolEvents.items).toHaveLength(1);
    expect(toolEvents.items[0]?.provider).toBe("codex");
    expect(toolEvents.items[0]?.toolName).toBe("functions.exec_command");
  });

  test("listPromptAudits extracts prompt data from multiple metadata shapes", async () => {
    const repoRoot = await createTempRepo();
    const dbPath = await createWorkflowDb(repoRoot);
    const db = new Database(dbPath);

    db.prepare(
      `INSERT INTO _smithers_runs (run_id, workflow_name, workflow_path, status, created_at_ms, started_at_ms, finished_at_ms, error_json, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "sw-prompts",
      "scheduled-work",
      ".agentix/generated/workflow.tsx",
      "running",
      1_910_000_000_000,
      1_910_000_000_010,
      null,
      null,
      "{}",
    );

    db.prepare(
      `INSERT INTO _smithers_attempts (run_id, node_id, iteration, attempt, state, started_at_ms, finished_at_ms, error_json, jj_pointer, response_text, jj_cwd, cached, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "sw-prompts",
      "obs11:implement",
      0,
      1,
      "finished",
      1_910_000_010_000,
      1_910_000_011_000,
      null,
      "@-",
      "Done.",
      "/tmp/wt",
      0,
      JSON.stringify({ prompt: "Implement feature X safely." }),
    );

    db.prepare(
      `INSERT INTO _smithers_attempts (run_id, node_id, iteration, attempt, state, started_at_ms, finished_at_ms, error_json, jj_pointer, response_text, jj_cwd, cached, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "sw-prompts",
      "obs11:test",
      0,
      2,
      "failed",
      1_910_000_012_000,
      1_910_000_013_000,
      JSON.stringify({ message: "tests failed" }),
      "@-",
      "Need fix.",
      "/tmp/wt",
      0,
      JSON.stringify({
        messages: [
          { role: "system", content: "rules" },
          { role: "user", content: "Run full suite and map scenarios." },
        ],
      }),
    );

    db.close();

    const model = createDashboardReadModel({ repoRoot });
    const prompts = await model.listPromptAudits("sw-prompts", {
      limit: 10,
      offset: 0,
    });

    expect(prompts.items).toHaveLength(2);
    expect(prompts.items[0]?.promptText.length).toBeGreaterThan(0);
    expect(prompts.items[0]?.promptHash).not.toBeNull();
    expect(prompts.items[0]?.nodeId).toBe("obs11:test");
    expect(prompts.items[1]?.nodeId).toBe("obs11:implement");
    expect(prompts.items[1]?.responseChars).toBe(5);
  });

  test("listExecutionSteps normalizes unit and stage correlation fields", async () => {
    const repoRoot = await createTempRepo();
    const dbPath = await createWorkflowDb(repoRoot);
    const db = new Database(dbPath);

    db.prepare(
      `INSERT INTO _smithers_runs (run_id, workflow_name, workflow_path, status, created_at_ms, started_at_ms, finished_at_ms, error_json, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "sw-steps",
      "scheduled-work",
      ".agentix/generated/workflow.tsx",
      "running",
      1_920_000_000_000,
      1_920_000_000_010,
      null,
      null,
      "{}",
    );

    db.prepare(
      `INSERT INTO _smithers_attempts (run_id, node_id, iteration, attempt, state, started_at_ms, finished_at_ms, error_json, jj_pointer, response_text, jj_cwd, cached, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "sw-steps",
      "obs12:plan",
      1,
      3,
      "finished",
      1_920_000_010_000,
      1_920_000_012_500,
      null,
      "@-",
      "Plan complete",
      "/tmp/wt",
      1,
      JSON.stringify({ input: { prompt: "Design implementation plan." } }),
    );

    db.close();

    const model = createDashboardReadModel({ repoRoot });
    const steps = await model.listExecutionSteps("sw-steps", {
      limit: 10,
      offset: 0,
    });

    expect(steps.items).toHaveLength(1);
    expect(steps.items[0]).toMatchObject({
      runId: "sw-steps",
      nodeId: "obs12:plan",
      unitId: "obs12",
      stage: "plan",
      iteration: 1,
      attempt: 3,
      durationMs: 2500,
      promptAvailable: true,
      cached: true,
    });
  });

  test("listTimelineEvents merges smithers, command, telemetry, and resource sources in deterministic order", async () => {
    const repoRoot = await createTempRepo();
    const dbPath = await createWorkflowDb(repoRoot);
    const db = new Database(dbPath);

    db.prepare(
      `INSERT INTO _smithers_runs (run_id, workflow_name, workflow_path, status, created_at_ms, started_at_ms, finished_at_ms, error_json, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "sw-timeline",
      "scheduled-work",
      ".agentix/generated/workflow.tsx",
      "running",
      1_930_000_000_000,
      1_930_000_000_100,
      null,
      null,
      "{}",
    );

    db.prepare(
      `INSERT INTO _smithers_events (run_id, seq, timestamp_ms, type, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "sw-timeline",
      1,
      1_930_000_000_500,
      "NodeStarted",
      JSON.stringify({ nodeId: "obs12:implement", iteration: 0, attempt: 1 }),
    );
    db.close();

    await writeFile(
      join(repoRoot, ".agentix", "events.jsonl"),
      JSON.stringify({
        schemaVersion: 2,
        ts: new Date(1_930_000_001_000).toISOString(),
        level: "info",
        event: "command.started",
        command: "run",
        runId: "sw-timeline",
        details: { repoRoot },
      }) + "\n",
      "utf8",
    );

    const telemetryDir = join(repoRoot, ".agentix", "telemetry");
    await mkdir(telemetryDir, { recursive: true });
    await writeFile(
      join(telemetryDir, "codex-runtime.jsonl"),
      JSON.stringify({
        provider: "codex",
        type: "tool_call",
        id: "evt-101",
        tool_name: "functions.exec_command",
        timestampMs: 1_930_000_001_500,
      }) + "\n",
      "utf8",
    );

    await writeFile(
      join(repoRoot, ".agentix", "resource-samples.jsonl"),
      JSON.stringify({
        runId: "sw-timeline",
        nodeId: "obs12:implement",
        timestampMs: 1_930_000_002_000,
        timestamp: new Date(1_930_000_002_000).toISOString(),
        cpuPercent: 22.5,
        memoryRssMb: 180,
      }) + "\n",
      "utf8",
    );

    const model = createDashboardReadModel({ repoRoot });
    const timeline = await model.listTimelineEvents("sw-timeline", {
      limit: 10,
      offset: 0,
    });

    expect(timeline.items.map((entry) => entry.source)).toEqual([
      "resource",
      "telemetry",
      "agentix",
      "smithers",
    ]);
    expect(timeline.items[0]?.category).toBe("resource");
    expect(timeline.items[1]?.eventType).toBe("tool_call");
    expect(timeline.items[3]?.eventType).toBe("NodeStarted");
  });
});
