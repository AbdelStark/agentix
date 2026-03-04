/// <reference lib="dom" />

import { dashboardApi } from "./components/api-client.ts";
import { escapeHtml, formatDate, formatDuration } from "./components/format.ts";
import { deriveAttemptFocusFromEvent } from "./modules/attempt-explorer/grouping.ts";
import { renderRunCockpit } from "./modules/run-cockpit/render.ts";
import { defaultDagFilters, renderDag, type DagFilterState } from "./modules/dag/render.ts";
import { renderAttemptExplorer } from "./modules/attempt-explorer/render.ts";
import { renderGateBoard } from "./modules/gates/render.ts";
import { renderRiskPanel } from "./modules/risk/render.ts";
import { renderTracePanel } from "./modules/trace/render.ts";
import { renderAnalyticsPanel } from "./modules/analytics/render.ts";

type ModuleId = "cockpit" | "dag" | "attempts" | "readiness" | "analytics" | "telemetry";

type ModuleDef = {
  id: ModuleId;
  label: string;
  shortcut: string;
};

const MODULES: ModuleDef[] = [
  { id: "cockpit", label: "Cockpit", shortcut: "1" },
  { id: "dag", label: "DAG", shortcut: "2" },
  { id: "attempts", label: "Attempts", shortcut: "3" },
  { id: "readiness", label: "Readiness", shortcut: "4" },
  { id: "analytics", label: "Analytics", shortcut: "5" },
  { id: "telemetry", label: "Telemetry", shortcut: "6" },
];

export function getDashboardModules(): ModuleDef[] {
  return MODULES;
}

export function resolveModuleByShortcut(key: string): ModuleId | null {
  const match = MODULES.find((entry) => entry.shortcut === key);
  return match ? match.id : null;
}

type AppState = {
  loading: boolean;
  error: string | null;
  selectedModule: ModuleId;
  runs: any[];
  selectedRunId: string | null;
  runSummary: any | null;
  nodes: any[];
  attempts: any[];
  events: any[];
  logs: any[];
  stageOutputs: any[];
  mergeRisk: any[];
  traces: any[];
  analyticsSnapshots: any[];
  commands: any[];
  workPlan: { units: any[] } | null;
  warnings: string[];
  liveEvents: any[];
  sseCursor: number;
  sseConnected: boolean;
  lastHeartbeat: string | null;
  paletteOpen: boolean;
  runSearch: string;
  selectedUnitId: string | null;
  dagFilters: DagFilterState;
  logStreamFilter: "all" | "stdout" | "stderr";
  logSearch: string;
  attemptsNodeFilter: string | null;
  attemptsAttemptFilter: number | null;
  logViewportHeightPx: number;
  logScrollTopPx: number;
  toolEvents: any[];
  resources: any[];
};

const state: AppState = {
  loading: true,
  error: null,
  selectedModule: "cockpit",
  runs: [],
  selectedRunId: null,
  runSummary: null,
  nodes: [],
  attempts: [],
  events: [],
  logs: [],
  stageOutputs: [],
  mergeRisk: [],
  traces: [],
  analyticsSnapshots: [],
  commands: [],
  workPlan: null,
  warnings: [],
  liveEvents: [],
  sseCursor: 0,
  sseConnected: false,
  lastHeartbeat: null,
  paletteOpen: false,
  runSearch: "",
  selectedUnitId: null,
  dagFilters: defaultDagFilters(),
  logStreamFilter: "all",
  logSearch: "",
  attemptsNodeFilter: null,
  attemptsAttemptFilter: null,
  logViewportHeightPx: 420,
  logScrollTopPx: 0,
  toolEvents: [],
  resources: [],
};

let eventSource: EventSource | null = null;
let refreshDebounceTimer: Timer | null = null;
let logViewportRaf: number | null = null;

function scheduleRunRefresh() {
  if (!state.selectedRunId) return;
  if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
  refreshDebounceTimer = setTimeout(() => {
    refreshRunScopedData(state.selectedRunId!).catch((error) => {
      state.error = error instanceof Error ? error.message : String(error);
      render();
    });
  }, 250);
}

function collectWarnings(...sources: Array<{ meta?: { warnings?: string[] }; warnings?: string[] }>): string[] {
  const values = new Set<string>();
  for (const source of sources) {
    for (const warning of source.meta?.warnings ?? []) {
      if (warning) values.add(warning);
    }
    for (const warning of source.warnings ?? []) {
      if (warning) values.add(warning);
    }
  }
  return [...values];
}

