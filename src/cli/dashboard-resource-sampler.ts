import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import os from "node:os";

export type ResourceSamplerRecord = {
  runId: string;
  nodeId: string | null;
  timestampMs: number;
  timestamp: string;
  cpuPercent: number | null;
  memoryRssMb: number | null;
  metadata: Record<string, unknown>;
};

export type DashboardResourceSamplerOptions = {
  agentixDir: string;
  runId: string;
  nodeId?: string | null;
  intervalMs?: number;
  enabled?: boolean;
  onWarning?: (message: string) => void;
};

type CpuUsageFn = (previousValue?: NodeJS.CpuUsage) => NodeJS.CpuUsage;

type SamplerDeps = {
  now?: () => number;
  memoryUsage?: () => NodeJS.MemoryUsage;
  cpuUsage?: CpuUsageFn;
  appendLine?: (path: string, line: string) => Promise<void>;
  cpuCount?: () => number;
};

const DEFAULT_INTERVAL_MS = 2_000;

function defaultAppendLine(path: string, line: string): Promise<void> {
  return appendFile(path, line, "utf8");
}

export class DashboardResourceSampler {
  private readonly opts: DashboardResourceSamplerOptions;
  private readonly deps: Required<SamplerDeps>;
  private readonly outputPath: string;
  private timer: Timer | null;
  private previousCpu: NodeJS.CpuUsage | null;
  private previousTimestampMs: number;
  private writeQueue: Promise<void>;

  constructor(opts: DashboardResourceSamplerOptions, deps: SamplerDeps = {}) {
    this.opts = opts;
    const hasNow = Object.prototype.hasOwnProperty.call(deps, "now");
    const hasMemoryUsage = Object.prototype.hasOwnProperty.call(deps, "memoryUsage");
    const hasCpuUsage = Object.prototype.hasOwnProperty.call(deps, "cpuUsage");
    const hasAppendLine = Object.prototype.hasOwnProperty.call(deps, "appendLine");
    const hasCpuCount = Object.prototype.hasOwnProperty.call(deps, "cpuCount");
    this.deps = {
      now: hasNow ? (deps.now as any) : Date.now,
      memoryUsage: hasMemoryUsage
        ? (deps.memoryUsage as any)
        : process.memoryUsage.bind(process),
      cpuUsage: hasCpuUsage ? (deps.cpuUsage as any) : process.cpuUsage.bind(process),
      appendLine: hasAppendLine ? (deps.appendLine as any) : defaultAppendLine,
      cpuCount: hasCpuCount
        ? (deps.cpuCount as any)
        : (() => Math.max(1, os.cpus()?.length ?? 1)),
    };
    this.outputPath = join(opts.agentixDir, "resource-samples.jsonl");
    this.timer = null;
    this.previousCpu = null;
    this.previousTimestampMs = this.deps.now();
    this.writeQueue = Promise.resolve();
  }

  get path(): string {
    return this.outputPath;
  }

  start(): { started: boolean; reason: string | null } {
    if (this.opts.enabled === false) {
      return { started: false, reason: "disabled" };
    }

    if (typeof this.deps.cpuUsage !== "function" || typeof this.deps.memoryUsage !== "function") {
      this.opts.onWarning?.("Resource sampler unavailable on this runtime; continuing without samples.");
      return { started: false, reason: "unsupported-runtime" };
    }

    if (this.timer) {
      return { started: true, reason: null };
    }

    const intervalMs = Number.isFinite(this.opts.intervalMs)
      ? Math.max(250, Math.floor(this.opts.intervalMs as number))
      : DEFAULT_INTERVAL_MS;

    this.previousCpu = this.deps.cpuUsage();
    this.previousTimestampMs = this.deps.now();
    this.sample().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.opts.onWarning?.(`resource sampler write failure: ${message}`);
    });

    this.timer = setInterval(() => {
      this.sample().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.opts.onWarning?.(`resource sampler write failure: ${message}`);
      });
    }, intervalMs);

    return { started: true, reason: null };
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.writeQueue;
  }

  private async sample(): Promise<void> {
    const nowMs = this.deps.now();
    const elapsedMs = Math.max(1, nowMs - this.previousTimestampMs);

    const currentCpu = this.deps.cpuUsage();
    const previousCpu = this.previousCpu ?? currentCpu;
    const deltaUserUs = Math.max(0, currentCpu.user - previousCpu.user);
    const deltaSystemUs = Math.max(0, currentCpu.system - previousCpu.system);
    const cpuCount = Math.max(1, this.deps.cpuCount());
    const cpuPercent = Number(
      (((deltaUserUs + deltaSystemUs) / 1000 / elapsedMs / cpuCount) * 100).toFixed(3),
    );

    this.previousCpu = currentCpu;
    this.previousTimestampMs = nowMs;

    const memory = this.deps.memoryUsage();
    const memoryRssMb = Number((memory.rss / (1024 * 1024)).toFixed(3));

    const record: ResourceSamplerRecord = {
      runId: this.opts.runId,
      nodeId: this.opts.nodeId ?? null,
      timestampMs: nowMs,
      timestamp: new Date(nowMs).toISOString(),
      cpuPercent,
      memoryRssMb,
      metadata: {
        pid: process.pid,
        platform: process.platform,
      },
    };

    const line = JSON.stringify(record) + "\n";
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.outputPath), { recursive: true });
      await this.deps.appendLine(this.outputPath, line);
    });
    await this.writeQueue;
  }
}

export function createDashboardResourceSampler(
  opts: DashboardResourceSamplerOptions,
  deps: SamplerDeps = {},
): DashboardResourceSampler {
  return new DashboardResourceSampler(opts, deps);
}
