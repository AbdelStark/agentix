import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { appendAgentixEvent } from "./events";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function mkTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agentix-events-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("appendAgentixEvent", () => {
  test("appends structured JSON lines and creates directory if needed", async () => {
    const root = await mkTempDir();
    const agentixDir = join(root, ".agentix");

    await appendAgentixEvent(agentixDir, {
      level: "info",
      event: "command.started",
      command: "plan",
      details: { repoRoot: "/repo" },
    });
    await appendAgentixEvent(agentixDir, {
      level: "error",
      event: "command.failed",
      command: "plan",
      details: { reason: "missing-rfc" },
    });

    const raw = await readFile(join(agentixDir, "events.jsonl"), "utf8");
    const lines = raw.trim().split("\n");

    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]) as {
      schemaVersion?: number;
      ts: string;
      level: string;
      event: string;
      command: string;
      details: Record<string, unknown>;
    };
    const second = JSON.parse(lines[1]) as typeof first;

    expect(first.schemaVersion).toBe(2);
    expect(first.ts.length).toBeGreaterThan(0);
    expect(first.level).toBe("info");
    expect(first.event).toBe("command.started");
    expect(first.command).toBe("plan");
    expect(first.details.repoRoot).toBe("/repo");

    expect(second.level).toBe("error");
    expect(second.event).toBe("command.failed");
    expect(second.details.reason).toBe("missing-rfc");
  });
});