function setAttemptFocus(nodeId: string | null, attempt: number | null) {
  state.attemptsNodeFilter = nodeId && nodeId.trim() ? nodeId.trim() : null;
  state.attemptsAttemptFilter =
    Number.isFinite(attempt) && attempt != null ? Math.max(0, Math.floor(attempt)) : null;
  state.logScrollTopPx = 0;
}

async function refreshRunScopedData(runId: string) {
  const [runSummary, nodes, attempts, events, logs, stageOutputs, mergeRisk, toolEvents, resources] =
    await Promise.all([
      dashboardApi.getRun(runId),
      dashboardApi.listNodes(runId),
      dashboardApi.listAttempts(runId),
      dashboardApi.listEvents(runId),
      dashboardApi.listLogs(runId),
      dashboardApi.listStageOutputs(runId),
      dashboardApi.listMergeRisk(runId),
      dashboardApi.listToolEvents(runId),
      dashboardApi.listResources(runId),
    ]);

  state.runSummary = runSummary;
  state.nodes = nodes.items ?? [];
  state.attempts = attempts.items ?? [];
  state.events = events.items ?? [];
  state.logs = logs.items ?? [];
  state.stageOutputs = stageOutputs.items ?? [];
  state.mergeRisk = mergeRisk.items ?? [];
  state.toolEvents = toolEvents.items ?? [];
  state.resources = resources.items ?? [];
  state.warnings = collectWarnings(nodes, attempts, events, logs, stageOutputs, mergeRisk, toolEvents, resources);
}

function connectLiveStream() {
  if (!state.selectedRunId) return;
  if (eventSource) eventSource.close();

  const params = new URLSearchParams({
    runId: state.selectedRunId,
    afterSeq: String(state.sseCursor),
  });
  const token = new URLSearchParams(window.location.search).get("token");
  if (token) params.set("token", token);

  eventSource = new EventSource(`/api/stream?${params.toString()}`);
  eventSource.onopen = () => {
    state.sseConnected = true;
    renderHeaderOnly();
  };

  eventSource.onerror = () => {
    state.sseConnected = false;
    renderHeaderOnly();
  };

  eventSource.onmessage = (message) => {
    try {
      const payload = JSON.parse(message.data) as any;
      if (payload.type === "heartbeat") {
        state.lastHeartbeat = payload.timestamp;
        state.sseCursor = Number(payload.cursor ?? state.sseCursor);
        renderHeaderOnly();
        return;
      }

      state.sseCursor = Math.max(state.sseCursor, Number(payload.seq ?? 0));
      state.liveEvents.unshift(payload);
      state.liveEvents = state.liveEvents.slice(0, 120);

      if (payload.type === "NodeOutput") {
        const stream = payload.payload?.stream === "stderr" ? "stderr" : "stdout";
        state.logs.unshift({
          nodeId: String(payload.payload?.nodeId ?? ""),
          attempt:
            Number.isFinite(Number(payload.payload?.attempt))
              ? Number(payload.payload?.attempt)
              : null,
          stream,
          text: String(payload.payload?.text ?? ""),
          timestamp: payload.timestamp,
        });
        state.logs = state.logs.slice(0, 5000);
      }

      if (["NodeFinished", "NodeFailed", "command.completed", "command.failed"].includes(payload.type)) {
        scheduleRunRefresh();
      }

      if (state.selectedModule === "attempts" || state.selectedModule === "cockpit") {
        renderModuleOnly();
      }
      renderHeaderOnly();
    } catch {
      // Ignore malformed live events.
    }
  };
}

function renderSidebarRuns(): string {
  const query = state.runSearch.trim().toLowerCase();
  const runs = state.runs.filter((run) => {
    if (!query) return true;
    return (
      String(run.runId ?? "").toLowerCase().includes(query) ||
      String(run.status ?? "").toLowerCase().includes(query)
    );
  });

  return runs
    .map((run) => {
      const selected = run.runId === state.selectedRunId;
      return `
        <button class="run-item ${selected ? "selected" : ""}" data-run-id="${escapeHtml(String(run.runId ?? ""))}">
          <span class="run-id">${escapeHtml(String(run.runId ?? ""))}</span>
          <span class="run-meta">${escapeHtml(String(run.status ?? "unknown"))} • ${formatDuration(run.durationMs)}</span>
          <span class="run-meta">${formatDate(run.createdAt)}</span>
        </button>
      `;
    })
    .join("");
}

