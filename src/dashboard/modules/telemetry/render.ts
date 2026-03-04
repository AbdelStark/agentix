import { escapeHtml, formatDate, formatDuration } from "../../components/format.ts";

function statusClass(state: string): string {
  const normalized = String(state ?? "").toLowerCase();
  if (normalized === "finished" || normalized === "completed" || normalized === "pass") {
    return "status-pass";
  }
  if (normalized === "failed" || normalized === "error") {
    return "status-fail";
  }
  if (normalized === "in-progress" || normalized === "running") {
    return "status-running";
  }
  return "status-pending";
}

function sourceClass(source: string): string {
  if (source === "agentix") return "status-running";
  if (source === "smithers") return "status-pass";
  if (source === "telemetry") return "status-pending";
  return "status-fail";
}

export function renderTelemetryCockpit(opts: {
  toolEvents: any[];
  resources: any[];
  prompts: any[];
  executionSteps: any[];
  timeline: any[];
  liveEvents: any[];
}): string {
  const stepCount = opts.executionSteps.length;
  const promptCount = opts.prompts.length;
  const timelineCount = opts.timeline.length;
  const toolCount = opts.toolEvents.length;
  const resourceCount = opts.resources.length;
  const promptAttachedSteps = opts.executionSteps.filter(
    (step) => step.promptAvailable === true,
  ).length;
  const promptCoverage = stepCount > 0
    ? Math.round((promptAttachedSteps / stepCount) * 100)
    : 0;

  const stepRows = opts.executionSteps
    .slice(0, 80)
    .map(
      (step) => `
        <tr>
          <td>${escapeHtml(String(step.unitId ?? "-"))}</td>
          <td>${escapeHtml(String(step.stage ?? "-"))}</td>
          <td>${escapeHtml(String(step.nodeId ?? "-"))}</td>
          <td>#${Number(step.attempt ?? 0)}</td>
          <td><span class="status-chip ${statusClass(String(step.state ?? ""))}">${escapeHtml(String(step.state ?? "unknown"))}</span></td>
          <td>${formatDuration(step.durationMs)}</td>
          <td>${step.promptAvailable ? "yes" : "no"}</td>
          <td>${escapeHtml(String(step.promptPreview ?? ""))}</td>
          <td>${formatDate(step.timestamp)}</td>
        </tr>
      `,
    )
    .join("");

  const promptRows = opts.prompts
    .slice(0, 80)
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

  const timelineRows = opts.timeline
    .slice(0, 120)
    .map(
      (event) => `
        <tr>
          <td><span class="status-chip ${sourceClass(String(event.source ?? ""))}">${escapeHtml(String(event.source ?? "-"))}</span></td>
          <td>${escapeHtml(String(event.category ?? "-"))}</td>
          <td>${escapeHtml(String(event.eventType ?? "-"))}</td>
          <td>${escapeHtml(String(event.nodeId ?? "-"))}</td>
          <td>${escapeHtml(String(event.summary ?? ""))}</td>
          <td>${formatDate(event.timestamp)}</td>
        </tr>
      `,
    )
    .join("");

  const toolRows = opts.toolEvents
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

  const resourceRows = opts.resources
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

  const liveRows = opts.liveEvents
    .slice(0, 40)
    .map(
      (event) => `
        <div class="feed-row">
          <span>${escapeHtml(String(event.type ?? "-"))}</span>
          <span class="muted">${formatDate(event.timestamp)}</span>
        </div>
      `,
    )
    .join("");

  return `
    <section class="panel-grid panel-grid-kpi">
      <article class="glass-card kpi-card">
        <h3>Telemetry Health</h3>
        <p class="kpi-value">${timelineCount}</p>
        <p class="kpi-sub">timeline events</p>
      </article>
      <article class="glass-card kpi-card">
        <h3>Prompt Coverage</h3>
        <p class="kpi-value">${promptCoverage}%</p>
        <p class="kpi-sub">${promptAttachedSteps}/${stepCount} steps include prompts</p>
      </article>
      <article class="glass-card kpi-card">
        <h3>Tool Calls</h3>
        <p class="kpi-value">${toolCount}</p>
        <p class="kpi-sub">normalized agent tool events</p>
      </article>
      <article class="glass-card kpi-card">
        <h3>Resource Samples</h3>
        <p class="kpi-value">${resourceCount}</p>
        <p class="kpi-sub">cpu and memory snapshots</p>
      </article>
    </section>

    <section class="panel-grid panel-grid-duo">
      <article class="glass-card">
        <h3>Execution Steps</h3>
        <p class="muted">Exact run-stage attempts with prompt attachment and timing evidence.</p>
        <div class="table-wrap">
          <table class="lucid-table">
            <thead>
              <tr><th>Unit</th><th>Stage</th><th>Node</th><th>Attempt</th><th>State</th><th>Duration</th><th>Prompt</th><th>Prompt Preview</th><th>Time</th></tr>
            </thead>
            <tbody>${stepRows || "<tr><td colspan='9'>No execution-step telemetry yet.</td></tr>"}</tbody>
          </table>
        </div>
      </article>
      <article class="glass-card">
        <h3>Prompt Audit</h3>
        <p class="muted">Prompt/response metadata by attempt for deterministic forensic review.</p>
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

    <section class="panel-grid panel-grid-duo">
      <article class="glass-card">
        <h3>Unified Timeline</h3>
        <p class="muted">Correlated chronology across orchestration, command, tool, and resource telemetry.</p>
        <div class="table-wrap">
          <table class="lucid-table">
            <thead>
              <tr><th>Source</th><th>Category</th><th>Type</th><th>Node</th><th>Summary</th><th>Time</th></tr>
            </thead>
            <tbody>${timelineRows || "<tr><td colspan='6'>No timeline telemetry yet.</td></tr>"}</tbody>
          </table>
        </div>
      </article>
      <article class="glass-card">
        <h3>Live Event Pulse</h3>
        <p class="muted">Recent stream events while projections refresh in the background.</p>
        <div class="feed-list">${liveRows || "<p class='muted'>No live events yet.</p>"}</div>
      </article>
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
  `;
}
