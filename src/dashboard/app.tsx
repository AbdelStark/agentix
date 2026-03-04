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
import { renderTelemetryCockpit } from "./modules/telemetry/render.ts";
import {
  deriveLatestNavigationTargets,
  deriveRunPulseSummary,
  deriveStepBoardRows,
  deriveTimelineRows,
  type StepBoardFilter,
  type StepBoardSort,
  type TimelineFilterState,
} from "./modules/telemetry/selectors.ts";
import { deriveDashboardLayoutState } from "./modules/layout/shell-state.ts";

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

type LogStreamFilter = "all" | "stdout" | "stderr";

export type DashboardUrlState = {
  selectedModule: ModuleId | null;
  selectedRunId: string | null;
  runSearch: string;
  selectedUnitId: string | null;
  attemptsNodeFilter: string | null;
  attemptsAttemptFilter: number | null;
  logStreamFilter: LogStreamFilter;
  logSearch: string;
  stepBoardFilter: StepBoardFilter;
  stepBoardSort: StepBoardSort;
  stepBoardQuery: string;
  timelineCriticalOnly: boolean;
  timelineFailuresOnly: boolean;
  timelineSystemEvents: boolean;
  timelineToolEvents: boolean;
  timelineResourceAnomalies: boolean;
  timelineQuery: string;
  timelineFocusEventKey: string | null;
};

function isModuleId(value: string): value is ModuleId {
  return MODULES.some((module) => module.id === value);
}

function isSyntheticDashboardRunId(runId: unknown): boolean {
  return String(runId ?? "").trim().toLowerCase() === "sw-dashboard-demo";
}