function renderModuleContent(): string {
  if (!state.selectedRunId) {
    return `
      <article class="glass-card empty-card">
        <h3>No Runs Found</h3>
        <p>Start a workflow with <code>agentix run</code>, then refresh this dashboard.</p>
        <p class="muted">Diagnostics: API is reachable but run list is empty.</p>
      </article>
    `;
  }

  if (state.selectedModule === "cockpit") {
    return `
      ${renderRunCockpit({
        run: state.runSummary?.run ?? null,
        nodes: state.nodes,
        attempts: state.attempts,
        selectedUnitId: state.selectedUnitId,
        stageOutputs: state.stageOutputs,
        traces: state.traces,
      })}
      <section class="panel-grid panel-grid-duo">
        <article class="glass-card">
          <h3>Live Event Feed</h3>
          <div class="feed-list">
            ${
              state.liveEvents
                .slice(0, 25)
                .map(
                  (event) => `
                    <div class="feed-row">
                      <span>${event.type}</span>
                      <span class="muted">${event.timestamp}</span>
                    </div>
                  `,
                )
                .join("") || "<p class='muted'>Waiting for live events.</p>"
            }
          </div>
        </article>
        <article class="glass-card">
          <h3>Diagnostics</h3>
          <p class="kpi-sub">SSE ${state.sseConnected ? "connected" : "disconnected"}</p>
          <p class="kpi-sub">Last heartbeat ${state.lastHeartbeat ? formatDate(state.lastHeartbeat) : "-"}</p>
          <p class="kpi-sub">Cursor ${state.sseCursor}</p>
        </article>
      </section>
    `;
  }

  if (state.selectedModule === "dag") {
    return `
      <section class="glass-card filter-bar">
        <label>Tier
          <select id="dag-filter-tier" class="lucid-input">
            <option value="all" ${state.dagFilters.tier === "all" ? "selected" : ""}>all</option>
            <option value="trivial" ${state.dagFilters.tier === "trivial" ? "selected" : ""}>trivial</option>
            <option value="small" ${state.dagFilters.tier === "small" ? "selected" : ""}>small</option>
            <option value="medium" ${state.dagFilters.tier === "medium" ? "selected" : ""}>medium</option>
            <option value="large" ${state.dagFilters.tier === "large" ? "selected" : ""}>large</option>
          </select>
        </label>
        <label>Priority
          <select id="dag-filter-priority" class="lucid-input">
            <option value="all" ${state.dagFilters.priority === "all" ? "selected" : ""}>all</option>
            <option value="critical" ${state.dagFilters.priority === "critical" ? "selected" : ""}>critical</option>
            <option value="high" ${state.dagFilters.priority === "high" ? "selected" : ""}>high</option>
            <option value="medium" ${state.dagFilters.priority === "medium" ? "selected" : ""}>medium</option>
            <option value="low" ${state.dagFilters.priority === "low" ? "selected" : ""}>low</option>
          </select>
        </label>
        <label class="lucid-toggle"><input type="checkbox" id="dag-filter-failed" ${state.dagFilters.failedOnly ? "checked" : ""} />failed only</label>
        <label class="lucid-toggle"><input type="checkbox" id="dag-filter-evicted" ${state.dagFilters.evictedOnly ? "checked" : ""} />evicted only</label>
      </section>
      ${renderDag({
        workPlan: state.workPlan,
        nodes: state.nodes,
        mergeRiskRows: state.mergeRisk,
        filters: state.dagFilters,
      })}
    `;
  }

  if (state.selectedModule === "attempts") {
    return renderAttemptExplorer({
      attempts: state.attempts,
      events: state.events,
      logs: state.logs,
      streamFilter: state.logStreamFilter,
      search: state.logSearch,
      selectedNodeId: state.attemptsNodeFilter,
      selectedAttempt: state.attemptsAttemptFilter,
      viewport: {
        rowHeightPx: 40,
        viewportHeightPx: state.logViewportHeightPx,
        scrollTopPx: state.logScrollTopPx,
        overscanRows: 8,
      },
    });
  }

  if (state.selectedModule === "readiness") {
    return `
      ${renderGateBoard({ stageOutputs: state.stageOutputs, traces: state.traces })}
      ${renderRiskPanel({ mergeRiskRows: state.mergeRisk })}
      ${renderTracePanel({ traces: state.traces })}
    `;
  }

  if (state.selectedModule === "analytics") {
    return renderAnalyticsPanel({ analyticsSnapshots: state.analyticsSnapshots });
  }

  return renderTelemetryPanel();
}

