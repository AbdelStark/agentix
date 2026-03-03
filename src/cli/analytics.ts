import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_ANALYTICS_WINDOW = "7d";
export const DEFAULT_FAILURE_TOP = 10;

export type FailureTaxonomy =
  | "config"
  | "environment"
  | "schema"
  | "tests"
  | "merge"
  | "policy"
  | "infra"
  | "unknown";

export type AnalyticsRecommendation = {
  id: string;
  priority: "high" | "medium" | "low";
  category: "prompt" | "skill" | "policy" | "operations";
  insight: string;
  action: string;
};

type Lifecycle = "started" | "completed" | "failed" | "cancelled";

type NormalizedEvent = {
  ts: string;
  timestampMs: number;
  schemaVersion: number;
  event: string;
  command: string;
  lifecycle: Lifecycle | null;
  runId?: string;
  sessionId?: string;
  unitId?: string;
  reason?: string;
  message?: string;
  durationMs?: number;
  resumeRunId?: string;
  mode?: string;
  exitCode?: number;
};

export type AnalyticsSummary = {
  generatedAt: string;
  window: {
    label: string;
    start: string;
    end: string;
  };
  source: {
    eventsPath: string | null;
    parsedEvents: number;
    malformedLines: number;
    droppedEvents: number;
    schemaVersions: Record<string, number>;
    excludedCommands: string[];
  };
  totals: {
    started: number;
    completed: number;
    failed: number;
    cancelled: number;
    terminal: number;
    successRate: number;
    failureRate: number;
    cancellationRate: number;
  };
  durationsMs: {
    samples: number;
    median: number;
    p95: number;
  };
  commands: Record<
    string,
    {
      started: number;
      completed: number;
      failed: number;
      cancelled: number;
      terminal: number;
      successRate: number;
      failureRate: number;
      cancellationRate: number;
      medianDurationMs: number;
      p95DurationMs: number;
    }
  >;
  failures: {
    taxonomy: Record<FailureTaxonomy, number>;
    topByCommand: Array<{
      command: string;
      reason: string;
      taxonomy: FailureTaxonomy;
      count: number;
    }>;
  };
  runStability: {
    runStarts: number;
    resumedRuns: number;
    resumeRate: number;
    nonZeroExitCount: number;
  };
  trends: {
    daily: Array<{
      date: string;
      started: number;
      completed: number;
      failed: number;
      cancelled: number;
    }>;
  };
  recommendations: AnalyticsRecommendation[];
};

type WindowBounds = {
  label: string;
  startMs: number;
  endMs: number;
  start: string;
  end: string;
};

type AnalyzeTelemetryOptions = {
  now?: Date;
  window?: string;
  topFailures?: number;
  eventsPath?: string | null;
  excludeSessionId?: string;
  excludeCommands?: string[];
};

type ParseResult = {
  events: NormalizedEvent[];
  malformedLines: number;
  droppedEvents: number;
  schemaVersions: Record<string, number>;
};

const LIFECYCLE_BY_EVENT: Record<string, Lifecycle> = {
  "command.started": "started",
  "command.completed": "completed",
  "command.failed": "failed",
  "command.cancelled": "cancelled",
};

const TAXONOMY_KEYS: FailureTaxonomy[] = [
  "config",
  "environment",
  "schema",
  "tests",
  "merge",
  "policy",
  "infra",
  "unknown",
];

