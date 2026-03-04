import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
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

  db.close();
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
});
