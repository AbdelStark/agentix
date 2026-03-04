import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { createDashboardReadModel, type DashboardReadModel } from "./dashboard-read-model";
import {
  DashboardEventStream,
  encodeSseEvent,
} from "./dashboard-stream";
import type { DashboardEventEnvelope } from "./dashboard-types";

type DashboardApiServerOptions = {
  repoRoot: string;
  host?: string;
  port?: number;
  heartbeatMs?: number;
  replayLimit?: number;
  apiToken?: string | null;
};

export type DashboardApiServer = {
  host: string;
  port: number;
  baseUrl: string;
  stop: () => Promise<void>;
};

const POLL_INTERVAL_MS = 500;

const SECRET_PATTERNS = [
  /sk-[a-z0-9]{20,}/gi,
  /sk-ant-[a-z0-9\-_]{10,}/gi,
  /ghp_[a-z0-9]{20,}/gi,
  /AKIA[0-9A-Z]{16}/g,
  /(?:(?:api|auth)[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;'"`]+/gi,
];

function redactSecretsInString(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

function redactSecrets<T>(value: T): T {
  if (typeof value === "string") {
    return redactSecretsInString(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry)) as T;
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = redactSecrets(entry);
    }
    return output as T;
  }

  return value;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(redactSecrets(payload)), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function parsePagination(url: URL): { limit: number; offset: number } {
  const rawLimit = Number(url.searchParams.get("limit") ?? "50");
  const rawOffset = Number(url.searchParams.get("offset") ?? "0");

  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(500, Math.floor(rawLimit)))
    : 50;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;

  return { limit, offset };
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (value == null || !value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.floor(parsed);
}

function parseRunRoute(pathname: string): {
  runId: string;
  resource: string | null;
} | null {
  const match = /^\/api\/runs\/([^/]+)(?:\/(.+))?$/.exec(pathname);
  if (!match) return null;
  return {
    runId: decodeURIComponent(match[1] ?? ""),
    resource: match[2] ? decodeURIComponent(match[2]) : null,
  };
}

async function maybeReadDashboardAsset(pathname: string): Promise<Response | null> {
  const cleaned =
    pathname === "/" || pathname === "/dashboard"
      ? "/dashboard/index.html"
      : pathname;

  if (!cleaned.startsWith("/dashboard/")) {
    return null;
  }

  const relPath = cleaned.replace(/^\/+/, "");
  const assetPath = join(import.meta.dir, "..", relPath);
  if (!existsSync(assetPath)) {
    return new Response("Not found", { status: 404 });
  }

  const source = await readFile(assetPath, "utf8");
  const isTsAsset = assetPath.endsWith(".ts") || assetPath.endsWith(".tsx");
  const body = isTsAsset
    ? new Bun.Transpiler({
        loader: assetPath.endsWith(".tsx") ? "tsx" : "ts",
        target: "browser",
      }).transformSync(source)
    : source;
  const contentType = assetPath.endsWith(".css")
    ? "text/css; charset=utf-8"
    : assetPath.endsWith(".js") || isTsAsset
      ? "text/javascript; charset=utf-8"
      : assetPath.endsWith(".html")
        ? "text/html; charset=utf-8"
        : "application/octet-stream";

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
    },
  });
}

function isAuthorized(request: Request, apiToken: string | null | undefined): boolean {
  if (!apiToken) return true;
  const headerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const queryToken = new URL(request.url).searchParams.get("token");
  return headerToken === apiToken || queryToken === apiToken;
}

function toEnvelopeFromSmithers(event: {
  runId: string;
  seq: number;
  timestampMs: number;
  type: string;
  payload: Record<string, unknown>;
}): Omit<DashboardEventEnvelope, "seq" | "timestamp"> {
  return {
    runId: event.runId,
    source: "smithers",
    type: event.type,
    timestampMs: event.timestampMs,
    eventKey: `smithers:${event.runId}:${event.seq}`,
    payload: {
      ...event.payload,
      runId: event.runId,
      sourceSeq: event.seq,
    },
  };
}

function toEnvelopeFromCommand(event: {
  line: number;
  timestampMs: number;
  event: string;
  runId: string | null;
  command: string;
  details: Record<string, unknown>;
}): Omit<DashboardEventEnvelope, "seq" | "timestamp"> {
  return {
    runId: event.runId,
    source: "agentix",
    type: event.event,
    timestampMs: event.timestampMs,
    eventKey: `agentix:line:${event.line}`,
    payload: {
      ...event.details,
      command: event.command,
      line: event.line,
      runId: event.runId,
    },
  };
}

