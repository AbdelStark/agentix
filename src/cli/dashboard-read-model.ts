import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, parse } from "node:path";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";

import type {
  DashboardAgentToolEvent,
  DashboardAnalyticsSnapshot,
  DashboardAttemptSnapshot,
  DashboardCommandEventSnapshot,
  DashboardExecutionStepSnapshot,
  DashboardListResponse,
  DashboardMergeRiskSnapshot,
  DashboardNodeEventSnapshot,
  DashboardNodeLogSnapshot,
  DashboardNodeSnapshot,
  DashboardPagination,
  DashboardReadModelSourceStatus,
  DashboardResourceSample,
  DashboardRunSnapshot,
  DashboardStageOutputSnapshot,
  DashboardTimelineCategory,
  DashboardTimelineEvent,
  DashboardTimelineSource,
  DashboardTraceArtifact,
  DashboardWorkPlan,
  DashboardWorkUnit,
  DashboardPromptAuditSnapshot,
} from "./dashboard-types";
import {
  parseClaudeTelemetryJsonLine,
  parseClaudeTelemetryEvent,
  type NormalizedClaudeTelemetryEvent,
} from "./dashboard-telemetry-adapters/claude";
import {
  parseCodexTelemetryJsonLine,
  parseCodexTelemetryEvent,
  type NormalizedCodexTelemetryEvent,
} from "./dashboard-telemetry-adapters/codex";

const STAGE_OUTPUT_TABLES = [
  "research",
  "plan",
  "implement",
  "test",
  "prd_review",
  "code_review",
  "security_review",
  "performance_review",
  "operational_review",
  "review_fix",
  "final_review",
  "policy_status",
  "pass_tracker",
  "completion_report",
  "merge_queue",
] as const;

type ReadModelOpts = {
  repoRoot: string;
};

type EventFilterOpts = DashboardPagination & {
  afterSeq?: number;
  beforeSeq?: number;
  nodeId?: string;
  type?: string;
  query?: string;
  fromTs?: number;
  toTs?: number;
};

type CommandFilterOpts = DashboardPagination & {
  afterLine?: number;
  command?: string;
  runId?: string;
  query?: string;
  fromTs?: number;
  toTs?: number;
};

type TimelineFilterOpts = DashboardPagination & {
  source?: DashboardTimelineSource;
  category?: DashboardTimelineCategory;
  query?: string;
  fromTs?: number;
  toTs?: number;
};

function toIso(timestampMs: number | null | undefined): string | null {
  if (!Number.isFinite(timestampMs)) return null;
  return new Date(Number(timestampMs)).toISOString();
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toPagination(opts?: Partial<DashboardPagination>): DashboardPagination {
  const rawLimit = Number(opts?.limit ?? 50);
  const rawOffset = Number(opts?.offset ?? 0);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(500, Math.floor(rawLimit)))
    : 50;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  return { limit, offset };
}

