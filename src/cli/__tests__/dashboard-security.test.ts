import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { startDashboardApiServer } from "../dashboard-api";

const tempRepos: string[] = [];

async function createTempRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "agentix-dashboard-security-"));
  tempRepos.push(repo);
  await mkdir(join(repo, ".agentix"), { recursive: true });
  return repo;
}

async function seedSecurityFixture(repoRoot: string): Promise<void> {
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

    CREATE TABLE _smithers_events (
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
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

  db.prepare(
    `INSERT INTO _smithers_runs (run_id, workflow_name, workflow_path, status, created_at_ms, started_at_ms, finished_at_ms, error_json, config_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "sw-security",
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
    `INSERT INTO _smithers_events (run_id, seq, timestamp_ms, type, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    "sw-security",
    1,
    1_900_000_000_020,
    "NodeOutput",
    JSON.stringify({
      nodeId: "obs-09:attempt",
      iteration: 0,
      attempt: 1,
      stream: "stderr",
      text: "token=sk-abcdef1234567890abcdef1234567890",
    }),
  );

  db.prepare(
    `INSERT INTO _smithers_attempts (run_id, node_id, iteration, attempt, state, started_at_ms, finished_at_ms, error_json, jj_pointer, response_text, jj_cwd, cached, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "sw-security",
    "obs-09:implement",
    0,
    1,
    "finished",
    1_900_000_000_030,
    1_900_000_000_090,
    null,
    "@-",
    "ok",
    "/tmp/wt",
    0,
    JSON.stringify({
      prompt: "Use token=sk-abcdef1234567890abcdef1234567890 in setup",
    }),
  );

  db.close();
}

afterEach(async () => {
  await Promise.all(
    tempRepos.splice(0).map((repo) => rm(repo, { recursive: true, force: true })),
  );
});

describe("dashboard security", () => {
  test("obs09-s2: secret-like strings are redacted in API output", async () => {
    const repoRoot = await createTempRepo();
    await seedSecurityFixture(repoRoot);

    const server = await startDashboardApiServer({
      repoRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const response = await fetch(
        `${server.baseUrl}/api/runs/sw-security/logs?limit=20&offset=0&stream=stderr`,
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        items: Array<{ text: string }>;
      };

      expect(payload.items).toHaveLength(1);
      expect(payload.items[0]?.text).toContain("[REDACTED]");
      expect(payload.items[0]?.text).not.toContain("sk-abcdef");
    } finally {
      await server.stop();
    }
  });

  test("api token blocks unauthenticated access when configured", async () => {
    const repoRoot = await createTempRepo();
    await seedSecurityFixture(repoRoot);

    const server = await startDashboardApiServer({
      repoRoot,
      host: "127.0.0.1",
      port: 0,
      apiToken: "secret-token",
    });

    try {
      const unauthenticated = await fetch(`${server.baseUrl}/api/health`);
      expect(unauthenticated.status).toBe(401);

      const authenticated = await fetch(`${server.baseUrl}/api/health?token=secret-token`);
      expect(authenticated.status).toBe(200);
    } finally {
      await server.stop();
    }
  });

  test("prompt audit endpoints redact secret-like prompt values", async () => {
    const repoRoot = await createTempRepo();
    await seedSecurityFixture(repoRoot);

    const server = await startDashboardApiServer({
      repoRoot,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const response = await fetch(
        `${server.baseUrl}/api/runs/sw-security/prompts?limit=20&offset=0`,
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        items: Array<{ promptText: string }>;
      };

      expect(payload.items).toHaveLength(1);
      expect(payload.items[0]?.promptText).toContain("[REDACTED]");
      expect(payload.items[0]?.promptText).not.toContain("sk-abcdef");
    } finally {
      await server.stop();
    }
  });
});