function renderTelemetryPanel(): string {
  const toolRows = state.toolEvents
    .slice(0, 80)
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

  const resourceRows = state.resources
    .slice(0, 80)
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

  return `
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
  `;
}

function renderPalette(): string {
  if (!state.paletteOpen) return "";

  const moduleRows = MODULES.map(
    (module) => `
      <button class="palette-item" data-palette-module="${module.id}">
        <span>${escapeHtml(module.label)}</span>
        <span class="muted">${module.shortcut}</span>
      </button>
    `,
  ).join("");

  const runRows = state.runs
    .slice(0, 8)
    .map(
      (run) => `
        <button class="palette-item" data-palette-run="${run.runId}">
          <span>${escapeHtml(String(run.runId ?? ""))}</span>
          <span class="muted">${escapeHtml(String(run.status ?? "unknown"))}</span>
        </button>
      `,
    )
    .join("");

  return `
    <div class="palette-backdrop" id="palette-backdrop">
      <div class="glass-card palette-panel" role="dialog" aria-modal="true">
        <h3>Command Palette</h3>
        <p class="muted">Switch modules and runs with keyboard precision.</p>
        <div class="palette-columns">
          <section>
            <h4>Modules</h4>
            ${moduleRows}
          </section>
          <section>
            <h4>Runs</h4>
            ${runRows || "<p class='muted'>No runs.</p>"}
          </section>
        </div>
      </div>
    </div>
  `;
}

function renderHeaderOnly() {
  const statusEl = document.getElementById("live-status");
  const hbEl = document.getElementById("live-heartbeat");
  if (statusEl) {
    statusEl.textContent = state.sseConnected ? "Live" : "Offline";
    statusEl.className = `status-chip ${state.sseConnected ? "status-pass" : "status-fail"}`;
  }
  if (hbEl) {
    hbEl.textContent = state.lastHeartbeat
      ? `Heartbeat ${formatDate(state.lastHeartbeat)}`
      : "Heartbeat -";
  }
}

function renderModuleOnly() {
  const moduleRoot = document.getElementById("module-content");
  if (!moduleRoot) return;
  moduleRoot.innerHTML = renderModuleContent();
  bindModuleEvents();
}

function render() {
  const root = document.getElementById("app-root");
  if (!root) return;

  const moduleTabs = MODULES.map(
    (module) => `
      <button class="module-tab ${state.selectedModule === module.id ? "active" : ""}" data-module="${module.id}">
        ${module.label}
        <span class="muted">${module.shortcut}</span>
      </button>
    `,
  ).join("");

  root.innerHTML = `
    <div class="bg-mesh"></div>
    <div class="dashboard-shell">
      <aside class="glass-panel sidebar">
        <header>
          <h1>Agentix</h1>
          <p class="muted">Observability Dashboard</p>
        </header>
        <label class="sidebar-search">
          <input id="run-search" class="lucid-input" placeholder="Filter runs" value="${escapeHtml(state.runSearch)}" />
        </label>
        <div class="run-list">${renderSidebarRuns()}</div>
      </aside>

      <main class="main-pane">
        <header class="glass-panel topbar">
          <div>
            <h2>${escapeHtml(state.selectedRunId ?? "No active run")}</h2>
            <p class="muted">${escapeHtml(state.error ? `Error: ${state.error}` : state.runSummary?.run?.status ?? "Waiting for data")}</p>
          </div>
          <div class="topbar-status">
            <span id="live-status" class="status-chip ${state.sseConnected ? "status-pass" : "status-fail"}">${state.sseConnected ? "Live" : "Offline"}</span>
            <span id="live-heartbeat" class="muted">${state.lastHeartbeat ? `Heartbeat ${formatDate(state.lastHeartbeat)}` : "Heartbeat -"}</span>
            <button id="palette-toggle" class="lucid-button" aria-label="Open command palette">⌘K</button>
          </div>
        </header>

        <nav class="glass-panel module-nav">${moduleTabs}</nav>

        <section id="module-content" class="module-content ${state.loading ? "loading" : ""}">
          ${state.loading ? "<article class='glass-card'><p>Loading dashboard data…</p></article>" : renderModuleContent()}
        </section>

        ${state.warnings.length ? `<footer class="glass-panel warning-bar">${escapeHtml(state.warnings.slice(0, 6).join(" • "))}</footer>` : ""}
      </main>
    </div>
    ${renderPalette()}
  `;

  bindGlobalEvents();
  bindModuleEvents();
}

