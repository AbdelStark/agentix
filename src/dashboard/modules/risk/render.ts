import { buildRiskPanelModel, buildRiskTimeline } from "./risk-model.ts";
import { escapeHtml } from "../../components/format.ts";

export function renderRiskPanel(opts: {
  mergeRiskRows: Array<{
    iteration: number;
    riskSnapshot: Record<string, unknown> | null;
    summary?: string;
    ticketsLanded?: Array<Record<string, unknown>>;
    ticketsEvicted?: Array<Record<string, unknown>>;
    ticketsSkipped?: Array<Record<string, unknown>>;
  }>;
}): string {
  const latest = opts.mergeRiskRows?.[0] ?? null;
  const model = buildRiskPanelModel(latest?.riskSnapshot ?? null);
  const timeline = buildRiskTimeline(opts.mergeRiskRows ?? []);
  const latestEvictions = Array.isArray(latest?.ticketsEvicted)
    ? latest!.ticketsEvicted!
    : [];

  const rows = model.rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.ticketId)}</td>
          <td>${row.riskScore}</td>
          <td>${escapeHtml(row.riskBand)}</td>
          <td>${escapeHtml(row.mergeStrategy)}</td>
        </tr>
      `,
    )
    .join("");

  const timelineRows = timeline
    .map(
      (entry) => `
        <tr>
          <td>${entry.iteration}</td>
          <td>${entry.landedCount}</td>
          <td>${entry.evictedCount}</td>
          <td>${entry.skippedCount}</td>
        </tr>
      `,
    )
    .join("");

  const evictionRows = latestEvictions
    .map((entry) => {
      const reason =
        typeof entry.reason === "string" && entry.reason.trim()
          ? entry.reason.trim()
          : typeof entry.status === "string"
            ? entry.status
            : "evicted";
      return `
        <tr>
          <td>${escapeHtml(String(entry.ticketId ?? "unknown"))}</td>
          <td>${escapeHtml(String(entry.unitName ?? "-"))}</td>
          <td>${escapeHtml(reason)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <section class="panel-grid panel-grid-duo">
      <article class="glass-card">
        <h3>Merge Strategy</h3>
        <p class="kpi-value">${escapeHtml(model.strategy)}</p>
        <p class="kpi-sub">recommended order ${escapeHtml(model.recommendedOrder.join(" → ") || "-")}</p>
        <div class="chip-row">
          ${
            model.highRiskTickets.length
              ? model.highRiskTickets
                  .map((ticketId) => `<span class="status-chip status-fail">${escapeHtml(ticketId)}</span>`)
                  .join("")
              : '<span class="status-chip status-pass">No high-risk tickets</span>'
          }
        </div>
      </article>
      <article class="glass-card">
        <h3>Risk Table</h3>
        <div class="table-wrap">
          <table class="lucid-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Score</th>
                <th>Band</th>
                <th>Strategy</th>
              </tr>
            </thead>
            <tbody>${rows || "<tr><td colspan='4'>No risk rows.</td></tr>"}</tbody>
          </table>
        </div>
      </article>
    </section>

    <section class="panel-grid panel-grid-duo">
      <article class="glass-card">
        <h3>Land/Evict Timeline</h3>
        <div class="table-wrap">
          <table class="lucid-table">
            <thead>
              <tr><th>Iteration</th><th>Landed</th><th>Evicted</th><th>Skipped</th></tr>
            </thead>
            <tbody>${timelineRows || "<tr><td colspan='4'>No merge history yet.</td></tr>"}</tbody>
          </table>
        </div>
      </article>
      <article class="glass-card">
        <h3>Latest Eviction Context</h3>
        <div class="table-wrap">
          <table class="lucid-table">
            <thead>
              <tr><th>Ticket</th><th>Unit</th><th>Reason</th></tr>
            </thead>
            <tbody>${evictionRows || "<tr><td colspan='3'>No evictions in latest iteration.</td></tr>"}</tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}
