import { escapeHtml, formatDate, formatDuration } from "../../components/format.ts";
import {
  buildVirtualLogWindow,
  filterLogsByStream,
  groupAttemptsByNode,
  type AttemptTimelineEntry,
} from "./grouping.ts";

function extractAttemptPrompt(attempt: AttemptTimelineEntry | null): string {
  if (!attempt?.meta || typeof attempt.meta !== "object") return "";
  const meta = attempt.meta as Record<string, unknown>;

  const directPrompt = meta.prompt;
  if (typeof directPrompt === "string" && directPrompt.trim()) return directPrompt.trim();

  const input = meta.input;
  if (input && typeof input === "object") {
    const inputPrompt = (input as Record<string, unknown>).prompt;
    if (typeof inputPrompt === "string" && inputPrompt.trim()) return inputPrompt.trim();
  }

  const messages = meta.messages;
  if (Array.isArray(messages)) {
    const latestUser = [...messages]
      .reverse()
      .find(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          ((entry as Record<string, unknown>).role === "user" ||
            (entry as Record<string, unknown>).type === "user"),
      ) as Record<string, unknown> | undefined;
    const content = latestUser?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
  }

  return "";
}

function getFocusedAttempt(opts: {
  attempts: AttemptTimelineEntry[];
  selectedNodeId: string | null;
  selectedAttempt: number | null;
}): AttemptTimelineEntry | null {
  if (!opts.attempts.length) return null;

  if (opts.selectedNodeId) {
    const exact = opts.attempts.find((attempt) => {
      if (attempt.nodeId !== opts.selectedNodeId) return false;
      if (opts.selectedAttempt == null) return true;
      return attempt.attempt === opts.selectedAttempt;
    });
    if (exact) return exact;
  }

  const sorted = [...opts.attempts].sort((a, b) => {
    const aTs = a.startedAt ? Date.parse(a.startedAt) : 0;
    const bTs = b.startedAt ? Date.parse(b.startedAt) : 0;
    if (aTs !== bTs) return bTs - aTs;
    return b.attempt - a.attempt;
  });
  return sorted[0] ?? null;
}