function closePalette() {
  if (!state.paletteOpen) return;
  state.paletteOpen = false;
  render();
}

function bindGlobalEvents() {
  document.querySelectorAll<HTMLButtonElement>("[data-run-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const runId = button.dataset.runId;
      if (!runId || runId === state.selectedRunId) return;
      state.selectedRunId = runId;
      state.selectedUnitId = null;
      setAttemptFocus(null, null);
      state.loading = true;
      render();
      refreshRunScopedData(runId)
        .then(() => {
          state.loading = false;
          connectLiveStream();
          render();
        })
        .catch((error) => {
          state.loading = false;
          state.error = error instanceof Error ? error.message : String(error);
          render();
        });
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-module]").forEach((button) => {
    button.addEventListener("click", () => {
      const moduleId = button.dataset.module as ModuleId;
      state.selectedModule = moduleId;
      render();
    });
  });

  const runSearch = document.getElementById("run-search") as HTMLInputElement | null;
  if (runSearch) {
    runSearch.addEventListener("input", () => {
      state.runSearch = runSearch.value;
      render();
    });
  }

  const paletteToggle = document.getElementById("palette-toggle");
  paletteToggle?.addEventListener("click", () => {
    state.paletteOpen = !state.paletteOpen;
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-palette-module]").forEach((button) => {
    button.addEventListener("click", () => {
      const moduleId = button.dataset.paletteModule as ModuleId;
      state.selectedModule = moduleId;
      closePalette();
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-palette-run]").forEach((button) => {
    button.addEventListener("click", () => {
      const runId = button.dataset.paletteRun;
      if (!runId) return;
      closePalette();
      if (runId !== state.selectedRunId) {
        state.selectedRunId = runId;
        setAttemptFocus(null, null);
        state.loading = true;
        render();
        refreshRunScopedData(runId)
          .then(() => {
            state.loading = false;
            connectLiveStream();
            render();
          })
          .catch((error) => {
            state.loading = false;
            state.error = error instanceof Error ? error.message : String(error);
            render();
          });
      }
    });
  });

  const paletteBackdrop = document.getElementById("palette-backdrop");
  if (paletteBackdrop) {
    paletteBackdrop.addEventListener("click", (event) => {
      if (event.target === paletteBackdrop) {
        closePalette();
      }
    });
  }
}