export async function startDashboardApiServer(
  opts: DashboardApiServerOptions,
): Promise<DashboardApiServer> {
  const readModel = createDashboardReadModel({ repoRoot: opts.repoRoot });
  const stream = new DashboardEventStream({
    heartbeatMs: opts.heartbeatMs,
    replayLimit: opts.replayLimit,
  });

  const runCursor = new Map<string, number>();
  let commandCursor = 0;

  const syncEvents = async () => {
    const runs = readModel.listRuns({ limit: 200, offset: 0 }).items;

    for (const run of runs) {
      const previous = runCursor.get(run.runId) ?? -1;
      const events = readModel.fetchSmithersEventsAfter(run.runId, previous, 1000);
      if (!events.length) continue;

      for (const event of events) {
        stream.publish(toEnvelopeFromSmithers(event));
      }

      runCursor.set(run.runId, events[events.length - 1]!.seq);
    }

    const commands = await readModel.fetchCommandEventsAfter(commandCursor, 1000);
    if (commands.length > 0) {
      for (const commandEvent of commands) {
        stream.publish(toEnvelopeFromCommand(commandEvent));
        commandCursor = Math.max(commandCursor, commandEvent.line);
      }
    }
  };

  await syncEvents();
  const pollTimer = setInterval(() => {
    syncEvents().catch(() => {
      // Stream poller is best-effort; API remains read-only and resilient.
    });
  }, POLL_INTERVAL_MS);

  const server = Bun.serve({
    hostname: opts.host ?? "127.0.0.1",
    port: opts.port ?? 43110,
    idleTimeout: 30,
    fetch: async (request) => {
      if (!isAuthorized(request, opts.apiToken ?? null)) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const url = new URL(request.url);
      const pathname = url.pathname.replace(/\/+$/, "") || "/";

      if (request.method !== "GET") {
        return jsonResponse({ error: "Method Not Allowed" }, 405);
      }

      if (pathname === "/" || pathname.startsWith("/dashboard/")) {
        const assetResponse = await maybeReadDashboardAsset(pathname);
        if (assetResponse) return assetResponse;
      }

      if (pathname === "/api/health") {
        return jsonResponse({
          status: "ok",
          mode: "read-only",
          now: new Date().toISOString(),
          source: readModel.getSourceStatus(),
        });
      }

      if (pathname === "/api/runs") {
        const pagination = parsePagination(url);
        return jsonResponse(readModel.listRuns(pagination));
      }

      if (pathname === "/api/commands") {
        const pagination = parsePagination(url);
        const commands = await readModel.listCommandEvents({
          ...pagination,
          command: url.searchParams.get("command") ?? undefined,
          runId: url.searchParams.get("runId") ?? undefined,
          query: url.searchParams.get("query") ?? undefined,
          fromTs: parseOptionalNumber(url.searchParams.get("fromTs")),
          toTs: parseOptionalNumber(url.searchParams.get("toTs")),
        });
        return jsonResponse(commands);
      }

      if (pathname === "/api/traces") {
        return jsonResponse(await readModel.listTraceArtifacts());
      }

      if (pathname === "/api/analytics") {
        return jsonResponse(await readModel.listAnalyticsSnapshots());
      }

      if (pathname === "/api/work-plan") {
        const payload = await readModel.getWorkPlan();
        return jsonResponse(payload);
      }

      if (pathname === "/api/stream") {
        const afterSeq = parseOptionalNumber(url.searchParams.get("afterSeq"));
        const runId = url.searchParams.get("runId");
        const encoder = new TextEncoder();

        const replay = stream.getReplay({
          afterSeq: afterSeq ?? null,
          runId,
        });

        let unsubscribe: (() => void) | null = null;

        const readable = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const event of replay) {
              controller.enqueue(encoder.encode(encodeSseEvent(redactSecrets(event))));
            }

            unsubscribe = stream.subscribe((event) => {
              if (runId && "runId" in event && event.runId !== runId) {
                return;
              }
              controller.enqueue(encoder.encode(encodeSseEvent(redactSecrets(event))));
            });
          },
          cancel() {
            unsubscribe?.();
            unsubscribe = null;
          },
        });

        return new Response(readable, {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
          },
        });
      }

      const runRoute = parseRunRoute(pathname);
      if (runRoute) {
        const pagination = parsePagination(url);
        const { runId, resource } = runRoute;

        if (!resource) {
          const run = readModel.getRun(runId);
          if (!run) {
            return jsonResponse({ error: `Run ${runId} not found` }, 404);
          }

          const [nodes, attempts, mergeRisk, logs] = [
            readModel.listNodes(runId, { limit: 1000, offset: 0 }),
            readModel.listAttempts(runId, { limit: 1000, offset: 0 }),
            readModel.listMergeRiskSnapshots(runId, { limit: 50, offset: 0 }),
            readModel.listNodeLogs(runId, { limit: 200, offset: 0 }),
          ];

          return jsonResponse({
            run,
            summary: {
              nodeCount: nodes.meta.total,
              attemptCount: attempts.meta.total,
              logCount: logs.meta.total,
              mergeRiskSnapshots: mergeRisk.meta.total,
            },
          });
        }

        if (resource === "nodes") {
          return jsonResponse(readModel.listNodes(runId, pagination));
        }
        if (resource === "attempts") {
          return jsonResponse(readModel.listAttempts(runId, pagination));
        }
        if (resource === "prompts") {
          return jsonResponse(await readModel.listPromptAudits(runId, pagination));
        }
        if (resource === "execution-steps") {
          return jsonResponse(await readModel.listExecutionSteps(runId, pagination));
        }
        if (resource === "stage-outputs") {
          return jsonResponse(readModel.listStageOutputs(runId, pagination));
        }
        if (resource === "timeline") {
          const source = url.searchParams.get("source");
          const category = url.searchParams.get("category");
          return jsonResponse(
            await readModel.listTimelineEvents(runId, {
              ...pagination,
              source:
                source === "smithers" ||
                source === "agentix" ||
                source === "telemetry" ||
                source === "resource"
                  ? source
                  : undefined,
              category:
                category === "node" ||
                category === "command" ||
                category === "tool" ||
                category === "resource"
                  ? category
                  : undefined,
              query: url.searchParams.get("query") ?? undefined,
              fromTs: parseOptionalNumber(url.searchParams.get("fromTs")),
              toTs: parseOptionalNumber(url.searchParams.get("toTs")),
            }),
          );
        }
        if (resource === "events") {
          return jsonResponse(
            readModel.listNodeEvents(runId, {
              ...pagination,
              afterSeq: parseOptionalNumber(url.searchParams.get("afterSeq")),
              beforeSeq: parseOptionalNumber(url.searchParams.get("beforeSeq")),
              type: url.searchParams.get("type") ?? undefined,
              query: url.searchParams.get("query") ?? undefined,
              nodeId: url.searchParams.get("nodeId") ?? undefined,
              fromTs: parseOptionalNumber(url.searchParams.get("fromTs")),
              toTs: parseOptionalNumber(url.searchParams.get("toTs")),
            }),
          );
        }
        if (resource === "logs") {
          return jsonResponse(
            readModel.listNodeLogs(runId, {
              ...pagination,
              afterSeq: parseOptionalNumber(url.searchParams.get("afterSeq")),
              beforeSeq: parseOptionalNumber(url.searchParams.get("beforeSeq")),
              nodeId: url.searchParams.get("nodeId") ?? undefined,
              query: url.searchParams.get("query") ?? undefined,
              stream:
                url.searchParams.get("stream") === "stderr"
                  ? "stderr"
                  : url.searchParams.get("stream") === "stdout"
                    ? "stdout"
                    : undefined,
              fromTs: parseOptionalNumber(url.searchParams.get("fromTs")),
              toTs: parseOptionalNumber(url.searchParams.get("toTs")),
            }),
          );
        }
        if (resource === "merge-risk") {
          return jsonResponse(readModel.listMergeRiskSnapshots(runId, pagination));
        }
        if (resource === "tool-events") {
          return jsonResponse(await readModel.listAgentToolEvents(runId, pagination));
        }
        if (resource === "resources") {
          return jsonResponse(await readModel.listResourceSamples(runId, pagination));
        }

        return jsonResponse({ error: "Not Found" }, 404);
      }

      return jsonResponse({ error: "Not Found" }, 404);
    },
  });

  return {
    host: server.hostname,
    port: server.port,
    baseUrl: `http://${server.hostname}:${server.port}`,
    stop: async () => {
      clearInterval(pollTimer);
      stream.close();
      server.stop(true);
    },
  };
}

export function buildDashboardApiServerForTests(readModel: DashboardReadModel) {
  return readModel;
}
