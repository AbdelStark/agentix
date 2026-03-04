import { escapeHtml, formatDate, formatDuration } from "../../components/format.ts";
import {
  deriveLatestNavigationTargets,
  deriveRunPulseSummary,
  deriveStepBoardRows,
  deriveTimelineRows,
  filterStepBoardRows,
  sortStepBoardRows,
  type StepBoardFilterState,
  type StepBoardSort,
  type TimelineFilterState,
} from "./selectors.ts";

const STEP_FILTERS: Array<StepBoardFilterState["state"]> = [
  "all",
  "in-progress",
  "pending",
  "failed",
  "blocked",
  "completed",
];

const STEP_SORT_OPTIONS: StepBoardSort[] = [
  "newest",
  "failing-first",
  "pending-first",
  "longest-running",
];

const MAX_STEP_ROWS = 400;
const MAX_PROMPT_ROWS = 120;
const MAX_TIMELINE_ROWS = 300;
const MAX_TIMELINE_INPUT_ROWS = 2000;
const MAX_LIVE_TIMELINE_ROWS = 240;
const MAX_TOOL_ROWS = 80;
const MAX_RESOURCE_ROWS = 80;
const MAX_LIVE_ROWS = 40;

function statusClass(state: string): string {
  const normalized = String(state ?? "").toLowerCase();
  if (normalized === "finished" || normalized === "completed" || normalized === "pass") {
    return "status-pass";
  }
  if (normalized === "failed" || normalized === "error" || normalized === "critical") {
    return "status-fail";
  }
  if (normalized === "in-progress" || normalized === "running" || normalized === "high") {
    return "status-running";
  }
  return "status-pending";
}

function sourceClass(source: string): string {
  if (source === "agentix" || source === "smithers") return "status-running";
  if (source === "telemetry") return "status-pass";
  if (source === "resource") return "status-pending";
  return "status-fail";
}

function prettySortLabel(sort: StepBoardSort): string {
  if (sort === "failing-first") return "failing first";
  if (sort === "pending-first") return "pending first";
  if (sort === "longest-running") return "longest running";
  return "newest";
}

