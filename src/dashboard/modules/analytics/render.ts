import { buildAnalyticsSeries, summarizeFailureTaxonomy } from "./trends.ts";
import { escapeHtml } from "../../components/format.ts";

function sparkline(values: number[]): string {
  if (!values.length) return "";
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.0001, max - min);
  return values
    .map((value) => {
      const ratio = (value - min) / range;
      const index = Math.max(0, Math.min(blocks.length - 1, Math.round(ratio * (blocks.length - 1))));
      return blocks[index];
    })
    .join("");
}

export function renderAnalyticsPanel(opts: {
  analyticsSnapshots: Array<{ payload: Record<string, unknown>; date: string }>;
}): string {
  const latest = opts.analyticsSnapshots?.[0]?.payload ?? {};
  const daily =
    latest.trends && typeof latest.trends === "object" && Array.isArray((latest.trends as any).daily)
      ? ((latest.trends as any).daily as Array<{ date: string; started: number; completed: number; failed: number; cancelled: number }> )
      : [];

  const series = buildAnalyticsSeries(daily);
  const taxonomy = summarizeFailureTaxonomy(
    (latest.failures && typeof latest.failures === "object"
      ? ((latest.failures as any).taxonomy as Record<string, number>)
      : {}) ?? {},
  );

  const recommendations = Array.isArray(latest.recommendations)
    ? (latest.recommendations as Array<Record<string, unknown>>)
    : [];

  const recommendationMarkup = recommendations
    .slice(0, 6)
    .map(
      (entry) => `
        <article class="glass-card recommendation-card">
          <header>
            <h4>${escapeHtml(String(entry.priority ?? "medium").toUpperCase())}</h4>
            <span class="status-chip status-running">${escapeHtml(String(entry.category ?? "ops"))}</span>
          </header>
          <p>${escapeHtml(String(entry.insight ?? ""))}</p>
          <p class="muted">${escapeHtml(String(entry.action ?? ""))}</p>
        </article>
      `,
    )
    .join("");

  const taxonomyRows = taxonomy
    .map((entry) => `<tr><td>${escapeHtml(entry.reason)}</td><td>${entry.count}</td></tr>`)
    .join("");

  return `
    <section class="panel-grid panel-grid-duo">
      <article class="glass-card">
        <h3>Reliability Trends</h3>
        <p class="kpi-sub">window ${escapeHtml(String((latest.window as any)?.label ?? "-"))}</p>
        <div class="trend-row">
          <span>Success</span>
          <code>${sparkline(series.successRate)}</code>
        </div>
        <div class="trend-row">
          <span>Failure</span>
          <code>${sparkline(series.failureRate)}</code>
        </div>
        <div class="trend-row">
          <span>Cancelled</span>
          <code>${sparkline(series.cancellationRate)}</code>
        </div>
      </article>
      <article class="glass-card">
        <h3>Failure Taxonomy</h3>
        <div class="table-wrap">
          <table class="lucid-table">
            <thead><tr><th>Reason</th><th>Count</th></tr></thead>
            <tbody>${taxonomyRows || "<tr><td colspan='2'>No failures in window.</td></tr>"}</tbody>
          </table>
        </div>
      </article>
    </section>

    <section class="panel-grid panel-grid-duo">
      <article class="glass-card">
        <h3>Recommendations</h3>
        <div class="grid-list">${recommendationMarkup || "<p class='muted'>No recommendations.</p>"}</div>
      </article>
      <article class="glass-card">
        <h3>Run Stability</h3>
        <p class="kpi-sub">resume rate ${(Number((latest.runStability as any)?.resumeRate ?? 0) * 100).toFixed(1)}%</p>
        <p class="kpi-sub">non-zero exits ${String((latest.runStability as any)?.nonZeroExitCount ?? 0)}</p>
      </article>
    </section>
  `;
}
