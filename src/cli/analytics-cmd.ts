import { randomUUID } from "node:crypto";

import { appendAgentixEvent } from "./events";
import { getAgentixDir, type ParsedArgs } from "./shared";
import {
  analyzeTelemetryFile,
  DEFAULT_ANALYTICS_WINDOW,
  DEFAULT_FAILURE_TOP,
  renderQualityReport,
  writeDailySnapshot,
  writeQualityReport,
} from "./analytics";

type ExitAdapter = (code: number) => never | void;

type AnalyticsCmdDeps = {
  appendAgentixEvent?: typeof appendAgentixEvent;
  now?: () => Date;
  writeLine?: (line: string) => void;
  exit?: ExitAdapter;
};

function printHelp(writeLine: (line: string) => void): void {
  writeLine(`agentix analytics — telemetry aggregation and failure intelligence

Usage:
  agentix analytics summary --window 7d [--json] [--write-report]
  agentix analytics failures --window 7d --top 10 [--json]

Options:
  --window <duration>         Time window like 7d, 24h, 30m (default: 7d)
  --top <n>                   Max failure rows for failures command (default: 10)
  --json                      Emit machine-readable JSON
  --write-report              Generate docs/ops/quality-report.md (summary only)
  --help                      Show this help
`);
}

export async function runAnalyticsCommand(opts: {
  positional: string[];
  flags: ParsedArgs["flags"];
  repoRoot: string;
  deps?: AnalyticsCmdDeps;
}): Promise<void> {
  const { positional, flags, repoRoot, deps } = opts;
  const appendEvent = deps?.appendAgentixEvent ?? appendAgentixEvent;
  const writeLine = deps?.writeLine ?? ((line: string) => console.log(line));
  const now = deps?.now ?? (() => new Date());
  const exit: ExitAdapter = deps?.exit ?? ((code: number) => process.exit(code));

  if (flags.help) {
    printHelp(writeLine);
    return;
  }

  const startedAt = now();
  const sessionId = `analytics-${startedAt.getTime().toString(36)}-${randomUUID().slice(0, 8)}`;
  const action = positional[0] ?? "summary";
  const agentixDir = getAgentixDir(repoRoot);

  await appendEvent(agentixDir, {
    level: "info",
    event: "command.started",
    command: "analytics",
    sessionId,
    details: {
      action,
      repoRoot,
      window: flags.window ?? DEFAULT_ANALYTICS_WINDOW,
      top: flags.top ?? DEFAULT_FAILURE_TOP,
    },
  });

  try {
    if (action !== "summary" && action !== "failures") {
      throw new Error(`Unknown analytics action: ${action}`);
    }

    const window =
      typeof flags.window === "string" ? flags.window : DEFAULT_ANALYTICS_WINDOW;
    const top =
      typeof flags.top === "string"
        ? Math.max(1, Math.floor(Number(flags.top) || DEFAULT_FAILURE_TOP))
        : DEFAULT_FAILURE_TOP;
    const jsonMode = flags.json === true;

    const { summary } = await analyzeTelemetryFile({
      repoRoot,
      now: startedAt,
      window,
      topFailures: top,
      excludeSessionId: sessionId,
    });

    if (action === "summary") {
      const snapshotPath = await writeDailySnapshot(agentixDir, summary, {
        now: startedAt,
      });
      const shouldWriteReport = flags["write-report"] === true;
      const reportPath = shouldWriteReport
        ? await writeQualityReport(repoRoot, renderQualityReport(summary))
        : null;

      if (jsonMode) {
        writeLine(
          JSON.stringify(
            {
              summary,
              snapshotPath,
              reportPath,
            },
            null,
            2,
          ),
        );
      } else {
        writeLine(`Telemetry Summary (${summary.window.label})`);
        writeLine(`- Parsed events: ${summary.source.parsedEvents}`);
        writeLine(`- Failed commands: ${summary.totals.failed}`);
        writeLine(`- Success rate: ${(summary.totals.successRate * 100).toFixed(2)}%`);
        writeLine(`- Median/P95 duration: ${summary.durationsMs.median}ms / ${summary.durationsMs.p95}ms`);
        writeLine(`- Snapshot: ${snapshotPath}`);
        if (reportPath) writeLine(`- Report: ${reportPath}`);
      }

      await appendEvent(agentixDir, {
        level: "info",
        event: "command.completed",
        command: "analytics",
        sessionId,
        details: {
          action,
          durationMs: now().getTime() - startedAt.getTime(),
          window,
          top,
          parsedEvents: summary.source.parsedEvents,
          malformedLines: summary.source.malformedLines,
          snapshotPath,
          reportPath,
        },
      });
      return;
    }

    const failures = summary.failures.topByCommand.slice(0, top);

    if (jsonMode) {
      writeLine(
        JSON.stringify(
          {
            window: summary.window,
            failures,
            taxonomy: summary.failures.taxonomy,
          },
          null,
          2,
        ),
      );
    } else {
      writeLine(`Top Failures (${summary.window.label})`);
      if (failures.length === 0) {
        writeLine("- None in selected window.");
      } else {
        for (const failure of failures) {
          writeLine(
            `- ${failure.command}: ${failure.reason} (${failure.count}) [${failure.taxonomy}]`,
          );
        }
      }
    }

    await appendEvent(agentixDir, {
      level: "info",
      event: "command.completed",
      command: "analytics",
      sessionId,
      details: {
        action,
        durationMs: now().getTime() - startedAt.getTime(),
        window,
        top,
        parsedEvents: summary.source.parsedEvents,
        malformedLines: summary.source.malformedLines,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = deriveAnalyticsFailureReason(action, message);

    await appendEvent(agentixDir, {
      level: "error",
      event: "command.failed",
      command: "analytics",
      sessionId,
      details: {
        action,
        reason,
        message,
        durationMs: now().getTime() - startedAt.getTime(),
      },
    });

    if (reason === "unknown-analytics-action") {
      printHelp(writeLine);
      exit(1);
      return;
    }

    throw error;
  }
}

function deriveAnalyticsFailureReason(action: string, message: string): string {
  if (!action || (action !== "summary" && action !== "failures")) {
    return "unknown-analytics-action";
  }

  if (/invalid window/i.test(message)) {
    return "invalid-window";
  }

  if (/top/i.test(message) && /invalid/i.test(message)) {
    return "invalid-analytics-args";
  }

  return "analytics-runtime-error";
}