export function renderAttemptExplorer(opts: {
  attempts: AttemptTimelineEntry[];
  events: Array<{
    type: string;
    timestamp: string;
    payload?: Record<string, unknown>;
  }>;
  logs: Array<{
    nodeId: string;
    attempt?: number | null;
    stream: "stdout" | "stderr";
    text: string;
    timestamp: string;
  }>;
  streamFilter: "all" | "stdout" | "stderr";
  search: string;
  selectedNodeId: string | null;
  selectedAttempt: number | null;
  viewport: {
    rowHeightPx: number;
    viewportHeightPx: number;
    scrollTopPx: number;
    overscanRows: number;
  };
}): string {
  const filteredAttempts = (opts.attempts ?? []).filter((attempt) => {
    if (!opts.selectedNodeId) return true;
    if (attempt.nodeId !== opts.selectedNodeId) return false;
    if (opts.selectedAttempt == null) return true;
    return attempt.attempt === opts.selectedAttempt;
  });
  const groups = groupAttemptsByNode(filteredAttempts);
  const lowerSearch = opts.search.trim().toLowerCase();

  const filteredLogs = filterLogsByStream(opts.logs, opts.streamFilter).filter((log) => {
    if (opts.selectedNodeId && log.nodeId !== opts.selectedNodeId) return false;
    if (opts.selectedAttempt != null && Number(log.attempt ?? -1) !== opts.selectedAttempt) {
      return false;
    }
    if (!lowerSearch) return true;
    return (
      log.nodeId.toLowerCase().includes(lowerSearch) ||
      log.text.toLowerCase().includes(lowerSearch)
    );
  });

  const virtualWindow = buildVirtualLogWindow({
    logs: filteredLogs,
    rowHeightPx: opts.viewport.rowHeightPx,
    viewportHeightPx: opts.viewport.viewportHeightPx,
    scrollTopPx: opts.viewport.scrollTopPx,
    overscanRows: opts.viewport.overscanRows,
  });

  const attemptMarkup = groups
    .map((group) => {
      const attemptsMarkup = group.attempts
        .map(
          (attempt) => `
            <button
              type="button"
              class="timeline-row"
              data-attempt-node="${escapeHtml(group.nodeId)}"
              data-attempt-id="${attempt.attempt}"
              aria-label="Focus ${escapeHtml(group.nodeId)} attempt ${attempt.attempt}"
            >
              <span class="timeline-pill">#${attempt.attempt}</span>
              <span class="timeline-state">${attempt.state}</span>
              <span>${formatDuration(attempt.durationMs)}</span>
              <span class="timeline-sub">${formatDate(attempt.startedAt)}</span>
            </button>
          `,
        )
        .join("");

      return `
        <article class="glass-card attempt-group">
          <header>
            <h4>${group.nodeId}</h4>
            <span class="status-chip ${group.latestState === "failed" ? "status-fail" : "status-pass"}">${group.latestState}</span>
          </header>
          <p class="timeline-sub">${group.retries} retries • total ${formatDuration(group.totalDurationMs)}</p>
          <div class="timeline-stack">${attemptsMarkup}</div>
        </article>
      `;
    })
    .join("");

  const logRows = virtualWindow.items
    .map(
      (log) => `
        <div class="log-row" data-stream="${log.stream}">
          <span class="log-stamp">${escapeHtml(log.timestamp)}</span>
          <span class="log-stream">${log.stream}</span>
          <span class="log-node">${escapeHtml(log.nodeId)}</span>
          <span class="log-text">${escapeHtml(log.text)}</span>
        </div>
      `,
    )
    .join("");

  const eventRows = (opts.events ?? [])
    .filter((event) => event.type === "NodeOutput")
    .slice(0, 60)
    .map((event) => {
      const nodeId = typeof event.payload?.nodeId === "string" ? event.payload.nodeId : "";
      const attempt = Number.isFinite(Number(event.payload?.attempt))
        ? Number(event.payload?.attempt)
        : null;
      const text = typeof event.payload?.text === "string"
        ? event.payload.text
        : event.type;
      return `
        <button type="button" class="event-row" data-event-node="${escapeHtml(nodeId)}" data-event-attempt="${attempt ?? ""}">
          <span class="log-stamp">${escapeHtml(event.timestamp)}</span>
          <span class="log-node">${escapeHtml(nodeId)}</span>
          <span class="log-text">${escapeHtml(text.slice(0, 180))}</span>
        </button>
      `;
    })
    .join("");

  const selectedFocus = opts.selectedNodeId
    ? `${opts.selectedNodeId}${opts.selectedAttempt != null ? ` #${opts.selectedAttempt}` : ""}`
    : "all nodes";

  const startLabel = filteredLogs.length === 0 ? 0 : virtualWindow.startIndex + 1;
  const endLabel = virtualWindow.startIndex + virtualWindow.items.length;
  const focusedAttempt = getFocusedAttempt({
    attempts: filteredAttempts,
    selectedNodeId: opts.selectedNodeId,
    selectedAttempt: opts.selectedAttempt,
  });
  const promptText = extractAttemptPrompt(focusedAttempt);
  const responseText = focusedAttempt?.responseText?.trim() ?? "";
  const metaText = focusedAttempt?.meta
    ? JSON.stringify(focusedAttempt.meta, null, 2)
    : "";

  return `
    <section class="panel-grid panel-grid-duo">
      <article class="glass-card">
        <h3>Attempt Timeline</h3>
        <p class="muted">Focus ${escapeHtml(selectedFocus)}</p>
        <div class="grid-list">${attemptMarkup || "<p class='muted'>No attempts yet.</p>"}</div>
      </article>
      <article class="glass-card">
        <header class="row-header">
          <h3>Logs</h3>
          <div class="row-actions">
            <label>
              Stream
              <select id="log-stream-filter" class="lucid-input">
                <option value="all" ${opts.streamFilter === "all" ? "selected" : ""}>all</option>
                <option value="stdout" ${opts.streamFilter === "stdout" ? "selected" : ""}>stdout</option>
                <option value="stderr" ${opts.streamFilter === "stderr" ? "selected" : ""}>stderr</option>
              </select>
            </label>
            <label>
              Search
              <input id="log-search" class="lucid-input" value="${escapeHtml(opts.search)}" placeholder="node id, error, stack" />
            </label>
            <button type="button" id="attempt-focus-reset" class="lucid-button">Reset Focus</button>
          </div>
        </header>
        <p class="muted">Showing rows ${startLabel}-${endLabel} of ${filteredLogs.length} (virtualized).</p>
        <div class="log-viewport" id="log-viewport">
          <div style="height:${virtualWindow.paddingTopPx}px"></div>
          ${logRows || "<p class='muted'>No logs for current filters.</p>"}
          <div style="height:${virtualWindow.paddingBottomPx}px"></div>
        </div>
      </article>
    </section>

    <section class="panel-grid">
      <div class="panel-grid panel-grid-duo">
        <article class="glass-card">
          <h3>Event to Attempt Correlation</h3>
          <p class="muted">Click a NodeOutput event to jump directly to attempt and log context.</p>
          <div class="feed-list">${eventRows || "<p class='muted'>No node output events yet.</p>"}</div>
        </article>
        <article class="glass-card">
          <h3>Attempt Audit</h3>
          ${
            focusedAttempt
              ? `
                <p class="kpi-sub">${escapeHtml(focusedAttempt.nodeId)} • attempt #${focusedAttempt.attempt}</p>
                <p class="muted">Prompt</p>
                <pre class="audit-block">${promptText ? escapeHtml(promptText) : "No prompt metadata available."}</pre>
                <p class="muted">Response</p>
                <pre class="audit-block">${responseText ? escapeHtml(responseText) : "No response text captured."}</pre>
                <details class="audit-meta">
                  <summary>Raw meta JSON</summary>
                  <pre class="audit-block">${metaText ? escapeHtml(metaText) : "{}"}</pre>
                </details>
              `
              : "<p class='muted'>No attempt selected.</p>"
          }
        </article>
      </div>
    </section>
  `;
}
