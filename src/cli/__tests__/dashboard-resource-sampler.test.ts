import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createDashboardResourceSampler,
  type ResourceSamplerRecord,
} from "../dashboard-resource-sampler";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempAgentixDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agentix-resource-sampler-"));
  tempDirs.push(dir);
  return dir;
}

describe("dashboard resource sampler", () => {
  test("obs08b-s2: sampler persists periodic cpu/memory samples", async () => {
    const agentixDir = await createTempAgentixDir();

    let nowMs = 1_900_000_000_000;
    let cpuUser = 100_000;
    let cpuSystem = 50_000;

    const sampler = createDashboardResourceSampler(
      {
        agentixDir,
        runId: "sw-resource",
        nodeId: "obs-08b:implement",
        intervalMs: 10,
      },
      {
        now: () => {
          nowMs += 20;
          return nowMs;
        },
        cpuUsage: () => {
          cpuUser += 15_000;
          cpuSystem += 5_000;
          return { user: cpuUser, system: cpuSystem };
        },
        memoryUsage: () =>
          ({
            rss: 210 * 1024 * 1024,
            heapTotal: 30 * 1024 * 1024,
            heapUsed: 18 * 1024 * 1024,
            external: 2 * 1024 * 1024,
            arrayBuffers: 1 * 1024 * 1024,
          }) as NodeJS.MemoryUsage,
      },
    );

    const status = sampler.start();
    expect(status).toEqual({ started: true, reason: null });

    await Bun.sleep(65);
    await sampler.stop();

    const raw = await readFile(sampler.path, "utf8");
    const rows = raw.trim().split("\n").filter(Boolean);
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const first = JSON.parse(rows[0]!) as ResourceSamplerRecord;
    expect(first.runId).toBe("sw-resource");
    expect(first.nodeId).toBe("obs-08b:implement");
    expect(first.cpuPercent).toBeGreaterThan(0);
    expect(first.memoryRssMb).toBe(210);
  });

  test("obs08b-s3: unsupported sampler dependencies warn and workflow continues", async () => {
    const agentixDir = await createTempAgentixDir();
    const warnings: string[] = [];

    const sampler = createDashboardResourceSampler(
      {
        agentixDir,
        runId: "sw-resource-unsupported",
        enabled: true,
        onWarning: (message) => warnings.push(message),
      },
      {
        cpuUsage: null as unknown as any,
        memoryUsage: null as unknown as any,
      },
    );

    const status = sampler.start();
    expect(status.started).toBe(false);
    expect(status.reason).toBe("unsupported-runtime");
    expect(warnings.some((warning) => warning.includes("continuing without samples"))).toBe(true);

    await sampler.stop();
  });
});