function bindModuleEvents() {
  document.querySelectorAll<HTMLButtonElement>("[data-gate-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.gateAction;
      if (!action) return;
      if (
        action === "cockpit" ||
        action === "dag" ||
        action === "attempts" ||
        action === "readiness" ||
        action === "analytics" ||
        action === "telemetry"
      ) {
        state.selectedModule = action;
        render();
      }
    });
  });

  const streamSelect = document.getElementById("log-stream-filter") as HTMLSelectElement | null;
  if (streamSelect) {
    streamSelect.addEventListener("change", () => {
      state.logStreamFilter = streamSelect.value as "all" | "stdout" | "stderr";
      state.logScrollTopPx = 0;
      renderModuleOnly();
    });
  }

  const logSearch = document.getElementById("log-search") as HTMLInputElement | null;
  if (logSearch) {
    logSearch.addEventListener("input", () => {
      state.logSearch = logSearch.value;
      state.logScrollTopPx = 0;
      renderModuleOnly();
    });
  }

  const attemptFocusReset = document.getElementById("attempt-focus-reset");
  attemptFocusReset?.addEventListener("click", () => {
    setAttemptFocus(null, null);
    renderModuleOnly();
  });

  const logViewport = document.getElementById("log-viewport");
  if (logViewport) {
    state.logViewportHeightPx = Math.max(120, Math.floor(logViewport.clientHeight || 420));
    if (state.logScrollTopPx > 0) {
      logViewport.scrollTop = state.logScrollTopPx;
    }
    logViewport.addEventListener("scroll", () => {
      state.logScrollTopPx = Math.max(0, Math.floor(logViewport.scrollTop));
      if (logViewportRaf != null) return;
      logViewportRaf = window.requestAnimationFrame(() => {
        logViewportRaf = null;
        renderModuleOnly();
      });
    });
  }

  document.querySelectorAll<HTMLElement>(".timeline-row[data-attempt-node]").forEach((row) => {
    row.addEventListener("click", () => {
      const nodeId = row.dataset.attemptNode ?? null;
      const rawAttempt = row.dataset.attemptId ?? "";
      const attempt = rawAttempt.trim() && Number.isFinite(Number(rawAttempt))
        ? Number(rawAttempt)
        : null;
      setAttemptFocus(nodeId, attempt);
      renderModuleOnly();
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".event-row[data-event-node]").forEach((button) => {
    button.addEventListener("click", () => {
      const nodeId = button.dataset.eventNode ?? "";
      const rawAttempt = button.dataset.eventAttempt ?? "";
      const attempt = rawAttempt.trim() && Number.isFinite(Number(rawAttempt))
        ? Number(rawAttempt)
        : null;
      const focus = deriveAttemptFocusFromEvent({
        type: "NodeOutput",
        payload: {
          nodeId,
          attempt,
        },
      });
      if (!focus) return;
      setAttemptFocus(focus.nodeId, focus.attempt);
      renderModuleOnly();
    });
  });

  const tier = document.getElementById("dag-filter-tier") as HTMLSelectElement | null;
  if (tier) {
    tier.addEventListener("change", () => {
      state.dagFilters.tier = tier.value;
      renderModuleOnly();
    });
  }

  const priority = document.getElementById("dag-filter-priority") as HTMLSelectElement | null;
  if (priority) {
    priority.addEventListener("change", () => {
      state.dagFilters.priority = priority.value;
      renderModuleOnly();
    });
  }

  const failedOnly = document.getElementById("dag-filter-failed") as HTMLInputElement | null;
  if (failedOnly) {
    failedOnly.addEventListener("change", () => {
      state.dagFilters.failedOnly = failedOnly.checked;
      renderModuleOnly();
    });
  }

  const evictedOnly = document.getElementById("dag-filter-evicted") as HTMLInputElement | null;
  if (evictedOnly) {
    evictedOnly.addEventListener("change", () => {
      state.dagFilters.evictedOnly = evictedOnly.checked;
      renderModuleOnly();
    });
  }

  document.querySelectorAll<HTMLElement>(".dag-card[data-unit-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const unitId = card.dataset.unitId;
      if (!unitId) return;
      state.selectedUnitId = unitId;
      state.selectedModule = "cockpit";
      render();
    });
  });
}

function registerKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    const inEditable =
      target?.tagName === "INPUT" ||
      target?.tagName === "TEXTAREA" ||
      target?.tagName === "SELECT" ||
      target?.isContentEditable === true;

    const withCommand = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
    if (withCommand) {
      event.preventDefault();
      state.paletteOpen = !state.paletteOpen;
      render();
      return;
    }

    if (event.key === "Escape") {
      closePalette();
      return;
    }

    if (inEditable) return;

    const module = MODULES.find((entry) => entry.shortcut === event.key);
    if (module && !event.metaKey && !event.ctrlKey && !event.altKey) {
      state.selectedModule = module.id;
      render();
    }
  });
}

async function boot() {
  try {
    state.loading = true;
    render();

    const [health, runs, traces, analytics, commands, workPlan] = await Promise.all([
      dashboardApi.health(),
      dashboardApi.listRuns(),
      dashboardApi.traces(),
      dashboardApi.analytics(),
      dashboardApi.commands(),
      dashboardApi.workPlan(),
    ]);

    state.runs = runs.items ?? [];
    state.traces = traces.items ?? [];
    state.analyticsSnapshots = analytics.items ?? [];
    state.commands = commands.items ?? [];
    state.workPlan = workPlan.workPlan;
    state.warnings = collectWarnings(runs, traces, analytics, commands, workPlan);

    state.selectedRunId = state.runs[0]?.runId ?? null;

    if (state.selectedRunId) {
      await refreshRunScopedData(state.selectedRunId);
      connectLiveStream();
    }

    state.loading = false;
    state.error = null;

    render();
    registerKeyboardShortcuts();

    if (health.status !== "ok") {
      state.error = `API health status: ${health.status}`;
      render();
    }
  } catch (error) {
    state.loading = false;
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

if (typeof document !== "undefined") {
  boot();
}
