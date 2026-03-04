import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  startDashboardApiServer,
  type DashboardApiServer,
} from "../dashboard-api";

const tempRepos: string[] = [];

async function createTempRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "agentix-dashboard-api-"));
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

async function seedApiFixture(repoRoot: string): Promise<void> {
  const dbPath = await createWorkflowDb(repoRoot);
  const db = new Database(dbPath);

  db.prepare(
    `INSERT INTO _smithers_runs (run_id, workflow_name, workflow_path, status, created_at_ms, started_at_ms, finished_at_ms, error_json, config_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "sw-api-old",
    "scheduled-work",
    ".agentix/generated/workflow.tsx",
    "finished",
    1_700_000_000_000,
    1_700_000_000_050,
    1_700_000_010_000,
    null,
    "{}",
  );

  db.prepare(
    `INSERT INTO _smithers_runs (run_id, workflow_name, workflow_path, status, created_at_ms, started_at_ms, finished_at_ms, error_json, config_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "sw-api-new",
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
    1_900_000_000_050,
    null,
    null,
    "{}",
  );

  db.prepare(
    `INSERT INTO _smithers_attempts (run_id, node_id, iteration, attempt, state, started_at_ms, finished_at_ms, error_json, jj_pointer, response_text, jj_cwd, cached, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "sw-api-new",
    "unit-obs:implement",
    0,
    1,
    "finished",
    1_800_000_100_000,
    1_800_000_101_100,
    null,
    "@-",
    "ok",
    "/tmp/wt",
    0,
    JSON.stringify({ prompt: "Do X" }),
  );

  db.prepare(
    `INSERT INTO _smithers_events (run_id, seq, timestamp_ms, type, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    "sw-api-new",
    1,
    1_800_000_100_500,
    "NodeStarted",
    JSON.stringify({
      nodeId: "unit-obs:implement",
      iteration: 0,
      attempt: 1,
    }),
  );

  db.close();

  await writeFile(
    join(repoRoot, ".agentix", "events.jsonl"),
    JSON.stringify({
      schemaVersion: 2,
      ts: new Date(1_800_000_100_700).toISOString(),
      level: "info",
      event: "command.started",
      command: "run",
      runId: "sw-api-new",
      details: { repoRoot },
    }) + "\n",
    "utf8",
  );

  await mkdir(join(repoRoot, ".agentix", "telemetry"), { recursive: true });
  await writeFile(
    join(repoRoot, ".agentix", "telemetry", "codex-runtime.jsonl"),
    JSON.stringify({
      provider: "codex",
      type: "tool_call",
      id: "evt-api-1",
      tool_name: "functions.exec_command",
      timestampMs: 1_800_000_100_900,
    }) + "\n",
    "utf8",
  );

  await writeFile(
    join(repoRoot, ".agentix", "resource-samples.jsonl"),
    JSON.stringify({
      runId: "sw-api-new",
      nodeId: "unit-obs:implement",
      timestampMs: 1_800_000_101_000,
      timestamp: new Date(1_800_000_101_000).toISOString(),
      cpuPercent: 15.2,
      memoryRssMb: 220.3,
    }) + "\n",
    "utf8",
  );
}

async function startServer(repoRoot: string): Promise<DashboardApiServer> {
  return startDashboardApiServer({
    repoRoot,
    host: "127.0.0.1",
    port: 0,
    heartbeatMs: 100,
    replayLimit: 50,
  });
}

afterEach(async () => {
  await Promise.all(
    tempRepos.splice(0).map((repo) => rm(repo, { recursive: true, force: true })),
  );
});

describe("dashboard API", () => {
  test("obs01-s1: GET /api/runs returns deterministic descending run order", async () => {
    const repoRoot = await createTempRepo();
    await seedApiFixture(repoRoot);

    const server = await startServer(repoRoot);
    try {
      const response = await fetch(`${server.baseUrl}/api/runs`);
      expect(response.status).toBe(200);

      const payload = (await response.json()) as {
        items: Array<{ runId: string }>;
      };

      expect(payload.items.map((run) => run.runId)).toEqual([
        "sw-api-new",
        "sw-api-old",
      ]);
    } finally {
      await server.stop();
    }
  });

  test("obs01-s2: GET /api/commands returns empty list + warning when events.jsonl is absent", async () => {
    const repoRoot = await createTempRepo();
    await seedApiFixture(repoRoot);
    await rm(join(repoRoot, ".agentix", "events.jsonl"), { force: true });

    const server = await startServer(repoRoot);
    try {
      const response = await fetch(`${server.baseUrl}/api/commands`);
      expect(response.status).toBe(200);

      const payload = (await response.json()) as {
        items: unknown[];
        meta: { warnings: string[] };
      };

      expect(payload.items).toEqual([]);
      expect(payload.meta.warnings).toContain("events.jsonl is missing");
    } finally {
      await server.stop();
    }
  });

  test("obs01-s3: GET /api/runs/:runId/attempts includes start/end/state/duration fields", async () => {
    const repoRoot = await createTempRepo();
    await seedApiFixture(repoRoot);

    const server = await startServer(repoRoot);
    try {
      const response = await fetch(
        `${server.baseUrl}/api/runs/sw-api-new/attempts?limit=25&offset=0`,
      );
      expect(response.status).toBe(200);

      const payload = (await response.json()) as {
        items: Array<{
          state: string;
          startedAt: string | null;
          finishedAt: string | null;
          durationMs: number | null;
        }>;
      };

      expect(payload.items).toHaveLength(1);
      expect(payload.items[0]).toMatchObject({
        state: "finished",
        durationMs: 1100,
      });
      expect(payload.items[0]?.startedAt).toContain("T");
      expect(payload.items[0]?.finishedAt).toContain("T");
    } finally {
      await server.stop();
    }
  });

  test("health endpoint reports local-first read-only mode", async () => {
    const repoRoot = await createTempRepo();
    await seedApiFixture(repoRoot);

    const server = await startServer(repoRoot);
    try {
      const response = await fetch(`${server.baseUrl}/api/health`);
      expect(response.status).toBe(200);

      const payload = (await response.json()) as {
        status: string;
        mode: string;
      };

      expect(payload.status).toBe("ok");
      expect(payload.mode).toBe("read-only");
    } finally {
      await server.stop();
    }
  });

  test("GET /api/runs/:runId/prompts returns prompt audit entries", async () => {
    const repoRoot = await createTempRepo();
    await seedApiFixture(repoRoot);

    const server = await startServer(repoRoot);
    try {
      const response = await fetch(
        `${server.baseUrl}/api/runs/sw-api-new/prompts?limit=20&offset=0`,
      );
      expect(response.status).toBe(200);

      const payload = (await response.json()) as {
        items: Array<{ nodeId: string; promptText: string; promptHash: string | null }>;
      };

      expect(payload.items).toHaveLength(1);
      expect(payload.items[0]?.nodeId).toBe("unit-obs:implement");
      expect(payload.items[0]?.promptText).toContain("Do X");
      expect(payload.items[0]?.promptHash).not.toBeNull();
    } finally {
      await server.stop();
    }
  });

  test("GET /api/runs/:runId/execution-steps returns normalized stage rows", async () => {
    const repoRoot = await createTempRepo();
    await seedApiFixture(repoRoot);

    const server = await startServer(repoRoot);
    try {
      const response = await fetch(
        `${server.baseUrl}/api/runs/sw-api-new/execution-steps?limit=20&offset=0`,
      );
      expect(response.status).toBe(200);

      const payload = (await response.json()) as {
        items: Array<{ unitId: string; stage: string; nodeId: string; promptAvailable: boolean }>;
      };

      expect(payload.items).toHaveLength(1);
      expect(payload.items[0]).toMatchObject({
        unitId: "unit-obs",
        stage: "implement",
        nodeId: "unit-obs:implement",
        promptAvailable: true,
      });
    } finally {
      await server.stop();
    }
  });

  test("GET /api/runs/:runId/timeline returns merged source categories", async () => {
    const repoRoot = await createTempRepo();
    await seedApiFixture(repoRoot);

    const server = await startServer(repoRoot);
    try {
      const response = await fetch(
        `${server.baseUrl}/api/runs/sw-api-new/timeline?limit=20&offset=0`,
      );
      expect(response.status).toBe(200);

      const payload = (await response.json()) as {
        items: Array<{ source: string; category: string }>;
      };

      expect(payload.items.map((entry) => entry.source)).toEqual([
        "resource",
        "telemetry",
        "agentix",
        "smithers",
      ]);
      expect(payload.items[0]?.category).toBe("resource");
    } finally {
      await server.stop();
    }
  });

  test("synthetic demo run routes are excluded from dashboard API", async () => {
    const repoRoot = await createTempRepo();
    await seedApiFixture(repoRoot);

    const server = await startServer(repoRoot);
    try {
      const details = await fetch(`${server.baseUrl}/api/runs/sw-dashboard-demo`);
      expect(details.status).toBe(404);

      const nodes = await fetch(
        `${server.baseUrl}/api/runs/sw-dashboard-demo/nodes?limit=20&offset=0`,
      );
      expect(nodes.status).toBe(404);

      const stream = await fetch(
        `${server.baseUrl}/api/stream?runId=sw-dashboard-demo&afterSeq=0`,
      );
      expect(stream.status).toBe(404);
    } finally {
      await server.stop();
    }
  });
});