function normalizeQueryValue(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseAttemptNumber(value: string | null): number | null {
  const normalized = normalizeQueryValue(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
}

function parseLogStreamFilter(value: string | null): LogStreamFilter {
  if (value === "stdout" || value === "stderr") return value;
  return "all";
}

function parseStepBoardFilter(value: string | null): StepBoardFilter {
  if (
    value === "all" ||
    value === "in-progress" ||
    value === "pending" ||
    value === "failed" ||
    value === "blocked" ||
    value === "completed"
  ) {
    return value;
  }
  return "all";
}

function parseStepBoardSort(value: string | null): StepBoardSort {
  if (
    value === "newest" ||
    value === "failing-first" ||
    value === "pending-first" ||
    value === "longest-running"
  ) {
    return value;
  }
  return "newest";
}

function parseBooleanQuery(value: string | null, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return fallback;
}

function defaultTimelineFilters(): TimelineFilterState {
  return {
    criticalOnly: false,
    failuresOnly: false,
    systemEvents: true,
    toolEvents: true,
    resourceAnomalies: false,
    query: "",
  };
}

export function readDashboardUrlState(search: string): DashboardUrlState {
  const params = new URLSearchParams(search);
  const selectedModuleRaw = normalizeQueryValue(params.get("module"));
  const selectedModule = selectedModuleRaw && isModuleId(selectedModuleRaw)
    ? selectedModuleRaw
    : null;

  return {
    selectedModule,
    selectedRunId: normalizeQueryValue(params.get("run")),
    runSearch: params.get("q") ?? "",
    selectedUnitId: normalizeQueryValue(params.get("unit")),
    attemptsNodeFilter: normalizeQueryValue(params.get("node")),
    attemptsAttemptFilter: parseAttemptNumber(params.get("attempt")),
    logStreamFilter: parseLogStreamFilter(params.get("stream")),
    logSearch: params.get("logs") ?? "",
    stepBoardFilter: parseStepBoardFilter(params.get("sfilter")),
    stepBoardSort: parseStepBoardSort(params.get("ssort")),
    stepBoardQuery: params.get("squery") ?? "",
    timelineCriticalOnly: parseBooleanQuery(params.get("tlc"), false),
    timelineFailuresOnly: parseBooleanQuery(params.get("tlf"), false),
    timelineSystemEvents: parseBooleanQuery(params.get("tls"), true),
    timelineToolEvents: parseBooleanQuery(params.get("tlt"), true),
    timelineResourceAnomalies: parseBooleanQuery(params.get("tlr"), false),
    timelineQuery: params.get("tlq") ?? "",
    timelineFocusEventKey: normalizeQueryValue(params.get("tle")),
  };
}

export function buildDashboardSearch(
  urlState: DashboardUrlState,
  existingSearch = "",
): string {
  const params = new URLSearchParams(existingSearch);

  for (const key of [
    "module",
    "run",
    "q",
    "unit",
    "node",
    "attempt",
    "stream",
    "logs",
    "sfilter",
    "ssort",
    "squery",
    "tlc",
    "tlf",
    "tls",
    "tlt",
    "tlr",
    "tlq",
    "tle",
  ]) {
    params.delete(key);
  }

  if (urlState.selectedModule && urlState.selectedModule !== "cockpit") {
    params.set("module", urlState.selectedModule);
  }
  if (urlState.selectedRunId) {
    params.set("run", urlState.selectedRunId);
  }
  if (urlState.runSearch.trim()) {
    params.set("q", urlState.runSearch.trim());
  }
  if (urlState.selectedUnitId) {
    params.set("unit", urlState.selectedUnitId);
  }
  if (urlState.attemptsNodeFilter) {
    params.set("node", urlState.attemptsNodeFilter);
  }
  if (urlState.attemptsAttemptFilter != null) {
    params.set("attempt", String(urlState.attemptsAttemptFilter));
  }
  if (urlState.logStreamFilter !== "all") {
    params.set("stream", urlState.logStreamFilter);
  }
  if (urlState.logSearch.trim()) {
    params.set("logs", urlState.logSearch.trim());
  }
  if (urlState.stepBoardFilter !== "all") {
    params.set("sfilter", urlState.stepBoardFilter);
  }
  if (urlState.stepBoardSort !== "newest") {
    params.set("ssort", urlState.stepBoardSort);
  }
  if (urlState.stepBoardQuery.trim()) {
    params.set("squery", urlState.stepBoardQuery.trim());
  }
  if (urlState.timelineCriticalOnly) {
    params.set("tlc", "1");
  }
  if (urlState.timelineFailuresOnly) {
    params.set("tlf", "1");
  }
  if (!urlState.timelineSystemEvents) {
    params.set("tls", "0");
  }
  if (!urlState.timelineToolEvents) {
    params.set("tlt", "0");
  }
  if (urlState.timelineResourceAnomalies) {
    params.set("tlr", "1");
  }
  if (urlState.timelineQuery.trim()) {
    params.set("tlq", urlState.timelineQuery.trim());
  }
  if (urlState.timelineFocusEventKey) {
    params.set("tle", urlState.timelineFocusEventKey);
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
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
  logStreamFilter: LogStreamFilter;
  logSearch: string;
  attemptsNodeFilter: string | null;
  attemptsAttemptFilter: number | null;
  stepBoardFilter: StepBoardFilter;
  stepBoardSort: StepBoardSort;
  stepBoardQuery: string;
  timelineFilters: TimelineFilterState;
  timelineFocusEventKey: string | null;
  logViewportHeightPx: number;
  logScrollTopPx: number;
  toolEvents: any[];
  resources: any[];
  prompts: any[];
  executionSteps: any[];
  timeline: any[];
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
  stepBoardFilter: "all",
  stepBoardSort: "newest",
  stepBoardQuery: "",
  timelineFilters: defaultTimelineFilters(),
  timelineFocusEventKey: null,
  logViewportHeightPx: 420,
  logScrollTopPx: 0,
  toolEvents: [],
  resources: [],
  prompts: [],
  executionSteps: [],
  timeline: [],
};

let eventSource: EventSource | null = null;
let refreshDebounceTimer: Timer | null = null;
let logViewportRaf: number | null = null;
let lastFocusedBeforePalette: HTMLElement | null = null;
let announcedLiveState: boolean | null = null;

function getCurrentUrlState(): DashboardUrlState {
  return {
    selectedModule: state.selectedModule,
    selectedRunId: state.selectedRunId,
    runSearch: state.runSearch,
    selectedUnitId: state.selectedUnitId,
    attemptsNodeFilter: state.attemptsNodeFilter,
    attemptsAttemptFilter: state.attemptsAttemptFilter,
    logStreamFilter: state.logStreamFilter,
    logSearch: state.logSearch,
    stepBoardFilter: state.stepBoardFilter,
    stepBoardSort: state.stepBoardSort,
    stepBoardQuery: state.stepBoardQuery,
    timelineCriticalOnly: state.timelineFilters.criticalOnly,
    timelineFailuresOnly: state.timelineFilters.failuresOnly,
    timelineSystemEvents: state.timelineFilters.systemEvents,
    timelineToolEvents: state.timelineFilters.toolEvents,
    timelineResourceAnomalies: state.timelineFilters.resourceAnomalies,
    timelineQuery: state.timelineFilters.query,
    timelineFocusEventKey: state.timelineFocusEventKey,
  };
}

function syncUrlState(mode: "push" | "replace" = "replace") {
  if (typeof window === "undefined") return;
  const search = buildDashboardSearch(getCurrentUrlState(), window.location.search);
  const nextUrl = `${window.location.pathname}${search}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;
  if (mode === "push") {
    window.history.pushState(null, "", nextUrl);
    return;
  }
  window.history.replaceState(null, "", nextUrl);
}

function applyUrlState(urlState: DashboardUrlState) {
  if (urlState.selectedModule) {
    state.selectedModule = urlState.selectedModule;
  }
  state.runSearch = urlState.runSearch;
  state.selectedUnitId = urlState.selectedUnitId;
  state.logStreamFilter = urlState.logStreamFilter;
  state.logSearch = urlState.logSearch;
  state.stepBoardFilter = urlState.stepBoardFilter;
  state.stepBoardSort = urlState.stepBoardSort;
  state.stepBoardQuery = urlState.stepBoardQuery;
  state.timelineFilters = {
    criticalOnly: urlState.timelineCriticalOnly,
    failuresOnly: urlState.timelineFailuresOnly,
    systemEvents: urlState.timelineSystemEvents,
    toolEvents: urlState.timelineToolEvents,
    resourceAnomalies: urlState.timelineResourceAnomalies,
    query: urlState.timelineQuery,
  };
  state.timelineFocusEventKey = urlState.timelineFocusEventKey;
  setAttemptFocus(urlState.attemptsNodeFilter, urlState.attemptsAttemptFilter);
}

function focusPaletteFirstAction() {
  if (!state.paletteOpen) return;
  const target = document.querySelector<HTMLElement>(
    "[data-palette-module], [data-palette-run], #palette-close",
  );
  target?.focus();
}

function handlePaletteFocusTrap(event: KeyboardEvent): boolean {
  if (!state.paletteOpen || event.key !== "Tab") return false;
  const focusable = Array.from(
    document.querySelectorAll<HTMLElement>(
      "#command-palette button, #command-palette [href], #command-palette input, #command-palette select, #command-palette textarea, #command-palette [tabindex]:not([tabindex='-1'])",
    ),
  ).filter((element) => !element.hasAttribute("disabled"));
  if (focusable.length === 0) return false;

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement as HTMLElement | null;
  if (!active || !focusable.includes(active)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

function openPalette() {
  if (state.paletteOpen) return;
  lastFocusedBeforePalette =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  state.paletteOpen = true;
  render();
}

function closePalette(opts: { restoreFocus?: boolean } = {}) {
  if (!state.paletteOpen) return;
  const restoreFocus = opts.restoreFocus ?? true;
  state.paletteOpen = false;
  render();
  if (!restoreFocus) return;
  window.requestAnimationFrame(() => {
    lastFocusedBeforePalette?.focus();
  });
}

function selectRun(
  runId: string,
  opts: { historyMode?: "push" | "replace" | "none"; resetFocus?: boolean } = {},
) {
  if (!runId) return;
  const historyMode = opts.historyMode ?? "push";
  const resetFocus = opts.resetFocus ?? true;

  if (runId === state.selectedRunId && !state.loading) {
    if (historyMode !== "none") {
      syncUrlState(historyMode);
    }
    render();
    return;
  }

  state.selectedRunId = runId;
  if (resetFocus) {
    state.selectedUnitId = null;
    setAttemptFocus(null, null);
  }
  state.loading = true;
  if (historyMode !== "none") {
    syncUrlState(historyMode);
  }
  render();

  refreshRunScopedData(runId)
    .then(() => {
      state.loading = false;
      state.error = null;
      connectLiveStream();
      render();
    })
    .catch((error) => {
      state.loading = false;
      state.error = error instanceof Error ? error.message : String(error);
      render();
    });
}

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

function parseDatasetAttempt(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
}

function buildStepRowsForOperations() {
  return deriveStepBoardRows({
    nodes: state.nodes,
    executionSteps: state.executionSteps,
    liveEvents: state.liveEvents,
  });
}

function buildTimelineRowsForOperations(
  overrides: Partial<TimelineFilterState> = {},
) {
  const timelineWindow = [
    ...(state.liveEvents ?? []).slice(0, 240),
    ...(state.timeline ?? []).slice(0, 1200),
  ];
  return deriveTimelineRows(
    timelineWindow,
    {
      criticalOnly: false,
      failuresOnly: false,
      systemEvents: true,
      toolEvents: true,
      resourceAnomalies: false,
      query: "",
      ...overrides,
    },
  );
}

function jumpToAttemptsContext(
  nodeId: string | null,
  attempt: number | null,
  mode: "push" | "replace" = "push",
) {
  if (!nodeId) return;
  setAttemptFocus(nodeId, attempt);
  state.selectedModule = "attempts";
  syncUrlState(mode);
  render();
}

function jumpToCriticalTimeline(mode: "push" | "replace" = "push") {
  const timelineRows = buildTimelineRowsForOperations();
  const critical = timelineRows.find((entry) => entry.critical) ?? null;
  if (!critical) return;
  state.selectedModule = "telemetry";
  state.timelineFilters.criticalOnly = true;
  state.timelineFilters.query = "";
  state.timelineFocusEventKey = critical.eventKey;
  syncUrlState(mode);
  render();
}

function renderRunPulseStrip(): string {
  const stepRows = buildStepRowsForOperations();
  const timelineRows = buildTimelineRowsForOperations();
  const pulse = deriveRunPulseSummary({
    runStatus: state.runSummary?.run?.status ?? null,
    stepRows,
    timelineRows,
  });
  const latest = deriveLatestNavigationTargets(stepRows);
  const latestStep = pulse.latestStep;
  const latestStepLabel = latestStep
    ? `${latestStep.unitId}/${latestStep.stage} #${latestStep.attempt}`
    : "No step yet";
  const lastCriticalLabel = pulse.lastCriticalEvent
    ? `${pulse.lastCriticalEvent.eventType} • ${pulse.lastCriticalEvent.relativeTime}`
    : "No critical event";

  return `
    <section class="glass-panel run-pulse-strip" aria-label="Run pulse summary">
      <article class="pulse-card">
        <p class="pulse-label">Run Status</p>
        <p class="pulse-value">${escapeHtml(pulse.runStatus)}</p>
        <p class="pulse-sub">${escapeHtml(latestStepLabel)}</p>
      </article>
      <article class="pulse-card">
        <p class="pulse-label">Workload</p>
        <p class="pulse-value">${pulse.inProgressCount} in-progress</p>
        <p class="pulse-sub">${pulse.pendingCount} pending • ${pulse.completedCount} completed</p>
      </article>
      <article class="pulse-card">
        <p class="pulse-label">Risks</p>
        <p class="pulse-value">${pulse.failedCount} failed</p>
        <p class="pulse-sub">${pulse.blockedCount} blocked</p>
      </article>
      <article class="pulse-card pulse-card-wide">
        <p class="pulse-label">Last Critical Event</p>
        <p class="pulse-value">${escapeHtml(lastCriticalLabel)}</p>
        <div class="pulse-actions">
          <button type="button" class="lucid-button lucid-button-xs" data-pulse-jump="failed" ${latest.latestFailed ? "" : "disabled"}>Latest Failed Step</button>
          <button type="button" class="lucid-button lucid-button-xs" data-pulse-jump="pending" ${latest.latestPending ? "" : "disabled"}>Latest Pending Step</button>
          <button type="button" class="lucid-button lucid-button-xs" data-pulse-jump="in-progress" ${latest.latestInProgress ? "" : "disabled"}>Latest In-Progress Step</button>
          <button type="button" class="lucid-button lucid-button-xs" data-pulse-jump="critical" ${pulse.lastCriticalEvent ? "" : "disabled"}>Latest Critical Event</button>
        </div>
      </article>
    </section>
  `;
}

async function refreshRunScopedData(runId: string) {
  const [runSummary, nodes, attempts, prompts, executionSteps, timeline, events, logs, stageOutputs, mergeRisk, toolEvents, resources] =
    await Promise.all([
      dashboardApi.getRun(runId),
      dashboardApi.listNodes(runId),
      dashboardApi.listAttempts(runId),
      dashboardApi.listPrompts(runId),
      dashboardApi.listExecutionSteps(runId),
      dashboardApi.listTimeline(runId),
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
  state.prompts = prompts.items ?? [];
  state.executionSteps = executionSteps.items ?? [];
  state.timeline = timeline.items ?? [];
  state.events = events.items ?? [];
  state.logs = logs.items ?? [];
  state.stageOutputs = stageOutputs.items ?? [];
  state.mergeRisk = mergeRisk.items ?? [];
  state.toolEvents = toolEvents.items ?? [];
  state.resources = resources.items ?? [];
  state.warnings = collectWarnings(
    nodes,
    attempts,
    prompts,
    executionSteps,
    timeline,
    events,
    logs,
    stageOutputs,
    mergeRisk,
    toolEvents,
    resources,
  );
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

      if (
        state.selectedModule === "attempts" ||
        state.selectedModule === "cockpit" ||
        state.selectedModule === "telemetry"
      ) {
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
    if (isSyntheticDashboardRunId(run.runId)) return false;
    if (!query) return true;
    return (
      String(run.runId ?? "").toLowerCase().includes(query) ||
      String(run.status ?? "").toLowerCase().includes(query)
    );
  });

  if (runs.length === 0) {
    return "<p class='muted run-list-empty'>No runs match your filter.</p>";
  }

  return runs
    .map((run) => {
      const selected = run.runId === state.selectedRunId;
      return `
        <button
          type="button"
          class="run-item ${selected ? "selected" : ""}"
          data-run-id="${escapeHtml(String(run.runId ?? ""))}"
          aria-pressed="${selected ? "true" : "false"}"
        >
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
  return renderTelemetryCockpit({
    runStatus: state.runSummary?.run?.status ?? null,
    nodes: state.nodes,
    toolEvents: state.toolEvents,
    resources: state.resources,
    prompts: state.prompts,
    executionSteps: state.executionSteps,
    timeline: state.timeline,
    liveEvents: state.liveEvents,
    stepBoardFilter: {
      state: state.stepBoardFilter,
      query: state.stepBoardQuery,
    },
    stepBoardSort: state.stepBoardSort,
    timelineFilters: state.timelineFilters,
    timelineFocusEventKey: state.timelineFocusEventKey,
  });
}

function renderPalette(): string {
  if (!state.paletteOpen) return "";

  const moduleRows = MODULES.map(
    (module) => `
      <button type="button" class="palette-item" data-palette-module="${module.id}">
        <span>${escapeHtml(module.label)}</span>
        <span class="muted">${module.shortcut}</span>
      </button>
    `,
  ).join("");

  const runRows = state.runs
    .slice(0, 8)
    .map(
      (run) => `
        <button type="button" class="palette-item" data-palette-run="${escapeHtml(String(run.runId ?? ""))}">
          <span>${escapeHtml(String(run.runId ?? ""))}</span>
          <span class="muted">${escapeHtml(String(run.status ?? "unknown"))}</span>
        </button>
      `,
    )
    .join("");

  return `
    <div class="palette-backdrop" id="palette-backdrop">
      <div class="glass-card palette-panel" id="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title">
        <header class="palette-header">
          <h3 id="command-palette-title">Command Palette</h3>
          <button type="button" id="palette-close" class="lucid-button" aria-label="Close command palette">Esc</button>
        </header>
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
  const announcerEl = document.getElementById("live-announcer");
  if (statusEl) {
    statusEl.textContent = state.sseConnected ? "Live" : "Offline";
    statusEl.className = `status-chip ${state.sseConnected ? "status-pass" : "status-fail"}`;
  }
  if (hbEl) {
    hbEl.textContent = state.lastHeartbeat
      ? `Heartbeat ${formatDate(state.lastHeartbeat)}`
      : "Heartbeat -";
  }
  if (announcerEl && announcedLiveState !== state.sseConnected) {
    announcerEl.textContent = state.sseConnected
      ? "Live stream connected."
      : "Live stream disconnected.";
    announcedLiveState = state.sseConnected;
  }
  renderPulseOnly();
}

function renderPulseOnly() {
  const pulseRoot = document.getElementById("run-pulse-root");
  if (!pulseRoot) return;
  pulseRoot.innerHTML = renderRunPulseStrip();
  bindPulseEvents();
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
  const layoutState = deriveDashboardLayoutState(
    typeof window !== "undefined" ? window.innerWidth : 1280,
  );

  const moduleTabs = MODULES.map(
    (module) => `
      <button
        type="button"
        id="module-tab-${module.id}"
        role="tab"
        aria-selected="${state.selectedModule === module.id ? "true" : "false"}"
        aria-controls="module-content"
        tabindex="${state.selectedModule === module.id ? "0" : "-1"}"
        class="module-tab ${state.selectedModule === module.id ? "active" : ""}"
        data-module="${module.id}"
      >
        ${module.label}
        <span class="muted">${module.shortcut}</span>
      </button>
    `,
  ).join("");

  root.innerHTML = `
    <div class="bg-mesh"></div>
    <div class="dashboard-shell" data-layout-mode="${layoutState.mode}" data-content-scroll="${layoutState.contentScrollMode}">
      <aside class="glass-panel sidebar" data-sidebar-mode="${layoutState.sidebarSticky ? "sticky" : "flow"}">
        <header>
          <h1>Agentix</h1>
          <p class="muted">Observability Dashboard</p>
        </header>
        <label class="sidebar-search">
          <span class="sr-only">Filter runs by run ID or status</span>
          <input
            id="run-search"
            class="lucid-input"
            placeholder="Filter runs"
            aria-label="Filter runs by run ID or status"
            value="${escapeHtml(state.runSearch)}"
          />
        </label>
        <div class="run-list">${renderSidebarRuns()}</div>
      </aside>

      <main class="main-pane">
        <header class="glass-panel topbar">
          <div>
            <h2>${escapeHtml(state.selectedRunId ?? "No active run")}</h2>
            <p class="muted ${state.error ? "danger" : ""}">${escapeHtml(state.error ? `Error: ${state.error}` : state.runSummary?.run?.status ?? "Waiting for data")}</p>
          </div>
          <div class="topbar-status">
            <span id="live-announcer" class="sr-only" aria-live="polite"></span>
            <span id="live-status" class="status-chip ${state.sseConnected ? "status-pass" : "status-fail"}">${state.sseConnected ? "Live" : "Offline"}</span>
            <span id="live-heartbeat" class="muted">${state.lastHeartbeat ? `Heartbeat ${formatDate(state.lastHeartbeat)}` : "Heartbeat -"}</span>
            <button
              type="button"
              id="palette-toggle"
              class="lucid-button"
              aria-haspopup="dialog"
              aria-expanded="${state.paletteOpen ? "true" : "false"}"
              aria-controls="command-palette"
              aria-label="Open command palette"
            >
              ⌘K
            </button>
          </div>
        </header>

        <section id="run-pulse-root">${renderRunPulseStrip()}</section>

        <nav class="glass-panel module-nav" role="tablist" aria-label="Dashboard modules">${moduleTabs}</nav>

        <section
          id="module-content"
          class="module-content ${state.loading ? "loading" : ""}"
          role="tabpanel"
          aria-labelledby="module-tab-${state.selectedModule}"
          tabindex="-1"
        >
          ${state.loading ? "<article class='glass-card'><p>Loading dashboard data…</p></article>" : renderModuleContent()}
        </section>

        ${state.warnings.length ? `<footer class="glass-panel warning-bar">${escapeHtml(state.warnings.slice(0, 6).join(" • "))}</footer>` : ""}
      </main>
    </div>
    ${renderPalette()}
  `;

  bindGlobalEvents();
  bindModuleEvents();
  bindPulseEvents();
  if (state.paletteOpen) {
    window.requestAnimationFrame(() => {
      focusPaletteFirstAction();
    });
  }
}

function bindPulseEvents() {
  document.querySelectorAll<HTMLButtonElement>("[data-pulse-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.pulseJump;
      if (!target) return;
      if (target === "critical") {
        jumpToCriticalTimeline("push");
        return;
      }
      const rows = buildStepRowsForOperations();
      const latest = deriveLatestNavigationTargets(rows);
      const step =
        target === "failed"
          ? latest.latestFailed
          : target === "pending"
            ? latest.latestPending
            : target === "in-progress"
              ? latest.latestInProgress
              : null;
      if (!step) return;
      jumpToAttemptsContext(step.nodeId, step.attempt > 0 ? step.attempt : null, "push");
    });
  });
}

function bindGlobalEvents() {
  document.querySelectorAll<HTMLButtonElement>("[data-run-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const runId = button.dataset.runId;
      if (!runId) return;
      selectRun(runId, { historyMode: "push", resetFocus: true });
    });
  });

  const moduleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-module]"));
  moduleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const moduleId = button.dataset.module as ModuleId;
      state.selectedModule = moduleId;
      syncUrlState("push");
      render();
    });

    button.addEventListener("keydown", (event) => {
      if (
        event.key !== "ArrowRight" &&
        event.key !== "ArrowLeft" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }

      event.preventDefault();
      if (moduleButtons.length === 0) return;

      const index = moduleButtons.indexOf(button);
      let nextIndex = index;
      if (event.key === "ArrowRight") {
        nextIndex = (index + 1) % moduleButtons.length;
      } else if (event.key === "ArrowLeft") {
        nextIndex = (index - 1 + moduleButtons.length) % moduleButtons.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = moduleButtons.length - 1;
      }

      const nextButton = moduleButtons[nextIndex];
      if (!nextButton) return;
      nextButton.focus();
      nextButton.click();
    });
  });

  const runSearch = document.getElementById("run-search") as HTMLInputElement | null;
  if (runSearch) {
    runSearch.addEventListener("input", () => {
      state.runSearch = runSearch.value;
      syncUrlState("replace");
      render();
    });
  }

  const paletteToggle = document.getElementById("palette-toggle");
  paletteToggle?.addEventListener("click", () => {
    if (state.paletteOpen) {
      closePalette();
      return;
    }
    openPalette();
  });

  const paletteClose = document.getElementById("palette-close");
  paletteClose?.addEventListener("click", () => {
    closePalette();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-palette-module]").forEach((button) => {
    button.addEventListener("click", () => {
      const moduleId = button.dataset.paletteModule as ModuleId;
      state.selectedModule = moduleId;
      syncUrlState("push");
      closePalette({ restoreFocus: false });
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-palette-run]").forEach((button) => {
    button.addEventListener("click", () => {
      const runId = button.dataset.paletteRun;
      if (!runId) return;
      closePalette({ restoreFocus: false });
      selectRun(runId, { historyMode: "push", resetFocus: true });
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
        syncUrlState("push");
        render();
      }
    });
  });

  const streamSelect = document.getElementById("log-stream-filter") as HTMLSelectElement | null;
  if (streamSelect) {
    streamSelect.addEventListener("change", () => {
      state.logStreamFilter = streamSelect.value as LogStreamFilter;
      state.logScrollTopPx = 0;
      syncUrlState("replace");
      renderModuleOnly();
    });
  }

  const logSearch = document.getElementById("log-search") as HTMLInputElement | null;
  if (logSearch) {
    logSearch.addEventListener("input", () => {
      state.logSearch = logSearch.value;
      state.logScrollTopPx = 0;
      syncUrlState("replace");
      renderModuleOnly();
    });
  }

  const attemptFocusReset = document.getElementById("attempt-focus-reset");
  attemptFocusReset?.addEventListener("click", () => {
    setAttemptFocus(null, null);
    syncUrlState("replace");
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

  document.querySelectorAll<HTMLButtonElement>(".timeline-row[data-attempt-node]").forEach((row) => {
    row.addEventListener("click", () => {
      const nodeId = row.dataset.attemptNode ?? null;
      const rawAttempt = row.dataset.attemptId ?? "";
      const attempt = rawAttempt.trim() && Number.isFinite(Number(rawAttempt))
        ? Number(rawAttempt)
        : null;
      setAttemptFocus(nodeId, attempt);
      syncUrlState("replace");
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
      syncUrlState("replace");
      renderModuleOnly();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-step-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.stepFilter;
      if (
        next !== "all" &&
        next !== "in-progress" &&
        next !== "pending" &&
        next !== "failed" &&
        next !== "blocked" &&
        next !== "completed"
      ) {
        return;
      }
      state.stepBoardFilter = next;
      syncUrlState("replace");
      renderModuleOnly();
    });
  });

  const stepBoardSearch = document.getElementById("step-board-search") as HTMLInputElement | null;
  if (stepBoardSearch) {
    stepBoardSearch.addEventListener("input", () => {
      state.stepBoardQuery = stepBoardSearch.value;
      syncUrlState("replace");
      renderModuleOnly();
    });
  }

  const stepBoardSort = document.getElementById("step-board-sort") as HTMLSelectElement | null;
  if (stepBoardSort) {
    stepBoardSort.addEventListener("change", () => {
      const value = stepBoardSort.value;
      if (
        value !== "newest" &&
        value !== "failing-first" &&
        value !== "pending-first" &&
        value !== "longest-running"
      ) {
        return;
      }
      state.stepBoardSort = value;
      syncUrlState("replace");
      renderModuleOnly();
    });
  }

  document.querySelectorAll<HTMLButtonElement>("[data-step-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.stepJump;
      const nodeId = button.dataset.jumpNode ?? null;
      const attempt = parseDatasetAttempt(button.dataset.jumpAttempt);
      if (!action || !nodeId) return;
      if (action === "timeline") {
        state.selectedModule = "telemetry";
        state.timelineFilters.query = nodeId;
        state.timelineFocusEventKey = null;
        syncUrlState("push");
        render();
        return;
      }
      jumpToAttemptsContext(nodeId, attempt, "push");
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-jump-latest]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.jumpLatest;
      if (!target) return;
      const rows = buildStepRowsForOperations();
      const latest = deriveLatestNavigationTargets(rows);
      const step =
        target === "failed"
          ? latest.latestFailed
          : target === "pending"
            ? latest.latestPending
            : target === "in-progress"
              ? latest.latestInProgress
              : null;
      if (!step) return;
      jumpToAttemptsContext(step.nodeId, step.attempt > 0 ? step.attempt : null, "push");
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-jump-critical]").forEach((button) => {
    button.addEventListener("click", () => {
      jumpToCriticalTimeline("push");
    });
  });

  const timelineCritical = document.getElementById("timeline-filter-critical") as HTMLInputElement | null;
  if (timelineCritical) {
    timelineCritical.addEventListener("change", () => {
      state.timelineFilters.criticalOnly = timelineCritical.checked;
      state.timelineFocusEventKey = null;
      syncUrlState("replace");
      renderModuleOnly();
    });
  }

  const timelineFailures = document.getElementById("timeline-filter-failures") as HTMLInputElement | null;
  if (timelineFailures) {
    timelineFailures.addEventListener("change", () => {
      state.timelineFilters.failuresOnly = timelineFailures.checked;
      state.timelineFocusEventKey = null;
      syncUrlState("replace");
      renderModuleOnly();
    });
  }

  const timelineSystem = document.getElementById("timeline-filter-system") as HTMLInputElement | null;
  if (timelineSystem) {
    timelineSystem.addEventListener("change", () => {
      state.timelineFilters.systemEvents = timelineSystem.checked;
      state.timelineFocusEventKey = null;
      syncUrlState("replace");
      renderModuleOnly();
    });
  }

  const timelineTool = document.getElementById("timeline-filter-tool") as HTMLInputElement | null;
  if (timelineTool) {
    timelineTool.addEventListener("change", () => {
      state.timelineFilters.toolEvents = timelineTool.checked;
      state.timelineFocusEventKey = null;
      syncUrlState("replace");
      renderModuleOnly();
    });
  }

  const timelineResourceAnomalies = document.getElementById("timeline-filter-resource-anomalies") as HTMLInputElement | null;
  if (timelineResourceAnomalies) {
    timelineResourceAnomalies.addEventListener("change", () => {
      state.timelineFilters.resourceAnomalies = timelineResourceAnomalies.checked;
      state.timelineFocusEventKey = null;
      syncUrlState("replace");
      renderModuleOnly();
    });
  }

  const timelineSearch = document.getElementById("timeline-search") as HTMLInputElement | null;
  if (timelineSearch) {
    timelineSearch.addEventListener("input", () => {
      state.timelineFilters.query = timelineSearch.value;
      state.timelineFocusEventKey = null;
      syncUrlState("replace");
      renderModuleOnly();
    });
  }

  const tier = document.getElementById("dag-filter-tier") as HTMLSelectElement | null;
  if (tier) {
    tier.addEventListener("change", () => {
      state.dagFilters.tier = tier.value;
      syncUrlState("replace");
      renderModuleOnly();
    });
  }

  const priority = document.getElementById("dag-filter-priority") as HTMLSelectElement | null;
  if (priority) {
    priority.addEventListener("change", () => {
      state.dagFilters.priority = priority.value;
      syncUrlState("replace");
      renderModuleOnly();
    });
  }

  const failedOnly = document.getElementById("dag-filter-failed") as HTMLInputElement | null;
  if (failedOnly) {
    failedOnly.addEventListener("change", () => {
      state.dagFilters.failedOnly = failedOnly.checked;
      syncUrlState("replace");
      renderModuleOnly();
    });
  }

  const evictedOnly = document.getElementById("dag-filter-evicted") as HTMLInputElement | null;
  if (evictedOnly) {
    evictedOnly.addEventListener("change", () => {
      state.dagFilters.evictedOnly = evictedOnly.checked;
      syncUrlState("replace");
      renderModuleOnly();
    });
  }

  document.querySelectorAll<HTMLButtonElement>(".dag-card[data-unit-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const unitId = card.dataset.unitId;
      if (!unitId) return;
      state.selectedUnitId = unitId;
      state.selectedModule = "cockpit";
      syncUrlState("push");
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

    if (handlePaletteFocusTrap(event)) {
      return;
    }

    const withCommand = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
    if (withCommand) {
      event.preventDefault();
      if (state.paletteOpen) {
        closePalette();
        return;
      }
      openPalette();
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
      syncUrlState("push");
      render();
    }
  });
}