export function parseWindow(window: string, now = new Date()): WindowBounds {
  const trimmed = window.trim().toLowerCase();
  const match = /^(\d+)([dhm])$/.exec(trimmed);
  if (!match) {
    throw new Error(
      `Invalid window: ${window}. Expected formats like 7d, 24h, or 30m.`,
    );
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid window duration: ${window}`);
  }

  const factorMs = unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
  const endMs = now.getTime();
  const startMs = endMs - amount * factorMs;

  return {
    label: trimmed,
    startMs,
    endMs,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  };
}

export function classifyFailureTaxonomy(
  reason: string,
  message?: string,
): FailureTaxonomy {
  const source = `${reason} ${message ?? ""}`.toLowerCase();

  if (
    /(missing-config|missing-rfc|missing-rfc-path|rfc-not-found|missing-work-plan|missing-workflow-file|missing-db-for-resume|missing-workflow-db|missing-run-id|unsupported-mode|invalid-window|invalid-analytics-args|unknown-analytics-action)/.test(
      source,
    )
  ) {
    return "config";
  }

  if (/(missing-smithers-cli|no-supported-agents|missing-cli|not-installed)/.test(source)) {
    return "environment";
  }

  if (/(schema|parse|validation|invalid-event|malformed-jsonl)/.test(source)) {
    return "schema";
  }

  if (/(test|typecheck|lint|check-failed|failing)/.test(source)) {
    return "tests";
  }

  if (/(merge|rebase|conflict|evict)/.test(source)) {
    return "merge";
  }

  if (/(policy|severity|compliance|governance|threshold)/.test(source)) {
    return "policy";
  }

  if (/(infra|timeout|sqlite|database|network|exit-non-zero|workflow-exit-non-zero)/.test(source)) {
    return "infra";
  }

  return "unknown";
}

export function analyzeTelemetryFromJsonl(
  raw: string,
  opts: AnalyzeTelemetryOptions = {},
): AnalyticsSummary {
  const now = opts.now ?? new Date();
  const topFailures =
    Number.isFinite(opts.topFailures) && (opts.topFailures as number) > 0
      ? Math.floor(opts.topFailures as number)
      : DEFAULT_FAILURE_TOP;
  const window = parseWindow(opts.window ?? DEFAULT_ANALYTICS_WINDOW, now);
  const excludedCommands = normalizeCommandFilters(opts.excludeCommands);

  const parsed = parseJsonlEvents(raw, {
    excludeSessionId: opts.excludeSessionId,
    excludeCommands: excludedCommands,
  });
  const windowed = parsed.events.filter(
    (event) => event.timestampMs >= window.startMs && event.timestampMs <= window.endMs,
  );

  const totals = {
    started: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    terminal: 0,
    successRate: 0,
    failureRate: 0,
    cancellationRate: 0,
  };

  const globalDurations: number[] = [];
  const commandStats = new Map<
    string,
    {
      started: number;
      completed: number;
      failed: number;
      cancelled: number;
      terminal: number;
      durations: number[];
    }
  >();

  const taxonomyCounts = createTaxonomyCountMap();
  const failureCounts = new Map<string, { command: string; reason: string; taxonomy: FailureTaxonomy; count: number }>();

  let runStarts = 0;
  let resumedRuns = 0;
  let nonZeroExitCount = 0;

  const dailyTrendMap = new Map<string, { started: number; completed: number; failed: number; cancelled: number }>();

  for (const event of windowed) {
    if (!event.lifecycle) continue;

    const command = event.command;
    const stats = getOrInitCommandStats(commandStats, command);

    totals[event.lifecycle] += 1;
    stats[event.lifecycle] += 1;

    const date = event.ts.slice(0, 10);
    const daily = getOrInitDaily(dailyTrendMap, date);
    daily[event.lifecycle] += 1;

    if (event.command === "run" && event.lifecycle === "started") {
      runStarts += 1;
      if (event.resumeRunId) resumedRuns += 1;
    }

    if (isTerminal(event.lifecycle)) {
      totals.terminal += 1;
      stats.terminal += 1;

      if (typeof event.durationMs === "number" && Number.isFinite(event.durationMs)) {
        const normalizedDuration = Math.max(0, Math.round(event.durationMs));
        globalDurations.push(normalizedDuration);
        stats.durations.push(normalizedDuration);
      }
    }

    if (event.command === "run" && isNonZeroExit(event)) {
      nonZeroExitCount += 1;
    }

    if (event.lifecycle === "failed") {
      const reason = normalizeFailureReason(event.reason, event.message);
      const taxonomy = classifyFailureTaxonomy(reason, event.message);
      taxonomyCounts[taxonomy] += 1;

      const key = `${command}::${reason}`;
      const current = failureCounts.get(key);
      if (current) {
        current.count += 1;
      } else {
        failureCounts.set(key, {
          command,
          reason,
          taxonomy,
          count: 1,
        });
      }
    }
  }

  totals.successRate = rate(totals.completed, totals.terminal);
  totals.failureRate = rate(totals.failed, totals.terminal);
  totals.cancellationRate = rate(totals.cancelled, totals.terminal);

  const commands = buildCommandSummary(commandStats);
  const topByCommand = Array.from(failureCounts.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.command !== b.command) return a.command.localeCompare(b.command);
      return a.reason.localeCompare(b.reason);
    })
    .slice(0, topFailures);

  const summary: AnalyticsSummary = {
    generatedAt: now.toISOString(),
    window: {
      label: window.label,
      start: window.start,
      end: window.end,
    },
    source: {
      eventsPath: opts.eventsPath ?? null,
      parsedEvents: windowed.length,
      malformedLines: parsed.malformedLines,
      droppedEvents: parsed.droppedEvents,
      schemaVersions: parsed.schemaVersions,
      excludedCommands,
    },
    totals,
    durationsMs: {
      samples: globalDurations.length,
      median: median(globalDurations),
      p95: percentile(globalDurations, 0.95),
    },
    commands,
    failures: {
      taxonomy: taxonomyCounts,
      topByCommand,
    },
    runStability: {
      runStarts,
      resumedRuns,
      resumeRate: rate(resumedRuns, runStarts),
      nonZeroExitCount,
    },
    trends: {
      daily: Array.from(dailyTrendMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, counts]) => ({ date, ...counts })),
    },
    recommendations: [],
  };

  summary.recommendations = deriveRecommendations(summary);

  return summary;
}

export async function analyzeTelemetryFile(opts: {
  repoRoot: string;
  now?: Date;
  window?: string;
  topFailures?: number;
  excludeSessionId?: string;
  excludeCommands?: string[];
}): Promise<{ summary: AnalyticsSummary; eventsPath: string }> {
  const eventsPath = join(opts.repoRoot, ".agentix", "events.jsonl");
  const raw = existsSync(eventsPath)
    ? await readFile(eventsPath, "utf8")
    : "";

  const summary = analyzeTelemetryFromJsonl(raw, {
    now: opts.now,
    window: opts.window,
    topFailures: opts.topFailures,
    eventsPath,
    excludeSessionId: opts.excludeSessionId,
    excludeCommands: opts.excludeCommands,
  });

  return { summary, eventsPath };
}

export async function writeDailySnapshot(
  agentixDir: string,
  summary: AnalyticsSummary,
  opts: { now?: Date } = {},
): Promise<string> {
  const now = opts.now ?? new Date(summary.generatedAt);
  const date = now.toISOString().slice(0, 10);
  const analyticsDir = join(agentixDir, "analytics");
  const snapshotPath = join(analyticsDir, `daily-${date}.json`);

  await mkdir(analyticsDir, { recursive: true });
  await writeFile(snapshotPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

  return snapshotPath;
}

export function renderQualityReport(summary: AnalyticsSummary): string {
  const lines: string[] = [];

  lines.push("# Quality Report");
  lines.push("");
  lines.push(`- Generated: ${summary.generatedAt}`);
  lines.push(`- Window: ${summary.window.label} (${summary.window.start} -> ${summary.window.end})`);
  lines.push("");

  lines.push("## Core Metrics");
  lines.push("");
  lines.push(`- Parsed events: ${summary.source.parsedEvents}`);
  lines.push(`- Malformed lines: ${summary.source.malformedLines}`);
  lines.push(`- Dropped events: ${summary.source.droppedEvents}`);
  lines.push(`- Success rate: ${toPercent(summary.totals.successRate)}`);
  lines.push(`- Failure rate: ${toPercent(summary.totals.failureRate)}`);
  lines.push(`- Cancellation rate: ${toPercent(summary.totals.cancellationRate)}`);
  lines.push(`- Median duration: ${summary.durationsMs.median}ms`);
  lines.push(`- P95 duration: ${summary.durationsMs.p95}ms`);
  lines.push(`- Run resume rate: ${toPercent(summary.runStability.resumeRate)}`);
  lines.push(`- Run non-zero exits: ${summary.runStability.nonZeroExitCount}`);
  lines.push("");

  lines.push("## Top Failure Reasons");
  lines.push("");
  if (summary.failures.topByCommand.length === 0) {
    lines.push("- None in selected window.");
  } else {
    for (const failure of summary.failures.topByCommand) {
      lines.push(
        `- ${failure.command}: ${failure.reason} (${failure.count}) [${failure.taxonomy}]`,
      );
    }
  }
  lines.push("");

  lines.push("## Failure Taxonomy");
  lines.push("");
  for (const taxonomy of TAXONOMY_KEYS) {
    lines.push(`- ${taxonomy}: ${summary.failures.taxonomy[taxonomy]}`);
  }
  lines.push("");

  lines.push("## Prompt/Skill Improvement Candidates");
  lines.push("");
  for (const recommendation of summary.recommendations) {
    lines.push(
      `- [${recommendation.priority.toUpperCase()}] (${recommendation.category}) ${recommendation.insight} -> ${recommendation.action}`,
    );
  }
  lines.push("");

  lines.push("## Ownership + Next Actions");
  lines.push("");
  lines.push("- Owner: release coordinator + domain maintainers");
  lines.push("- Cadence: weekly telemetry review or before tagged release");
  lines.push("- Gate: unresolved high-priority recurring failures must have mitigation owner");
  lines.push("");

  return lines.join("\n");
}

export async function writeQualityReport(
  repoRoot: string,
  markdown: string,
): Promise<string> {
  const opsDir = join(repoRoot, "docs", "ops");
  const reportPath = join(opsDir, "quality-report.md");

  await mkdir(opsDir, { recursive: true });
  await writeFile(reportPath, markdown.trimEnd() + "\n", "utf8");

  return reportPath;
}

function parseJsonlEvents(
  raw: string,
  opts: { excludeSessionId?: string; excludeCommands?: string[] } = {},
): ParseResult {
  const lines = raw.split(/\r?\n/);
  const events: NormalizedEvent[] = [];
  let malformedLines = 0;
  let droppedEvents = 0;
  const schemaVersions = new Map<string, number>();
  const excludedCommandSet = new Set(
    (opts.excludeCommands ?? []).map((command) => command.toLowerCase()),
  );

  for (const line of lines) {
    if (!line.trim()) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformedLines += 1;
      continue;
    }

    const normalized = normalizeEvent(parsed);
    if (!normalized) {
      droppedEvents += 1;
      continue;
    }

    if (opts.excludeSessionId && normalized.sessionId === opts.excludeSessionId) {
      continue;
    }

    if (excludedCommandSet.has(normalized.command.toLowerCase())) {
      continue;
    }

    const schemaKey = String(normalized.schemaVersion);
    schemaVersions.set(schemaKey, (schemaVersions.get(schemaKey) ?? 0) + 1);
    events.push(normalized);
  }

  events.sort((a, b) => {
    if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs;
    if (a.command !== b.command) return a.command.localeCompare(b.command);
    return a.event.localeCompare(b.event);
  });

  return {
    events,
    malformedLines,
    droppedEvents,
    schemaVersions: Object.fromEntries(
      Array.from(schemaVersions.entries()).sort((a, b) =>
        a[0].localeCompare(b[0]),
      ),
    ),
  };
}

function normalizeEvent(value: unknown): NormalizedEvent | null {
  const object = asRecord(value);
  if (!object) return null;

  const ts = typeof object.ts === "string" ? object.ts : null;
  const event = typeof object.event === "string" ? object.event : null;
  const command = typeof object.command === "string" ? object.command : null;

  if (!ts || !event || !command) return null;

  const timestampMs = new Date(ts).getTime();
  if (!Number.isFinite(timestampMs)) return null;

  const details = asRecord(object.details);
  const reason = asString(details?.reason);
  const message = asString(details?.message);

  const schemaVersionRaw = object.schemaVersion;
  const schemaVersion =
    typeof schemaVersionRaw === "number" && Number.isFinite(schemaVersionRaw)
      ? Math.max(1, Math.floor(schemaVersionRaw))
      : 1;

  return {
    ts,
    timestampMs,
    schemaVersion,
    event,
    command,
    lifecycle: LIFECYCLE_BY_EVENT[event] ?? null,
    runId: asString(object.runId),
    sessionId: asString(object.sessionId),
    unitId: asString(object.unitId),
    reason,
    message,
    durationMs: asNumber(details?.durationMs),
    resumeRunId: asString(details?.resumeRunId),
    mode: asString(details?.mode),
    exitCode: asNumber(details?.exitCode),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function normalizeCommandFilters(commands?: string[]): string[] {
  if (!commands || commands.length === 0) return [];

  const normalized = commands
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

function isTerminal(lifecycle: Lifecycle): boolean {
  return (
    lifecycle === "completed" ||
    lifecycle === "failed" ||
    lifecycle === "cancelled"
  );
}

function getOrInitCommandStats(
  map: Map<
    string,
    {
      started: number;
      completed: number;
      failed: number;
      cancelled: number;
      terminal: number;
      durations: number[];
    }
  >,
  command: string,
): {
  started: number;
  completed: number;
  failed: number;
  cancelled: number;
  terminal: number;
  durations: number[];
} {
  const current = map.get(command);
  if (current) return current;

  const created = {
    started: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    terminal: 0,
    durations: [],
  };
  map.set(command, created);
  return created;
}

function buildCommandSummary(
  commandStats: Map<
    string,
    {
      started: number;
      completed: number;
      failed: number;
      cancelled: number;
      terminal: number;
      durations: number[];
    }
  >,
): AnalyticsSummary["commands"] {
  const commands = Array.from(commandStats.keys()).sort((a, b) =>
    a.localeCompare(b),
  );

  const output: AnalyticsSummary["commands"] = {};
  for (const command of commands) {
    const stats = commandStats.get(command);
    if (!stats) continue;

    output[command] = {
      started: stats.started,
      completed: stats.completed,
      failed: stats.failed,
      cancelled: stats.cancelled,
      terminal: stats.terminal,
      successRate: rate(stats.completed, stats.terminal),
      failureRate: rate(stats.failed, stats.terminal),
      cancellationRate: rate(stats.cancelled, stats.terminal),
      medianDurationMs: median(stats.durations),
      p95DurationMs: percentile(stats.durations, 0.95),
    };
  }

  return output;
}

function createTaxonomyCountMap(): Record<FailureTaxonomy, number> {
  return {
    config: 0,
    environment: 0,
    schema: 0,
    tests: 0,
    merge: 0,
    policy: 0,
    infra: 0,
    unknown: 0,
  };
}

function getOrInitDaily(
  map: Map<string, { started: number; completed: number; failed: number; cancelled: number }>,
  date: string,
): { started: number; completed: number; failed: number; cancelled: number } {
  const current = map.get(date);
  if (current) return current;

  const created = {
    started: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  map.set(date, created);
  return created;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[Math.min(rank, sorted.length - 1)];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function normalizeFailureReason(reason?: string, message?: string): string {
  if (reason) {
    return reason.toLowerCase().replace(/\s+/g, "-");
  }

  const source = (message ?? "").toLowerCase();
  if (source.includes("exited with code")) return "workflow-exit-non-zero";
  if (source.includes("timeout")) return "workflow-timeout";
  if (source.includes("schema")) return "invalid-event-schema";

  return "unknown-error";
}

function rate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function toPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function isNonZeroExit(event: NormalizedEvent): boolean {
  if (event.lifecycle === "completed" && typeof event.exitCode === "number") {
    return event.exitCode > 0;
  }

  if (event.lifecycle === "failed") {
    if (event.reason && /non-zero|exit/.test(event.reason)) {
      return true;
    }
    if (!event.message) return false;
    const match = /exited with code\s+(\d+)/i.exec(event.message);
    if (!match) return false;
    const code = Number(match[1]);
    return Number.isFinite(code) && code > 0;
  }

  return false;
}

function deriveRecommendations(summary: AnalyticsSummary): AnalyticsRecommendation[] {
  const recommendations: AnalyticsRecommendation[] = [];

  if (summary.source.malformedLines > 0 || summary.source.droppedEvents > 0) {
    recommendations.push({
      id: "telemetry-schema-hardening",
      priority: "high",
      category: "operations",
      insight: `Telemetry parser dropped ${summary.source.malformedLines + summary.source.droppedEvents} lines.`,
      action:
        "Add schema-version validation in emitters and a pre-release telemetry sanity check to prevent observability blind spots.",
    });
  }

  if (summary.failures.topByCommand.length > 0) {
    const top = summary.failures.topByCommand[0];
    recommendations.push({
      id: `top-failure-${top.command}-${top.reason}`,
      priority: top.count >= 3 ? "high" : "medium",
      category: "prompt",
      insight: `Top recurring failure is ${top.command}:${top.reason} (${top.count} occurrences).`,
      action:
        `Refine the ${top.command} command prompt/guardrails with a preflight checklist for ${top.reason} and explicit remediation steps.`,
    });

    recommendations.push({
      id: `skill-candidate-${top.taxonomy}`,
      priority: "medium",
      category: "skill",
      insight: `Failure taxonomy is currently led by ${top.taxonomy}.`,
      action:
        `Create or update a focused ${top.taxonomy}-recovery skill with deterministic detection + fix scripts for common ${top.command} failures.`,
    });
  }

  if (summary.runStability.resumeRate >= 0.25) {
    recommendations.push({
      id: "resume-rate-reduction",
      priority: "medium",
      category: "operations",
      insight: `Run resume frequency is ${toPercent(summary.runStability.resumeRate)}.`,
      action:
        "Investigate top resume causes and add early-fail checks so workflows fail fast before long-running execution.",
    });
  }

  if (summary.runStability.nonZeroExitCount > 0) {
    recommendations.push({
      id: "non-zero-run-exits",
      priority: "high",
      category: "policy",
      insight: `${summary.runStability.nonZeroExitCount} run command(s) ended with non-zero exit.`,
      action:
        "Add a release gate requiring explicit mitigation notes for recurring non-zero workflow exits.",
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: "coverage-baseline",
      priority: "low",
      category: "prompt",
      insight: "No recurring failures detected in the selected window.",
      action:
        "Update planning/testing prompts to require explicit telemetry checkpoints so weekly analytics keeps statistically meaningful signal volume.",
    });
  }

  const hasPromptOrSkill = recommendations.some(
    (item) => item.category === "prompt" || item.category === "skill",
  );
  if (!hasPromptOrSkill) {
    recommendations.push({
      id: "prompt-telemetry-normalization",
      priority: "low",
      category: "prompt",
      insight:
        "Current analytics signals do not include a direct prompt/skill optimization candidate.",
      action:
        "Add an explicit prompt clause requiring deterministic `details.reason` emission and remediation hints for every command failure.",
    });
  }

  return recommendations;
}