function shortSummary(value: string, limit: number): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, Math.max(0, limit - 1))}…`;
}

function toLiveTimelineEvents(liveEvents: any[]): any[] {
  return (liveEvents ?? []).map((event, index) => {
    const payload =
      event?.payload && typeof event.payload === "object"
        ? (event.payload as Record<string, unknown>)
        : {};
    const eventType = String(event?.type ?? "unknown");
    const source = String(event?.source ?? (eventType.startsWith("command.") ? "agentix" : "smithers"));
    const category = source === "telemetry"
      ? "tool"
      : source === "resource"
        ? "resource"
        : source === "agentix"
          ? "command"
          : "node";
    const summary = typeof payload.text === "string"
      ? shortSummary(payload.text, 140)
      : eventType;
    return {
      source,
      category,
      eventType,
      eventKey: String(event?.eventKey ?? `live:${eventType}:${event?.timestamp ?? ""}:${index}`),
      summary,
      timestamp: String(event?.timestamp ?? new Date(0).toISOString()),
      timestampMs:
        Number.isFinite(Number(event?.timestampMs)) ? Number(event.timestampMs) : Date.parse(String(event?.timestamp ?? "")),
      nodeId: payload.nodeId,
      attempt: payload.attempt,
      payload,
    };
  });
}

function pulseCountsCard(label: string, value: number, sub: string): string {
  return `
    <article class="glass-card kpi-card">
      <h3>${label}</h3>
      <p class="kpi-value">${value}</p>
      <p class="kpi-sub">${escapeHtml(sub)}</p>
    </article>
  `;
}

export function renderTelemetryCockpit(opts: {
  runStatus: string | null;
  nodes: any[];
  toolEvents: any[];
  resources: any[];
  prompts: any[];
  executionSteps: any[];
  timeline: any[];
  liveEvents: any[];
  stepBoardFilter: StepBoardFilterState;
  stepBoardSort: StepBoardSort;
  timelineFilters: TimelineFilterState;
  timelineFocusEventKey: string | null;
}): string {
  const stepRows = deriveStepBoardRows({
    nodes: opts.nodes ?? [],
    executionSteps: opts.executionSteps ?? [],
    liveEvents: opts.liveEvents ?? [],
  });
  const filteredStepRows = filterStepBoardRows(stepRows, opts.stepBoardFilter);
  const sortedStepRows = sortStepBoardRows(filteredStepRows, opts.stepBoardSort).slice(0, MAX_STEP_ROWS);

  const timelineInput = [
    ...(opts.timeline ?? []).slice(0, MAX_TIMELINE_INPUT_ROWS),
    ...toLiveTimelineEvents((opts.liveEvents ?? []).slice(0, MAX_LIVE_TIMELINE_ROWS)),
  ];

  const timelineRows = deriveTimelineRows(
    timelineInput,
    opts.timelineFilters,
  ).slice(0, MAX_TIMELINE_ROWS);

  const pulse = deriveRunPulseSummary({
    runStatus: opts.runStatus,
    stepRows,
    timelineRows,
  });

  const latestTargets = deriveLatestNavigationTargets(stepRows);

  const promptRows = (opts.prompts ?? [])
    .slice(0, MAX_PROMPT_ROWS)
    .map(
      (prompt) => `
        <tr>
          <td>${escapeHtml(String(prompt.nodeId ?? "-"))}</td>
          <td>#${Number(prompt.attempt ?? 0)}</td>
          <td><code>${escapeHtml(String(prompt.promptHash ?? "-"))}</code></td>
          <td>${Number(prompt.responseChars ?? 0)}</td>
          <td>${escapeHtml(String(prompt.promptPreview ?? ""))}</td>
          <td>${formatDate(prompt.timestamp)}</td>
        </tr>
      `,
    )
    .join("");

  const stepRowsMarkup = sortedStepRows
    .map((row) => {
      const debugLabel = `${row.nodeId} attempt ${row.attempt}`;
      return `
        <tr>
          <td>${escapeHtml(row.unitId)}</td>
          <td>${escapeHtml(row.stage)}</td>
          <td><code>${escapeHtml(row.nodeId)}</code></td>
          <td>#${row.attempt}</td>
          <td><span class="status-chip ${statusClass(row.state)}">${escapeHtml(row.state)}</span></td>
          <td>${formatDuration(row.durationMs)}</td>
          <td>${formatDate(row.lastUpdate)}</td>
          <td>
            <div class="step-jump-actions">
              <button
                type="button"
                class="lucid-button lucid-button-xs"
                data-step-jump="attempts"
                data-jump-node="${escapeHtml(row.nodeId)}"
                data-jump-attempt="${row.attempt}"
                aria-label="Jump to attempts for ${escapeHtml(debugLabel)}"
              >
                Attempts
              </button>
              <button
                type="button"
                class="lucid-button lucid-button-xs"
                data-step-jump="logs"
                data-jump-node="${escapeHtml(row.nodeId)}"
                data-jump-attempt="${row.attempt}"
                aria-label="Jump to logs for ${escapeHtml(debugLabel)}"
              >
                Logs
              </button>
              <button
                type="button"
                class="lucid-button lucid-button-xs"
                data-step-jump="timeline"
                data-jump-node="${escapeHtml(row.nodeId)}"
                data-jump-attempt="${row.attempt}"
                aria-label="Jump to timeline context for ${escapeHtml(debugLabel)}"
              >
                Timeline
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  const timelineRowsMarkup = timelineRows
    .map((event) => {
      const focused = opts.timelineFocusEventKey && opts.timelineFocusEventKey === event.eventKey;
      return `
        <article class="glass-card timeline-event-card ${focused ? "focused" : ""}">
          <header class="timeline-event-header">
            <div class="timeline-chip-stack">
              <span class="status-chip ${statusClass(event.severity)}">${escapeHtml(event.severity)}</span>
              <span class="status-chip ${statusClass(event.status)}">${escapeHtml(event.status)}</span>
              <span class="status-chip ${sourceClass(event.source)}">${escapeHtml(event.source)}</span>
            </div>
            <div class="timeline-event-time">
              <span>${escapeHtml(event.relativeTime)}</span>
              <span class="muted">${escapeHtml(formatDate(event.timestamp))}</span>
            </div>
          </header>
          <p class="timeline-event-summary">${escapeHtml(event.summary)}</p>
          <p class="muted">
            ${escapeHtml(event.eventType)}
            ${event.nodeId ? ` • ${escapeHtml(event.nodeId)}` : ""}
            ${event.attempt != null ? ` • attempt #${event.attempt}` : ""}
          </p>
          <details class="audit-meta">
            <summary>Raw payload</summary>
            <pre class="audit-block">${escapeHtml(JSON.stringify(event.payload, null, 2))}</pre>
          </details>
        </article>
      `;
    })
    .join("");

  const toolRows = (opts.toolEvents ?? [])
    .slice(0, MAX_TOOL_ROWS)
    .map(
      (event) => `
        <tr>
          <td>${escapeHtml(String(event.provider ?? "-"))}</td>
          <td>${escapeHtml(String(event.eventType ?? "-"))}</td>
          <td>${escapeHtml(String(event.toolName ?? "-"))}</td>
          <td>${event.tokenUsage?.total ?? "-"}</td>
          <td>${formatDate(event.timestamp)}</td>
        </tr>
      `,
    )
    .join("");

  const resourceRows = (opts.resources ?? [])
    .slice(0, MAX_RESOURCE_ROWS)
    .map(
      (sample) => `
        <tr>
          <td>${formatDate(sample.timestamp)}</td>
          <td>${escapeHtml(String(sample.nodeId ?? "-"))}</td>
          <td>${sample.cpuPercent ?? "-"}</td>
          <td>${sample.memoryRssMb ?? "-"}</td>
        </tr>
      `,
    )
    .join("");

  const liveRows = (opts.liveEvents ?? [])
    .slice(0, MAX_LIVE_ROWS)
    .map(
      (event) => `
        <div class="feed-row">
          <span>${escapeHtml(String(event.type ?? "-"))}</span>
          <span class="muted">${formatDate(event.timestamp)}</span>
        </div>
      `,
    )
    .join("");

  const filterButtons = STEP_FILTERS.map((state) => `
    <button
      type="button"
      class="lucid-button lucid-button-xs ${opts.stepBoardFilter.state === state ? "is-active" : ""}"
      data-step-filter="${state}"
      aria-pressed="${opts.stepBoardFilter.state === state ? "true" : "false"}"
    >
      ${escapeHtml(state)}
    </button>
  `).join("");

  const timelineFilterSummary = `${timelineRows.length} shown`;
  const latestCriticalSummary = pulse.lastCriticalEvent
    ? `${pulse.lastCriticalEvent.eventType} • ${pulse.lastCriticalEvent.relativeTime}`
    : "No critical event";

  return `
    <section class="panel-grid panel-grid-kpi">
      <article class="glass-card kpi-card">
        <h3>Run Status</h3>
        <p class="kpi-value">${escapeHtml(pulse.runStatus)}</p>
        <p class="kpi-sub">Most recent ${escapeHtml(pulse.latestStep?.nodeId ?? "no step yet")}</p>
      </article>
      ${pulseCountsCard("In Progress", pulse.inProgressCount, `${pulse.pendingCount} pending`)}
      ${pulseCountsCard("Failures", pulse.failedCount, `${pulse.blockedCount} blocked`)}
      <article class="glass-card kpi-card">
        <h3>Last Critical Event</h3>
        <p class="kpi-value">${escapeHtml(String(pulse.lastCriticalEvent ? "1" : "0"))}</p>
        <p class="kpi-sub">${escapeHtml(latestCriticalSummary)}</p>
      </article>
    </section>

    <section class="glass-card pulse-jump-card">
      <header class="row-header">
        <h3>Quick jump</h3>
        <p class="muted">One-click access to high-value debugging paths.</p>
      </header>
      <div class="chip-row pulse-jump-row">
        <button type="button" class="lucid-button" data-jump-latest="failed" ${latestTargets.latestFailed ? "" : "disabled"}>Latest Failed Step</button>
        <button type="button" class="lucid-button" data-jump-latest="pending" ${latestTargets.latestPending ? "" : "disabled"}>Latest Pending Step</button>
        <button type="button" class="lucid-button" data-jump-latest="in-progress" ${latestTargets.latestInProgress ? "" : "disabled"}>Latest In-Progress Step</button>
        <button type="button" class="lucid-button" data-jump-critical="true" ${pulse.lastCriticalEvent ? "" : "disabled"}>Latest Critical Event</button>
      </div>
    </section>

    <section class="panel-grid panel-grid-duo">
      <article class="glass-card">
        <header class="row-header">
          <h3>Step Status Board</h3>
          <p class="muted">${filteredStepRows.length} matching steps</p>
        </header>
        <div class="step-board-controls">
          <div class="step-filter-row">${filterButtons}</div>
          <div class="step-input-row">
            <label>
              Search
              <input
                id="step-board-search"
                class="lucid-input"
                value="${escapeHtml(opts.stepBoardFilter.query)}"
                placeholder="unit, stage, node, status"
              />
            </label>
            <label>
              Sort
              <select id="step-board-sort" class="lucid-input">
                ${
                  STEP_SORT_OPTIONS
                    .map((option) => `
                      <option value="${option}" ${option === opts.stepBoardSort ? "selected" : ""}>${prettySortLabel(option)}</option>
                    `)
                    .join("")
                }
              </select>
            </label>
          </div>
        </div>
        <div class="table-wrap">
          <table class="lucid-table">
            <thead>
              <tr><th>Unit</th><th>Stage</th><th>Node</th><th>Attempt</th><th>State</th><th>Duration</th><th>Last Update</th><th>Debug</th></tr>
            </thead>
            <tbody>
              ${
                stepRowsMarkup ||
                "<tr><td colspan='8'>No step data for this run yet.</td></tr>"
              }
            </tbody>
          </table>
        </div>
      </article>

      <article class="glass-card">
        <header class="row-header">
          <h3>Prompt Audit</h3>
          <p class="muted">Prompt and response traces tied to concrete attempts.</p>
        </header>
        <div class="table-wrap">
          <table class="lucid-table">
            <thead>
              <tr><th>Node</th><th>Attempt</th><th>Prompt Hash</th><th>Response Chars</th><th>Prompt Preview</th><th>Time</th></tr>
            </thead>
            <tbody>${promptRows || "<tr><td colspan='6'>No prompt audit records yet.</td></tr>"}</tbody>
          </table>
        </div>
      </article>
    </section>

    <section class="glass-card">
      <header class="row-header">
        <h3>Critical-First Timeline</h3>
        <p class="muted">${escapeHtml(timelineFilterSummary)}</p>
      </header>
      <div class="timeline-toolbar">
        <label class="lucid-toggle"><input type="checkbox" id="timeline-filter-critical" ${opts.timelineFilters.criticalOnly ? "checked" : ""} />critical only</label>
        <label class="lucid-toggle"><input type="checkbox" id="timeline-filter-failures" ${opts.timelineFilters.failuresOnly ? "checked" : ""} />failures only</label>
        <label class="lucid-toggle"><input type="checkbox" id="timeline-filter-system" ${opts.timelineFilters.systemEvents ? "checked" : ""} />system events</label>
        <label class="lucid-toggle"><input type="checkbox" id="timeline-filter-tool" ${opts.timelineFilters.toolEvents ? "checked" : ""} />tool events</label>
        <label class="lucid-toggle"><input type="checkbox" id="timeline-filter-resource-anomalies" ${opts.timelineFilters.resourceAnomalies ? "checked" : ""} />resource anomalies</label>
        <label class="timeline-search-label">
          Search
          <input id="timeline-search" class="lucid-input" value="${escapeHtml(opts.timelineFilters.query)}" placeholder="event type, node, summary, payload" />
        </label>
      </div>
      <div class="timeline-event-list">
        ${timelineRowsMarkup || "<p class='muted'>No timeline events for current filters.</p>"}
      </div>
    </section>

    <section class="panel-grid panel-grid-duo">
      <article class="glass-card">
        <h3>Agent Tool Events</h3>
        <div class="table-wrap">
          <table class="lucid-table">
            <thead>
              <tr><th>Provider</th><th>Event</th><th>Tool</th><th>Tokens</th><th>Time</th></tr>
            </thead>
            <tbody>${toolRows || "<tr><td colspan='5'>No telemetry events yet.</td></tr>"}</tbody>
          </table>
        </div>
      </article>
      <article class="glass-card">
        <h3>Resource Samples</h3>
        <div class="table-wrap">
          <table class="lucid-table">
            <thead>
              <tr><th>Time</th><th>Node</th><th>CPU%</th><th>RSS MB</th></tr>
            </thead>
            <tbody>${resourceRows || "<tr><td colspan='4'>No samples yet.</td></tr>"}</tbody>
          </table>
        </div>
      </article>
    </section>

    <section class="glass-card">
      <h3>Live Event Pulse</h3>
      <p class="muted">Recent stream events while read models refresh.</p>
      <div class="feed-list">${liveRows || "<p class='muted'>No live events yet.</p>"}</div>
    </section>
  `;
}