function registerHistoryNavigation() {
  window.addEventListener("popstate", () => {
    const snapshot = readDashboardUrlState(window.location.search);
    applyUrlState(snapshot);
    const runId = snapshot.selectedRunId;
    const fallbackRunId = state.runs[0]?.runId ? String(state.runs[0].runId) : null;
    const nextRunId = runId ?? fallbackRunId;
    if (nextRunId && nextRunId !== state.selectedRunId) {
      const knownRunIds = new Set(state.runs.map((run) => String(run.runId ?? "")));
      if (knownRunIds.has(nextRunId)) {
        selectRun(nextRunId, { historyMode: "none", resetFocus: false });
        return;
      }
    }
    render();
  });
}

async function boot() {
  try {
    const initialUrlState = readDashboardUrlState(window.location.search);
    applyUrlState(initialUrlState);

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

    state.runs = (runs.items ?? []).filter((run) => !isSyntheticDashboardRunId(run.runId));
    state.traces = traces.items ?? [];
    state.analyticsSnapshots = analytics.items ?? [];
    state.commands = commands.items ?? [];
    state.workPlan = workPlan.workPlan;
    state.warnings = collectWarnings(runs, traces, analytics, commands, workPlan);

    const runIds = new Set(state.runs.map((run) => String(run.runId ?? "")));
    const runFromUrl = initialUrlState.selectedRunId;
    state.selectedRunId = runFromUrl && runIds.has(runFromUrl)
      ? runFromUrl
      : state.runs[0]?.runId ?? null;

    if (state.selectedRunId) {
      await refreshRunScopedData(state.selectedRunId);
      connectLiveStream();
    }

    state.loading = false;
    state.error = null;

    render();
    registerKeyboardShortcuts();
    registerHistoryNavigation();
    syncUrlState("replace");

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