function safeTimestampFromIso(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function truncateText(value: string, limit: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, Math.max(0, limit - 1))}…`;
}

function toUnitStage(nodeId: string): {
  unitId: string | null;
  stage: string | null;
} {
  const normalized = String(nodeId ?? "").trim();
  if (!normalized.includes(":")) {
    return {
      unitId: normalized.length > 0 ? normalized : null,
      stage: null,
    };
  }

  const index = normalized.indexOf(":");
  const unitId = normalized.slice(0, index).trim();
  const stage = normalized.slice(index + 1).trim();
  return {
    unitId: unitId.length > 0 ? unitId : null,
    stage: stage.length > 0 ? stage : null,
  };
}

function extractPromptFromAttemptMeta(meta: Record<string, unknown> | null): string {
  if (!meta || typeof meta !== "object") return "";

  const directPrompt = meta.prompt;
  if (typeof directPrompt === "string" && directPrompt.trim()) {
    return directPrompt.trim();
  }

  const input = meta.input;
  if (input && typeof input === "object") {
    const prompt = (input as Record<string, unknown>).prompt;
    if (typeof prompt === "string" && prompt.trim()) {
      return prompt.trim();
    }
  }

  const messages = meta.messages;
  if (Array.isArray(messages)) {
    const latestUser = [...messages]
      .reverse()
      .find((entry) => {
        if (!entry || typeof entry !== "object") return false;
        const record = entry as Record<string, unknown>;
        return record.role === "user" || record.type === "user";
      }) as Record<string, unknown> | undefined;
    const content = latestUser?.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }
  }

  return "";
}

function hashPrompt(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function toErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") {
    const value = error.trim();
    return value.length > 0 ? value : null;
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
    try {
      const text = JSON.stringify(record);
      return text.length > 0 ? text : null;
    } catch {
      return null;
    }
  }
  return null;
}

function compareTimestampDesc(
  left: { timestampMs: number; eventKey: string },
  right: { timestampMs: number; eventKey: string },
): number {
  if (left.timestampMs !== right.timestampMs) {
    return right.timestampMs - left.timestampMs;
  }
  return right.eventKey.localeCompare(left.eventKey);
}

function parseMaybeJson(
  raw: unknown,
  warnings: string[],
  label: string,
): unknown {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (
    !(trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"'))
  ) {
    return raw;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    warnings.push(`Failed to parse ${label}`);
    return null;
  }
}

function serializeRowWithJsonParsing(
  row: Record<string, unknown>,
  warnings: string[],
  labelPrefix: string,
): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const label = `${labelPrefix}.${key}`;
    parsed[key] = parseMaybeJson(value, warnings, label);
  }
  return parsed;
}

function buildListResponse<T>(
  items: T[],
  total: number,
  pagination: DashboardPagination,
  warnings: string[],
): DashboardListResponse<T> {
  return {
    items,
    meta: {
      limit: pagination.limit,
      offset: pagination.offset,
      total,
      warnings,
    },
  };
}

function tableExists(db: Database, tableName: string): boolean {
  try {
    const row = db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(tableName) as { 1: number } | null;
    return !!row;
  } catch {
    return false;
  }
}

function normalizeCodexEvent(event: NormalizedCodexTelemetryEvent): DashboardAgentToolEvent {
  return {
    runId: event.runId,
    nodeId: event.nodeId,
    iteration: event.iteration,
    attempt: event.attempt,
    timestampMs: event.timestampMs,
    timestamp: new Date(event.timestampMs).toISOString(),
    provider: "codex",
    eventType: event.eventType,
    eventKey: event.eventKey,
    toolName: event.toolName,
    tokenUsage: event.tokenUsage,
    payload: event.payload,
  };
}

function normalizeClaudeEvent(event: NormalizedClaudeTelemetryEvent): DashboardAgentToolEvent {
  return {
    runId: event.runId,
    nodeId: event.nodeId,
    iteration: event.iteration,
    attempt: event.attempt,
    timestampMs: event.timestampMs,
    timestamp: new Date(event.timestampMs).toISOString(),
    provider: "claude",
    eventType: event.eventType,
    eventKey: event.eventKey,
    toolName: event.toolName,
    tokenUsage: event.tokenUsage,
    payload: event.payload,
  };
}

function buildSmithersSummary(event: DashboardNodeEventSnapshot): string {
  const payload = event.payload ?? {};
  const nodeId = typeof payload.nodeId === "string" ? payload.nodeId : null;
  if (event.type === "NodeOutput") {
    const text = typeof payload.text === "string" ? payload.text : "";
    const stream = payload.stream === "stderr" ? "stderr" : "stdout";
    return `${stream} ${nodeId ?? "node"} • ${truncateText(text, 96)}`;
  }
  if (nodeId) {
    return `${event.type} • ${nodeId}`;
  }
  return event.type;
}

function buildCommandSummary(event: DashboardCommandEventSnapshot): string {
  const reason =
    typeof event.details.reason === "string" ? ` • ${event.details.reason}` : "";
  return `${event.command} ${event.event}${reason}`;
}

function buildToolSummary(event: DashboardAgentToolEvent): string {
  const tool = event.toolName ? ` • ${event.toolName}` : "";
  const tokens =
    typeof event.tokenUsage.total === "number" ? ` • ${event.tokenUsage.total} tokens` : "";
  return `${event.provider} ${event.eventType}${tool}${tokens}`;
}

function buildResourceSummary(sample: DashboardResourceSample): string {
  const cpu = sample.cpuPercent == null ? "-" : `${sample.cpuPercent}%`;
  const mem = sample.memoryRssMb == null ? "-" : `${sample.memoryRssMb}MB`;
  return `cpu ${cpu} • rss ${mem}`;
}

export class DashboardReadModel {
  private readonly repoRoot: string;
  private readonly agentixDir: string;
  private readonly workflowDbPath: string;
  private readonly eventsPath: string;
  private readonly tracesDir: string;
  private readonly analyticsDir: string;
  private readonly telemetryDir: string;
  private readonly resourceSamplesPath: string;
  private readonly workPlanPath: string;

  constructor(opts: ReadModelOpts) {
    this.repoRoot = opts.repoRoot;
    this.agentixDir = join(opts.repoRoot, ".agentix");
    this.workflowDbPath = join(this.agentixDir, "workflow.db");
    this.eventsPath = join(this.agentixDir, "events.jsonl");
    this.workPlanPath = join(this.agentixDir, "work-plan.json");
    this.tracesDir = join(this.agentixDir, "generated", "traces");
    this.analyticsDir = join(this.agentixDir, "analytics");
    this.telemetryDir = join(this.agentixDir, "telemetry");
    this.resourceSamplesPath = join(this.agentixDir, "resource-samples.jsonl");
  }

  getSourceStatus(): DashboardReadModelSourceStatus {
    return {
      repoRoot: this.repoRoot,
      agentixDir: this.agentixDir,
      workflowDbPath: this.workflowDbPath,
      eventsPath: this.eventsPath,
      workPlanPath: this.workPlanPath,
      tracesDir: this.tracesDir,
      analyticsDir: this.analyticsDir,
      telemetryDir: this.telemetryDir,
      resourceSamplesPath: this.resourceSamplesPath,
    };
  }

  async getWorkPlan(): Promise<{
    workPlan: DashboardWorkPlan | null;
    warnings: string[];
  }> {
    const warnings: string[] = [];

    if (!existsSync(this.workPlanPath)) {
      warnings.push("work-plan.json is missing");
      return { workPlan: null, warnings };
    }

    let raw = "";
    try {
      raw = await readFile(this.workPlanPath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to read work-plan.json: ${message}`);
      return { workPlan: null, warnings };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      warnings.push("work-plan.json is malformed JSON");
      return { workPlan: null, warnings };
    }

    const unitsRaw = Array.isArray(parsed.units) ? parsed.units : [];
    const units: DashboardWorkUnit[] = unitsRaw
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => {
        const record = entry as Record<string, unknown>;
        return {
          id: String(record.id ?? ""),
          name: String(record.name ?? record.id ?? "unknown"),
          tier: String(record.tier ?? "medium"),
          priority: String(record.priority ?? "medium"),
          deps: Array.isArray(record.deps)
            ? record.deps.map((dep) => String(dep))
            : [],
          boundedContext: String(record.boundedContext ?? "unknown"),
          acceptance: Array.isArray(record.acceptance)
            ? record.acceptance.map((item) => String(item))
            : [],
        };
      })
      .filter((unit) => unit.id.length > 0);

    return {
      workPlan: {
        source: String(parsed.source ?? ""),
        generatedAt: String(parsed.generatedAt ?? new Date(0).toISOString()),
        units,
      },
      warnings,
    };
  }

  private withDb<T>(
    warnings: string[],
    fn: (db: Database) => T,
    fallback: T,
  ): T {
    if (!existsSync(this.workflowDbPath)) {
      warnings.push("workflow.db is missing");
      return fallback;
    }

    let db: Database | null = null;
    try {
      db = new Database(this.workflowDbPath, { readonly: true });
      return fn(db);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`workflow.db read failed: ${message}`);
      return fallback;
    } finally {
      db?.close();
    }
  }

  listRuns(
    inputPagination?: Partial<DashboardPagination>,
  ): DashboardListResponse<DashboardRunSnapshot> {
    const warnings: string[] = [];
    const pagination = toPagination(inputPagination);

    return this.withDb(
      warnings,
      (db) => {
        if (!tableExists(db, "_smithers_runs")) {
          warnings.push("_smithers_runs table is missing");
          return buildListResponse([], 0, pagination, warnings);
        }

        const totalRow = db
          .query("SELECT COUNT(*) AS total FROM _smithers_runs")
          .get() as { total: number };
        const total = Number(totalRow?.total ?? 0);

        const rows = db
          .query(
            `SELECT
               run_id,
               workflow_name,
               workflow_path,
               status,
               created_at_ms,
               started_at_ms,
               finished_at_ms,
               error_json,
               config_json
             FROM _smithers_runs
             ORDER BY created_at_ms DESC, run_id DESC
             LIMIT ? OFFSET ?`,
          )
          .all(pagination.limit, pagination.offset) as Array<Record<string, unknown>>;

        const items = rows.map((row) => {
          const createdAtMs = safeNumber(row.created_at_ms) ?? 0;
          const startedAtMs = safeNumber(row.started_at_ms);
          const finishedAtMs = safeNumber(row.finished_at_ms);

          return {
            runId: String(row.run_id ?? ""),
            workflowName: String(row.workflow_name ?? ""),
            workflowPath: row.workflow_path == null ? null : String(row.workflow_path),
            status: String(row.status ?? "unknown"),
            createdAt: toIso(createdAtMs) ?? new Date(0).toISOString(),
            startedAt: toIso(startedAtMs),
            finishedAt: toIso(finishedAtMs),
            durationMs:
              startedAtMs != null && finishedAtMs != null
                ? Math.max(0, finishedAtMs - startedAtMs)
                : null,
            error: parseMaybeJson(row.error_json, warnings, "runs.error_json"),
            config: parseMaybeJson(row.config_json, warnings, "runs.config_json"),
          } satisfies DashboardRunSnapshot;
        });

        return buildListResponse(items, total, pagination, warnings);
      },
      buildListResponse([], 0, pagination, warnings),
    );
  }

  getRun(runId: string): DashboardRunSnapshot | null {
    const warnings: string[] = [];

    return this.withDb(
      warnings,
      (db) => {
        if (!tableExists(db, "_smithers_runs")) return null;

        const row = db
          .query(
            `SELECT
               run_id,
               workflow_name,
               workflow_path,
               status,
               created_at_ms,
               started_at_ms,
               finished_at_ms,
               error_json,
               config_json
             FROM _smithers_runs
             WHERE run_id = ?
             LIMIT 1`,
          )
          .get(runId) as Record<string, unknown> | null;

        if (!row) return null;

        const createdAtMs = safeNumber(row.created_at_ms) ?? 0;
        const startedAtMs = safeNumber(row.started_at_ms);
        const finishedAtMs = safeNumber(row.finished_at_ms);

        return {
          runId: String(row.run_id ?? ""),
          workflowName: String(row.workflow_name ?? ""),
          workflowPath: row.workflow_path == null ? null : String(row.workflow_path),
          status: String(row.status ?? "unknown"),
          createdAt: toIso(createdAtMs) ?? new Date(0).toISOString(),
          startedAt: toIso(startedAtMs),
          finishedAt: toIso(finishedAtMs),
          durationMs:
            startedAtMs != null && finishedAtMs != null
              ? Math.max(0, finishedAtMs - startedAtMs)
              : null,
          error: parseMaybeJson(row.error_json, warnings, "run.error_json"),
          config: parseMaybeJson(row.config_json, warnings, "run.config_json"),
        };
      },
      null,
    );
  }

  listNodes(
    runId: string,
    inputPagination?: Partial<DashboardPagination>,
  ): DashboardListResponse<DashboardNodeSnapshot> {
    const warnings: string[] = [];
    const pagination = toPagination(inputPagination);

    return this.withDb(
      warnings,
      (db) => {
        if (!tableExists(db, "_smithers_nodes")) {
          warnings.push("_smithers_nodes table is missing");
          return buildListResponse([], 0, pagination, warnings);
        }

        const totalRow = db
          .query("SELECT COUNT(*) AS total FROM _smithers_nodes WHERE run_id = ?")
          .get(runId) as { total: number };
        const total = Number(totalRow?.total ?? 0);

        const rows = db
          .query(
            `SELECT
               run_id,
               node_id,
               iteration,
               state,
               last_attempt,
               updated_at_ms,
               output_table,
               label
             FROM _smithers_nodes
             WHERE run_id = ?
             ORDER BY iteration DESC, node_id ASC
             LIMIT ? OFFSET ?`,
          )
          .all(runId, pagination.limit, pagination.offset) as Array<Record<string, unknown>>;

        const items = rows.map((row) => ({
          runId: String(row.run_id ?? runId),
          nodeId: String(row.node_id ?? ""),
          iteration: safeNumber(row.iteration) ?? 0,
          state: String(row.state ?? "unknown"),
          lastAttempt: safeNumber(row.last_attempt),
          updatedAt: toIso(safeNumber(row.updated_at_ms)) ?? new Date(0).toISOString(),
          outputTable: String(row.output_table ?? ""),
          label: row.label == null ? null : String(row.label),
        }));

        return buildListResponse(items, total, pagination, warnings);
      },
      buildListResponse([], 0, pagination, warnings),
    );
  }

  listAttempts(
    runId: string,
    inputPagination?: Partial<DashboardPagination>,
  ): DashboardListResponse<DashboardAttemptSnapshot> {
    const warnings: string[] = [];
    const pagination = toPagination(inputPagination);

    return this.withDb(
      warnings,
      (db) => {
        if (!tableExists(db, "_smithers_attempts")) {
          warnings.push("_smithers_attempts table is missing");
          return buildListResponse([], 0, pagination, warnings);
        }

        const totalRow = db
          .query("SELECT COUNT(*) AS total FROM _smithers_attempts WHERE run_id = ?")
          .get(runId) as { total: number };
        const total = Number(totalRow?.total ?? 0);

        const rows = db
          .query(
            `SELECT
               run_id,
               node_id,
               iteration,
               attempt,
               state,
               started_at_ms,
               finished_at_ms,
               error_json,
               jj_pointer,
               response_text,
               jj_cwd,
               cached,
               meta_json
             FROM _smithers_attempts
             WHERE run_id = ?
             ORDER BY started_at_ms DESC, node_id ASC, attempt DESC
             LIMIT ? OFFSET ?`,
          )
          .all(runId, pagination.limit, pagination.offset) as Array<Record<string, unknown>>;

        const items = rows.map((row) => {
          const startedAtMs = safeNumber(row.started_at_ms);
          const finishedAtMs = safeNumber(row.finished_at_ms);
          const durationMs =
            startedAtMs != null && finishedAtMs != null
              ? Math.max(0, finishedAtMs - startedAtMs)
              : null;

          return {
            runId: String(row.run_id ?? runId),
            nodeId: String(row.node_id ?? ""),
            iteration: safeNumber(row.iteration) ?? 0,
            attempt: safeNumber(row.attempt) ?? 0,
            state: String(row.state ?? "unknown"),
            startedAt: toIso(startedAtMs),
            finishedAt: toIso(finishedAtMs),
            durationMs,
            cached: Number(row.cached ?? 0) === 1,
            jjPointer: row.jj_pointer == null ? null : String(row.jj_pointer),
            jjCwd: row.jj_cwd == null ? null : String(row.jj_cwd),
            responseText: row.response_text == null ? null : String(row.response_text),
            error: parseMaybeJson(row.error_json, warnings, "attempt.error_json"),
            meta: parseMaybeJson(row.meta_json, warnings, "attempt.meta_json") as
              | Record<string, unknown>
              | null,
          } satisfies DashboardAttemptSnapshot;
        });

        return buildListResponse(items, total, pagination, warnings);
      },
      buildListResponse([], 0, pagination, warnings),
    );
  }

  async listPromptAudits(
    runId: string,
    inputPagination?: Partial<DashboardPagination>,
  ): Promise<DashboardListResponse<DashboardPromptAuditSnapshot>> {
    const pagination = toPagination(inputPagination);
    const attempts = this.listAttempts(runId, {
      limit: 10_000,
      offset: 0,
    });
    const warnings = [...attempts.meta.warnings];

    const projected = attempts.items.map((attempt) => {
      const promptText = extractPromptFromAttemptMeta(attempt.meta);
      const promptPreview = promptText ? truncateText(promptText, 220) : "";
      const promptHash = hashPrompt(promptText);
      const responseText = attempt.responseText ?? "";
      const responsePreview = responseText ? truncateText(responseText, 220) : "";
      const timestampMs = Math.max(
        safeTimestampFromIso(attempt.startedAt),
        safeTimestampFromIso(attempt.finishedAt),
      );
      const timestamp = toIso(timestampMs) ?? new Date(0).toISOString();
      const unitStage = toUnitStage(attempt.nodeId);

      return {
        runId: attempt.runId,
        nodeId: attempt.nodeId,
        unitId: unitStage.unitId,
        stage: unitStage.stage,
        iteration: attempt.iteration,
        attempt: attempt.attempt,
        state: attempt.state,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        durationMs: attempt.durationMs,
        timestampMs,
        timestamp,
        promptText,
        promptPreview,
        promptHash,
        responseChars: responseText.length,
        responsePreview,
      } satisfies DashboardPromptAuditSnapshot;
    });

    projected.sort((a, b) =>
      compareTimestampDesc(
        {
          timestampMs: a.timestampMs,
          eventKey: `${a.nodeId}:${a.iteration}:${a.attempt}`,
        },
        {
          timestampMs: b.timestampMs,
          eventKey: `${b.nodeId}:${b.iteration}:${b.attempt}`,
        },
      ));

    const total = projected.length;
    const items = projected.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );

    return buildListResponse(items, total, pagination, warnings);
  }

  async listExecutionSteps(
    runId: string,
    inputPagination?: Partial<DashboardPagination>,
  ): Promise<DashboardListResponse<DashboardExecutionStepSnapshot>> {
    const pagination = toPagination(inputPagination);
    const attempts = this.listAttempts(runId, {
      limit: 10_000,
      offset: 0,
    });
    const warnings = [...attempts.meta.warnings];

    const projected = attempts.items.map((attempt) => {
      const promptText = extractPromptFromAttemptMeta(attempt.meta);
      const promptPreview = promptText ? truncateText(promptText, 180) : "";
      const promptHash = hashPrompt(promptText);
      const responseChars = (attempt.responseText ?? "").length;
      const timestampMs = Math.max(
        safeTimestampFromIso(attempt.startedAt),
        safeTimestampFromIso(attempt.finishedAt),
      );
      const timestamp = toIso(timestampMs) ?? new Date(0).toISOString();
      const errorMessage = toErrorMessage(attempt.error);
      const unitStage = toUnitStage(attempt.nodeId);

      return {
        runId: attempt.runId,
        nodeId: attempt.nodeId,
        unitId: unitStage.unitId,
        stage: unitStage.stage,
        iteration: attempt.iteration,
        attempt: attempt.attempt,
        state: attempt.state,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        durationMs: attempt.durationMs,
        timestampMs,
        timestamp,
        promptAvailable: promptText.length > 0,
        promptPreview,
        promptHash,
        responseChars,
        cached: attempt.cached,
        errorMessage,
      } satisfies DashboardExecutionStepSnapshot;
    });

    projected.sort((a, b) =>
      compareTimestampDesc(
        {
          timestampMs: a.timestampMs,
          eventKey: `${a.nodeId}:${a.iteration}:${a.attempt}`,
        },
        {
          timestampMs: b.timestampMs,
          eventKey: `${b.nodeId}:${b.iteration}:${b.attempt}`,
        },
      ));

    const total = projected.length;
    const items = projected.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );

    return buildListResponse(items, total, pagination, warnings);
  }

  async listTimelineEvents(
    runId: string,
    input: Partial<TimelineFilterOpts> = {},
  ): Promise<DashboardListResponse<DashboardTimelineEvent>> {
    const pagination = toPagination(input);
    const warnings: string[] = [];

    const nodeEvents = this.listNodeEvents(runId, {
      limit: 5_000,
      offset: 0,
      fromTs: input.fromTs,
      toTs: input.toTs,
    });
    warnings.push(...nodeEvents.meta.warnings);

    const [commands, toolEvents, resources] = await Promise.all([
      this.listCommandEvents({
        limit: 5_000,
        offset: 0,
        runId,
        fromTs: input.fromTs,
        toTs: input.toTs,
      }),
      this.listAgentToolEvents(runId, { limit: 5_000, offset: 0 }),
      this.listResourceSamples(runId, { limit: 5_000, offset: 0 }),
    ]);

    warnings.push(...commands.meta.warnings);
    warnings.push(...toolEvents.meta.warnings);
    warnings.push(...resources.meta.warnings);

    const timeline: DashboardTimelineEvent[] = [];

    for (const event of nodeEvents.items) {
      const payload = event.payload ?? {};
      timeline.push({
        runId: event.runId,
        nodeId: typeof payload.nodeId === "string" ? payload.nodeId : null,
        iteration: safeNumber(payload.iteration),
        attempt: safeNumber(payload.attempt),
        timestampMs: event.timestampMs,
        timestamp: event.timestamp,
        source: "smithers",
        category: "node",
        eventType: event.type,
        eventKey: `smithers:${event.runId}:${event.seq}`,
        summary: buildSmithersSummary(event),
        payload,
      });
    }

    for (const event of commands.items) {
      timeline.push({
        runId,
        nodeId:
          typeof event.details.nodeId === "string" ? event.details.nodeId : null,
        iteration: safeNumber(event.details.iteration),
        attempt: safeNumber(event.details.attempt),
        timestampMs: event.timestampMs,
        timestamp: event.timestamp,
        source: "agentix",
        category: "command",
        eventType: event.event,
        eventKey: `agentix:line:${event.line}`,
        summary: buildCommandSummary(event),
        payload: {
          ...event.details,
          command: event.command,
          line: event.line,
        },
      });
    }

    for (const event of toolEvents.items) {
      timeline.push({
        runId,
        nodeId: event.nodeId,
        iteration: event.iteration,
        attempt: event.attempt,
        timestampMs: event.timestampMs,
        timestamp: event.timestamp,
        source: "telemetry",
        category: "tool",
        eventType: event.eventType,
        eventKey: event.eventKey,
        summary: buildToolSummary(event),
        payload: {
          ...event.payload,
          provider: event.provider,
          toolName: event.toolName,
          tokenUsage: event.tokenUsage,
        },
      });
    }

    resources.items.forEach((sample, index) => {
      timeline.push({
        runId,
        nodeId: sample.nodeId,
        iteration: null,
        attempt: null,
        timestampMs: sample.timestampMs,
        timestamp: sample.timestamp,
        source: "resource",
        category: "resource",
        eventType: "resource.sample",
        eventKey: `resource:${sample.runId}:${sample.timestampMs}:${sample.nodeId ?? ""}:${index}`,
        summary: buildResourceSummary(sample),
        payload: {
          cpuPercent: sample.cpuPercent,
          memoryRssMb: sample.memoryRssMb,
          metadata: sample.metadata,
        },
      });
    });

    let filtered = timeline;

    if (input.source) {
      filtered = filtered.filter((entry) => entry.source === input.source);
    }
    if (input.category) {
      filtered = filtered.filter((entry) => entry.category === input.category);
    }
    if (typeof input.query === "string" && input.query.trim()) {
      const needle = input.query.trim().toLowerCase();
      filtered = filtered.filter((entry) => {
        const haystack = `${entry.eventType} ${entry.summary} ${JSON.stringify(entry.payload)}`;
        return haystack.toLowerCase().includes(needle);
      });
    }
    if (typeof input.fromTs === "number") {
      filtered = filtered.filter((entry) => entry.timestampMs >= Math.floor(input.fromTs));
    }
    if (typeof input.toTs === "number") {
      filtered = filtered.filter((entry) => entry.timestampMs <= Math.floor(input.toTs));
    }

    filtered.sort((a, b) =>
      compareTimestampDesc(
        { timestampMs: a.timestampMs, eventKey: a.eventKey },
        { timestampMs: b.timestampMs, eventKey: b.eventKey },
      ));

    const total = filtered.length;
    const items = filtered.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );

    return buildListResponse(items, total, pagination, warnings);
  }

  listNodeEvents(
    runId: string,
    input: Partial<EventFilterOpts> = {},
  ): DashboardListResponse<DashboardNodeEventSnapshot> {
    const warnings: string[] = [];
    const pagination = toPagination(input);

    return this.withDb(
      warnings,
      (db) => {
        if (!tableExists(db, "_smithers_events")) {
          warnings.push("_smithers_events table is missing");
          return buildListResponse([], 0, pagination, warnings);
        }

        let where = "run_id = ?";
        const params: Array<string | number> = [runId];

        if (typeof input.afterSeq === "number") {
          where += " AND seq > ?";
          params.push(Math.floor(input.afterSeq));
        }
        if (typeof input.beforeSeq === "number") {
          where += " AND seq <= ?";
          params.push(Math.floor(input.beforeSeq));
        }
        if (typeof input.type === "string" && input.type.trim()) {
          where += " AND type = ?";
          params.push(input.type.trim());
        }
        if (typeof input.nodeId === "string" && input.nodeId.trim()) {
          const nodeId = input.nodeId.trim().replaceAll('"', '\\"');
          where += " AND payload_json LIKE ?";
          params.push(`%"nodeId":"${nodeId}"%`);
        }
        if (typeof input.query === "string" && input.query.trim()) {
          where += " AND payload_json LIKE ?";
          params.push(`%${input.query.trim()}%`);
        }
        if (typeof input.fromTs === "number") {
          where += " AND timestamp_ms >= ?";
          params.push(Math.floor(input.fromTs));
        }
        if (typeof input.toTs === "number") {
          where += " AND timestamp_ms <= ?";
          params.push(Math.floor(input.toTs));
        }

        const totalRow = db
          .query(`SELECT COUNT(*) AS total FROM _smithers_events WHERE ${where}`)
          .get(...params) as { total: number };
        const total = Number(totalRow?.total ?? 0);

        const rows = db
          .query(
            `SELECT run_id, seq, timestamp_ms, type, payload_json
             FROM _smithers_events
             WHERE ${where}
             ORDER BY seq DESC
             LIMIT ? OFFSET ?`,
          )
          .all(
            ...params,
            pagination.limit,
            pagination.offset,
          ) as Array<Record<string, unknown>>;

        let items = rows.map((row) => ({
          runId: String(row.run_id ?? runId),
          seq: safeNumber(row.seq) ?? 0,
          timestampMs: safeNumber(row.timestamp_ms) ?? 0,
          timestamp: toIso(safeNumber(row.timestamp_ms)) ?? new Date(0).toISOString(),
          type: String(row.type ?? "unknown"),
          payload: (parseMaybeJson(
            row.payload_json,
            warnings,
            "event.payload_json",
          ) ?? {}) as Record<string, unknown>,
        }));

        if (input.nodeId && input.nodeId.trim()) {
          const filterNodeId = input.nodeId.trim();
          items = items.filter((event) => {
            const nodeId = event.payload.nodeId;
            return nodeId === filterNodeId;
          });
        }

        return buildListResponse(items, total, pagination, warnings);
      },
      buildListResponse([], 0, pagination, warnings),
    );
  }

  listNodeLogs(
    runId: string,
    input: Partial<EventFilterOpts> & { stream?: "stdout" | "stderr" } = {},
  ): DashboardListResponse<DashboardNodeLogSnapshot> {
    const eventResult = this.listNodeEvents(runId, {
      ...input,
      type: "NodeOutput",
    });

    const items = eventResult.items
      .map((event) => {
        const payload = event.payload;
        const stream = payload.stream === "stderr" ? "stderr" : "stdout";
        const attempt = safeNumber(payload.attempt);
        return {
          runId: event.runId,
          seq: event.seq,
          timestampMs: event.timestampMs,
          timestamp: event.timestamp,
          nodeId: String(payload.nodeId ?? ""),
          iteration: safeNumber(payload.iteration) ?? 0,
          attempt,
          stream,
          text: String(payload.text ?? ""),
        } satisfies DashboardNodeLogSnapshot;
      })
      .filter((log) => {
        if (!input.stream) return true;
        return log.stream === input.stream;
      })
      .filter((log) => {
        if (!input.nodeId || !input.nodeId.trim()) return true;
        return log.nodeId === input.nodeId.trim();
      });

    return {
      items,
      meta: {
        ...eventResult.meta,
        total: items.length,
      },
    };
  }

  listStageOutputs(
    runId: string,
    inputPagination?: Partial<DashboardPagination>,
  ): DashboardListResponse<DashboardStageOutputSnapshot> {
    const warnings: string[] = [];
    const pagination = toPagination(inputPagination);

    return this.withDb(
      warnings,
      (db) => {
        const rows: DashboardStageOutputSnapshot[] = [];

        for (const table of STAGE_OUTPUT_TABLES) {
          if (!tableExists(db, table)) continue;
          const stageRows = db
            .query(`SELECT * FROM "${table}" WHERE run_id = ? ORDER BY iteration DESC, node_id ASC`)
            .all(runId) as Array<Record<string, unknown>>;

          for (const row of stageRows) {
            const serialized = serializeRowWithJsonParsing(
              row,
              warnings,
              `stage:${table}`,
            );
            rows.push({
              table,
              runId: String(serialized.run_id ?? runId),
              nodeId: String(serialized.node_id ?? ""),
              iteration: safeNumber(serialized.iteration) ?? 0,
              row: serialized,
            });
          }
        }

        rows.sort((a, b) => {
          if (a.iteration !== b.iteration) return b.iteration - a.iteration;
          if (a.table !== b.table) return a.table.localeCompare(b.table);
          return a.nodeId.localeCompare(b.nodeId);
        });

        const total = rows.length;
        const paged = rows.slice(pagination.offset, pagination.offset + pagination.limit);

        return buildListResponse(paged, total, pagination, warnings);
      },
      buildListResponse([], 0, pagination, warnings),
    );
  }

  listMergeRiskSnapshots(
    runId: string,
    inputPagination?: Partial<DashboardPagination>,
  ): DashboardListResponse<DashboardMergeRiskSnapshot> {
    const warnings: string[] = [];
    const pagination = toPagination(inputPagination);

    return this.withDb(
      warnings,
      (db) => {
        if (!tableExists(db, "merge_queue")) {
          warnings.push("merge_queue table is missing");
          return buildListResponse([], 0, pagination, warnings);
        }

        const totalRow = db
          .query("SELECT COUNT(*) AS total FROM merge_queue WHERE run_id = ?")
          .get(runId) as { total: number };
        const total = Number(totalRow?.total ?? 0);

        const rows = db
          .query(
            `SELECT run_id, node_id, iteration, summary, risk_snapshot, tickets_landed, tickets_evicted, tickets_skipped
             FROM merge_queue
             WHERE run_id = ?
             ORDER BY iteration DESC
             LIMIT ? OFFSET ?`,
          )
          .all(runId, pagination.limit, pagination.offset) as Array<Record<string, unknown>>;

        const items = rows.map((row) => ({
          runId: String(row.run_id ?? runId),
          nodeId: String(row.node_id ?? "merge-queue"),
          iteration: safeNumber(row.iteration) ?? 0,
          summary: row.summary == null ? null : String(row.summary),
          riskSnapshot: parseMaybeJson(
            row.risk_snapshot,
            warnings,
            "merge_queue.risk_snapshot",
          ) as Record<string, unknown> | null,
          ticketsLanded: (parseMaybeJson(
            row.tickets_landed,
            warnings,
            "merge_queue.tickets_landed",
          ) ?? []) as Array<Record<string, unknown>>,
          ticketsEvicted: (parseMaybeJson(
            row.tickets_evicted,
            warnings,
            "merge_queue.tickets_evicted",
          ) ?? []) as Array<Record<string, unknown>>,
          ticketsSkipped: (parseMaybeJson(
            row.tickets_skipped,
            warnings,
            "merge_queue.tickets_skipped",
          ) ?? []) as Array<Record<string, unknown>>,
        }));

        return buildListResponse(items, total, pagination, warnings);
      },
      buildListResponse([], 0, pagination, warnings),
    );
  }

  async listCommandEvents(
    input: Partial<CommandFilterOpts> = {},
  ): Promise<DashboardListResponse<DashboardCommandEventSnapshot>> {
    const warnings: string[] = [];
    const pagination = toPagination(input);

    if (!existsSync(this.eventsPath)) {
      warnings.push("events.jsonl is missing");
      return buildListResponse([], 0, pagination, warnings);
    }

    let raw = "";
    try {
      raw = await readFile(this.eventsPath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to read events.jsonl: ${message}`);
      return buildListResponse([], 0, pagination, warnings);
    }

    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const parsed: DashboardCommandEventSnapshot[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(line) as Record<string, unknown>;
      } catch {
        warnings.push(`Malformed JSONL line ${i + 1}`);
        continue;
      }

      const timestampMs = Date.parse(String(json.ts ?? ""));
      const parsedEvent: DashboardCommandEventSnapshot = {
        line: i + 1,
        timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
        timestamp: Number.isFinite(timestampMs)
          ? new Date(timestampMs).toISOString()
          : new Date(0).toISOString(),
        schemaVersion: safeNumber(json.schemaVersion) ?? 1,
        level: String(json.level ?? "info"),
        event: String(json.event ?? "unknown"),
        command: String(json.command ?? "unknown"),
        runId: json.runId == null ? null : String(json.runId),
        sessionId: json.sessionId == null ? null : String(json.sessionId),
        unitId: json.unitId == null ? null : String(json.unitId),
        details:
          json.details && typeof json.details === "object"
            ? (json.details as Record<string, unknown>)
            : {},
      };

      parsed.push(parsedEvent);
    }

    let filtered = parsed;

    if (typeof input.afterLine === "number") {
      filtered = filtered.filter((event) => event.line > Math.floor(input.afterLine));
    }
    if (typeof input.command === "string" && input.command.trim()) {
      const command = input.command.trim().toLowerCase();
      filtered = filtered.filter((event) => event.command.toLowerCase() === command);
    }
    if (typeof input.runId === "string" && input.runId.trim()) {
      const runId = input.runId.trim();
      filtered = filtered.filter((event) => event.runId === runId);
    }
    if (typeof input.query === "string" && input.query.trim()) {
      const query = input.query.trim().toLowerCase();
      filtered = filtered.filter((event) => {
        const detailText = JSON.stringify(event.details).toLowerCase();
        return (
          event.event.toLowerCase().includes(query) ||
          event.command.toLowerCase().includes(query) ||
          detailText.includes(query)
        );
      });
    }
    if (typeof input.fromTs === "number") {
      filtered = filtered.filter((event) => event.timestampMs >= Math.floor(input.fromTs));
    }
    if (typeof input.toTs === "number") {
      filtered = filtered.filter((event) => event.timestampMs <= Math.floor(input.toTs));
    }

    filtered = filtered.sort((a, b) => {
      if (a.timestampMs !== b.timestampMs) return b.timestampMs - a.timestampMs;
      return b.line - a.line;
    });

    const total = filtered.length;
    const items = filtered.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );

    return buildListResponse(items, total, pagination, warnings);
  }

  async listTraceArtifacts(): Promise<DashboardListResponse<DashboardTraceArtifact>> {
    const warnings: string[] = [];
    const pagination = { limit: 500, offset: 0 };

    if (!existsSync(this.tracesDir)) {
      warnings.push("trace artifact directory is missing");
      return buildListResponse([], 0, pagination, warnings);
    }

    let files: string[] = [];
    try {
      files = (await readdir(this.tracesDir)).filter((file) => file.endsWith(".json"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to read traces directory: ${message}`);
      return buildListResponse([], 0, pagination, warnings);
    }

    const items: DashboardTraceArtifact[] = [];

    for (const file of files.sort()) {
      const path = join(this.tracesDir, file);
      let raw = "";
      try {
        raw = await readFile(path, "utf8");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to read trace artifact ${file}: ${message}`);
        continue;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        warnings.push(`Malformed trace artifact ${file}`);
        continue;
      }

      const unitId = String(payload.unitId ?? payload.unit_id ?? parse(file).name);
      const scenariosTotal = safeNumber(payload.scenariosTotal) ?? 0;
      const scenariosCovered = safeNumber(payload.scenariosCovered) ?? 0;
      const uncoveredScenarios = Array.isArray(payload.uncoveredScenarios)
        ? payload.uncoveredScenarios.map((entry) => String(entry))
        : [];
      const antiSlopFlags = Array.isArray(payload.antiSlopFlags)
        ? payload.antiSlopFlags.map((entry) => String(entry))
        : [];

      items.push({
        unitId,
        path,
        generatedAt:
          typeof payload.generatedAt === "string"
            ? payload.generatedAt
            : typeof payload.ts === "string"
              ? payload.ts
              : null,
        traceCompleteness:
          typeof payload.traceCompleteness === "boolean"
            ? payload.traceCompleteness
            : null,
        scenariosTotal,
        scenariosCovered,
        uncoveredScenarios,
        antiSlopFlags,
        payload,
      });
    }

    items.sort((a, b) => a.unitId.localeCompare(b.unitId));

    return buildListResponse(items, items.length, pagination, warnings);
  }

  async listAnalyticsSnapshots(): Promise<DashboardListResponse<DashboardAnalyticsSnapshot>> {
    const warnings: string[] = [];
    const pagination = { limit: 500, offset: 0 };

    if (!existsSync(this.analyticsDir)) {
      warnings.push("analytics snapshot directory is missing");
      return buildListResponse([], 0, pagination, warnings);
    }

    let files: string[] = [];
    try {
      files = (await readdir(this.analyticsDir)).filter(
        (file) => file.startsWith("daily-") && file.endsWith(".json"),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to read analytics directory: ${message}`);
      return buildListResponse([], 0, pagination, warnings);
    }

    const items: DashboardAnalyticsSnapshot[] = [];

    for (const file of files.sort()) {
      const path = join(this.analyticsDir, file);
      let raw = "";
      try {
        raw = await readFile(path, "utf8");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to read analytics snapshot ${file}: ${message}`);
        continue;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        warnings.push(`Malformed analytics snapshot ${file}`);
        continue;
      }

      const date = file.slice("daily-".length, file.length - ".json".length);
      const generatedAt =
        typeof payload.generatedAt === "string"
          ? payload.generatedAt
          : new Date(0).toISOString();

      items.push({
        date,
        path,
        generatedAt,
        payload,
      });
    }

    items.sort((a, b) => b.date.localeCompare(a.date));

    return buildListResponse(items, items.length, pagination, warnings);
  }

  async listAgentToolEvents(
    runId: string,
    inputPagination?: Partial<DashboardPagination>,
  ): Promise<DashboardListResponse<DashboardAgentToolEvent>> {
    const warnings: string[] = [];
    const pagination = toPagination(inputPagination);

    const nodeLogs = this.listNodeLogs(runId, {
      limit: 10_000,
      offset: 0,
    });
    warnings.push(...nodeLogs.meta.warnings);

    const parsed: DashboardAgentToolEvent[] = [];

    for (const log of nodeLogs.items) {
      const codex = parseCodexTelemetryEvent({
        runId,
        nodeId: log.nodeId,
        iteration: log.iteration,
        attempt: log.attempt,
        timestampMs: log.timestampMs,
        rawLine: log.text,
      });
      if (codex) parsed.push(normalizeCodexEvent(codex));

      const claude = parseClaudeTelemetryEvent({
        runId,
        nodeId: log.nodeId,
        iteration: log.iteration,
        attempt: log.attempt,
        timestampMs: log.timestampMs,
        rawLine: log.text,
      });
      if (claude) parsed.push(normalizeClaudeEvent(claude));
    }

    if (existsSync(this.telemetryDir)) {
      let files: string[] = [];
      try {
        files = (await readdir(this.telemetryDir)).filter((file) => file.endsWith(".jsonl"));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Failed to read telemetry directory: ${message}`);
      }

      for (const file of files.sort()) {
        const path = join(this.telemetryDir, file);
        let raw = "";
        try {
          raw = await readFile(path, "utf8");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Failed to read telemetry file ${file}: ${message}`);
          continue;
        }

        const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
        for (const line of lines) {
          const codexPayload = parseCodexTelemetryJsonLine(line);
          const claudePayload = parseClaudeTelemetryJsonLine(line);
          const timestampMs =
            safeNumber(codexPayload?.timestampMs) ??
            safeNumber(claudePayload?.timestampMs) ??
            Date.parse(
              String(
                codexPayload?.timestamp ??
                  codexPayload?.ts ??
                  claudePayload?.timestamp ??
                  claudePayload?.ts ??
                  new Date().toISOString(),
              ),
            );

          const codex = parseCodexTelemetryEvent({
            runId,
            nodeId:
              codexPayload?.nodeId == null
                ? null
                : String(codexPayload.nodeId),
            iteration: safeNumber(codexPayload?.iteration),
            attempt: safeNumber(codexPayload?.attempt),
            timestampMs: Number.isFinite(timestampMs) ? Number(timestampMs) : Date.now(),
            rawLine: line,
          });
          if (codex) parsed.push(normalizeCodexEvent(codex));

          const claude = parseClaudeTelemetryEvent({
            runId,
            nodeId:
              claudePayload?.nodeId == null
                ? null
                : String(claudePayload.nodeId),
            iteration: safeNumber(claudePayload?.iteration),
            attempt: safeNumber(claudePayload?.attempt),
            timestampMs: Number.isFinite(timestampMs) ? Number(timestampMs) : Date.now(),
            rawLine: line,
          });
          if (claude) parsed.push(normalizeClaudeEvent(claude));
        }
      }
    }

    parsed.sort((a, b) => {
      if (a.timestampMs !== b.timestampMs) return b.timestampMs - a.timestampMs;
      return b.eventKey.localeCompare(a.eventKey);
    });

    const total = parsed.length;
    const items = parsed.slice(pagination.offset, pagination.offset + pagination.limit);

    return buildListResponse(items, total, pagination, warnings);
  }

  async listResourceSamples(
    runId?: string,
    inputPagination?: Partial<DashboardPagination>,
  ): Promise<DashboardListResponse<DashboardResourceSample>> {
    const warnings: string[] = [];
    const pagination = toPagination(inputPagination);

    if (!existsSync(this.resourceSamplesPath)) {
      warnings.push("resource sample file is missing");
      return buildListResponse([], 0, pagination, warnings);
    }

    let raw = "";
    try {
      raw = await readFile(this.resourceSamplesPath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to read resource sample file: ${message}`);
      return buildListResponse([], 0, pagination, warnings);
    }

    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const parsed: DashboardResourceSample[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(lines[i]!) as Record<string, unknown>;
      } catch {
        warnings.push(`Malformed resource sample line ${i + 1}`);
        continue;
      }

      const parsedRunId = json.runId == null ? "" : String(json.runId);
      if (runId && parsedRunId !== runId) continue;

      const timestampMs = safeNumber(json.timestampMs) ?? Date.parse(String(json.timestamp ?? ""));
      const timestamp = toIso(timestampMs) ?? new Date(0).toISOString();

      parsed.push({
        runId: parsedRunId,
        nodeId: json.nodeId == null ? null : String(json.nodeId),
        timestampMs: Number.isFinite(timestampMs) ? Number(timestampMs) : 0,
        timestamp,
        cpuPercent: safeNumber(json.cpuPercent),
        memoryRssMb: safeNumber(json.memoryRssMb),
        metadata:
          json.metadata && typeof json.metadata === "object"
            ? (json.metadata as Record<string, unknown>)
            : {},
      });
    }

    parsed.sort((a, b) => b.timestampMs - a.timestampMs);

    const total = parsed.length;
    const items = parsed.slice(pagination.offset, pagination.offset + pagination.limit);

    return buildListResponse(items, total, pagination, warnings);
  }

  fetchSmithersEventsAfter(
    runId: string,
    afterSeq: number,
    limit = 500,
  ): DashboardNodeEventSnapshot[] {
    const warnings: string[] = [];
    return this.withDb(
      warnings,
      (db) => {
        if (!tableExists(db, "_smithers_events")) return [];

        const rows = db
          .query(
            `SELECT run_id, seq, timestamp_ms, type, payload_json
             FROM _smithers_events
             WHERE run_id = ? AND seq > ?
             ORDER BY seq ASC
             LIMIT ?`,
          )
          .all(runId, Math.max(-1, Math.floor(afterSeq)), Math.max(1, Math.floor(limit))) as Array<
          Record<string, unknown>
        >;

        return rows.map((row) => ({
          runId: String(row.run_id ?? runId),
          seq: safeNumber(row.seq) ?? 0,
          timestampMs: safeNumber(row.timestamp_ms) ?? 0,
          timestamp: toIso(safeNumber(row.timestamp_ms)) ?? new Date(0).toISOString(),
          type: String(row.type ?? "unknown"),
          payload: (parseMaybeJson(
            row.payload_json,
            warnings,
            "stream.payload_json",
          ) ?? {}) as Record<string, unknown>,
        }));
      },
      [],
    );
  }

  async fetchCommandEventsAfter(
    afterLine: number,
    limit = 500,
  ): Promise<DashboardCommandEventSnapshot[]> {
    const result = await this.listCommandEvents({
      afterLine,
      limit,
      offset: 0,
    });

    return [...result.items].sort((a, b) => a.line - b.line);
  }
}

export function createDashboardReadModel(opts: ReadModelOpts): DashboardReadModel {
  return new DashboardReadModel(opts);
}
