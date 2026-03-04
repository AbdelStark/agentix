/**
 * agentix dashboard — Launch local observability dashboard API + web UI.
 */

import { getAgentixDir, type ParsedArgs } from "./shared";
import { appendAgentixEvent } from "./events";
import {
  startDashboardApiServer,
  type DashboardApiServer,
} from "./dashboard-api";

export type DashboardCmdDeps = {
  startServer?: typeof startDashboardApiServer;
  appendAgentixEvent?: typeof appendAgentixEvent;
  waitForSignal?: () => Promise<void>;
  openBrowser?: (url: string) => Promise<void>;
};

function parsePort(flags: ParsedArgs["flags"]): number {
  const raw = typeof flags.port === "string" ? Number(flags.port) : 43110;
  if (!Number.isFinite(raw) || raw < 0 || raw > 65535) {
    throw new Error(`Invalid --port value: ${String(flags.port)}`);
  }
  return Math.floor(raw);
}

function parseHost(flags: ParsedArgs["flags"]): string {
  const host = typeof flags.host === "string" && flags.host.trim()
    ? flags.host.trim()
    : "127.0.0.1";
  return host;
}

function shouldOpenBrowser(flags: ParsedArgs["flags"]): boolean {
  if (flags.open === true) return true;
  if (typeof flags.open === "string") {
    return ["1", "true", "yes"].includes(flags.open.toLowerCase());
  }
  return false;
}

function isLocalHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function defaultWaitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    const onSignal = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}

async function defaultOpenBrowser(url: string): Promise<void> {
  let command: string[];
  if (process.platform === "darwin") {
    command = ["open", url];
  } else if (process.platform === "win32") {
    command = ["cmd", "/c", "start", "", url];
  } else {
    command = ["xdg-open", url];
  }

  const proc = Bun.spawn(command, {
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
}

export async function runDashboard(opts: {
  flags: ParsedArgs["flags"];
  repoRoot: string;
  deps?: DashboardCmdDeps;
}): Promise<void> {
  const { flags, repoRoot, deps } = opts;
  const startServer = deps?.startServer ?? startDashboardApiServer;
  const appendEvent = deps?.appendAgentixEvent ?? appendAgentixEvent;
  const waitForSignal = deps?.waitForSignal ?? defaultWaitForSignal;
  const openBrowser = deps?.openBrowser ?? defaultOpenBrowser;

  const agentixDir = getAgentixDir(repoRoot);
  const startedAt = Date.now();
  const host = parseHost(flags);
  const port = parsePort(flags);
  const token = typeof flags.token === "string" ? flags.token : null;

  if (!isLocalHost(host) && !token) {
    throw new Error(
      "Refusing non-local dashboard binding without auth token. Use --token <value>.",
    );
  }

  await appendEvent(agentixDir, {
    level: "info",
    event: "command.started",
    command: "dashboard",
    details: {
      repoRoot,
      host,
      port,
    },
  });

  let server: DashboardApiServer | null = null;

  try {
    server = await startServer({
      repoRoot,
      host,
      port,
      heartbeatMs:
        typeof flags["heartbeat-ms"] === "string"
          ? Number(flags["heartbeat-ms"]) || 1000
          : 1000,
      replayLimit:
        typeof flags["replay-limit"] === "string"
          ? Number(flags["replay-limit"]) || 500
          : 500,
      apiToken: token,
    });

    const dashboardUrl = token
      ? `${server.baseUrl}/dashboard/index.html?token=${encodeURIComponent(token)}`
      : `${server.baseUrl}/dashboard/index.html`;
    console.log(`Agentix Dashboard listening on ${dashboardUrl}`);

    if (shouldOpenBrowser(flags)) {
      await openBrowser(dashboardUrl);
    }

    await waitForSignal();

    await server.stop();
    server = null;

    await appendEvent(agentixDir, {
      level: "info",
      event: "command.completed",
      command: "dashboard",
      details: {
        durationMs: Date.now() - startedAt,
        host,
        port,
      },
    });
  } catch (error) {
    if (server) {
      await server.stop().catch(() => undefined);
    }

    const message = error instanceof Error ? error.message : String(error);
    await appendEvent(agentixDir, {
      level: "error",
      event: "command.failed",
      command: "dashboard",
      details: {
        durationMs: Date.now() - startedAt,
        message,
      },
    });
    throw error;
  }
}
