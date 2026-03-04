import { escapeHtml, formatDate, formatDuration } from "../../components/format.ts";
import {
  buildSelectedUnitTimeline,
  computeRunHealthSummary,
  deriveSelectedUnitGateReason,
  summarizeSelectedUnitChanges,
} from "./selectors.ts";

export function renderRunCockpit(opts: {
  run: any | null;
  nodes: any[];
  attempts: any[];
  selectedUnitId: string | null;
  stageOutputs: any[];
  traces: any[];
}): string {
  const summary = computeRunHealthSummary({
    nodes: (opts.nodes ?? []).map((node) => ({
      nodeId: String(node.nodeId ?? ""),
      state: String(node.state ?? "unknown"),
    })),
    attempts: (opts.attempts ?? []).map((attempt) => ({
      nodeId: String(attempt.nodeId ?? ""),
      state: String(attempt.state ?? "unknown"),
    })),
  });

  const selectedTimeline = buildSelectedUnitTimeline({
    selectedUnitId: opts.selectedUnitId,
    attempts: (opts.attempts ?? []).map((attempt) => ({
      nodeId: String(attempt.nodeId ?? ""),
      iteration: Number(attempt.iteration ?? 0),
      attempt: Number(attempt.attempt ?? 0),
      state: String(attempt.state ?? "unknown"),
      startedAt: attempt.startedAt == null ? null : String(attempt.startedAt),
      durationMs: attempt.durationMs == null ? null : Number(attempt.durationMs),
    })),
  });
  const selectedGate = deriveSelectedUnitGateReason({
    selectedUnitId: opts.selectedUnitId,
    stageOutputs: (opts.stageOutputs ?? []).map((entry) => ({
      table: String(entry.table ?? ""),
      nodeId: entry.nodeId == null ? undefined : String(entry.nodeId),
      row:
        entry.row && typeof entry.row === "object"
          ? (entry.row as Record<string, unknown>)
          : {},
    })),
    traces: (opts.traces ?? []).map((trace) => ({
      unitId: String(trace.unitId ?? ""),
      traceCompleteness:
        typeof trace.traceCompleteness === "boolean" ? trace.traceCompleteness : null,
      uncoveredScenarios: Array.isArray(trace.uncoveredScenarios)
        ? trace.uncoveredScenarios.map((value: unknown) => String(value))
        : [],
      antiSlopFlags: Array.isArray(trace.antiSlopFlags)
        ? trace.antiSlopFlags.map((value: unknown) => String(value))
        : [],
    })),
  });
  const selectedChanges = summarizeSelectedUnitChanges({
    selectedUnitId: opts.selectedUnitId,
    stageOutputs: (opts.stageOutputs ?? []).map((entry) => ({
      table: String(entry.table ?? ""),
      nodeId: entry.nodeId == null ? undefined : String(entry.nodeId),
      iteration:
        Number.isFinite(Number(entry.iteration)) ? Number(entry.iteration) : undefined,
      row:
        entry.row && typeof entry.row === "object"
          ? (entry.row as Record<string, unknown>)
          : {},
    })),
  });

  const selectedTimelineCards = selectedTimeline.length
    ? selectedTimeline
        .map(
          (entry) => `
            <article class="glass-card node-card">
              <div class="node-title">${escapeHtml(entry.nodeId)}</div>
              <div class="node-meta">attempt #${entry.attempt} • ${escapeHtml(entry.state)}</div>
              <div class="node-meta">${escapeHtml(formatDate(entry.startedAt))} • ${formatDuration(entry.durationMs)}</div>
            </article>
          `,
        )
        .join("")
    : `<article class="glass-card node-card muted">Select a unit in the DAG for stage timeline details.</article>`;

  return `
    <section class="panel-grid panel-grid-kpi">
      <article class="glass-card kpi-card">
        <h3>Run Status</h3>
        <p class="kpi-value">${escapeHtml(String(opts.run?.status ?? "unknown"))}</p>
        <p class="kpi-sub">Duration ${formatDuration(opts.run?.durationMs)}</p>
      </article>
      <article class="glass-card kpi-card">
        <h3>Nodes</h3>
        <p class="kpi-value">${summary.finishedNodes}/${summary.totalNodes}</p>
        <p class="kpi-sub">${summary.runningNodes} running • ${summary.failedNodes} failed</p>
      </article>
      <article class="glass-card kpi-card">
        <h3>Attempts</h3>
        <p class="kpi-value">${summary.inFlightAttempts}</p>
        <p class="kpi-sub">in-flight • ${summary.failedAttempts} failed</p>
      </article>
      <article class="glass-card kpi-card">
        <h3>Pass Rate</h3>
        <p class="kpi-value">${Math.round(summary.passRate * 100)}%</p>
        <p class="kpi-sub">terminal attempt success</p>
      </article>
    </section>

    <section class="panel-grid panel-grid-duo">
      <article class="glass-card">
        <h3>Blocking Units</h3>
        <div class="chip-row">
          ${
            summary.blockingNodes.length > 0
              ? summary.blockingNodes
                  .map((nodeId) => `<span class="status-chip status-fail">${escapeHtml(nodeId)}</span>`)
                  .join("")
              : '<span class="status-chip status-pass">No blocking units</span>'
          }
        </div>
      </article>
      <article class="glass-card">
        <h3>Selected Unit Timeline</h3>
        <p class="kpi-sub">${escapeHtml(selectedGate.reason)}</p>
        <div class="grid-list">${selectedTimelineCards}</div>
        <div class="chip-row">
          ${
            selectedChanges.length
              ? selectedChanges
                  .slice(0, 6)
                  .map(
                    (change) =>
                      `<span class="status-chip status-running">${escapeHtml(`${change.table}: ${change.changedFields.slice(0, 2).join(", ")}`)}</span>`,
                  )
                  .join("")
              : '<span class="status-chip status-pending">No stage output diff yet</span>'
          }
        </div>
      </article>
    </section>
  `;
}
