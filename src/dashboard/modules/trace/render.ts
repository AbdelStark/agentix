import { summarizeTraceArtifacts } from "./trace-model.ts";
import { escapeHtml } from "../../components/format.ts";

export function renderTracePanel(opts: {
  traces: Array<{
    unitId: string;
    traceCompleteness: boolean | null;
    scenariosTotal: number;
    scenariosCovered: number;
    uncoveredScenarios: string[];
    antiSlopFlags: string[];
  }>;
}): string {
  const summary = summarizeTraceArtifacts(opts.traces);

  const traceRows = (opts.traces ?? [])
    .map(
      (trace) => `
        <tr>
          <td>${escapeHtml(trace.unitId)}</td>
          <td>${trace.traceCompleteness === true ? "complete" : "incomplete"}</td>
          <td>${trace.scenariosCovered}/${trace.scenariosTotal}</td>
          <td>${trace.uncoveredScenarios.length}</td>
        </tr>
      `,
    )
    .join("");

  return `
    <section class="panel-grid panel-grid-duo">
      <article class="glass-card">
        <h3>Trace Completeness</h3>
        <p class="kpi-value">${summary.completeUnits}/${summary.totalUnits}</p>
        <p class="kpi-sub">${summary.incompleteUnits} incomplete units</p>
        <div class="chip-row">
          ${
            summary.uncoveredScenarios.length
              ? summary.uncoveredScenarios
                  .slice(0, 8)
                  .map((id) => `<span class="status-chip status-fail">${escapeHtml(id)}</span>`)
                  .join("")
              : '<span class="status-chip status-pass">No uncovered scenarios</span>'
          }
        </div>
        <div class="chip-row">
          ${
            summary.antiSlopFlags.length
              ? summary.antiSlopFlags
                  .slice(0, 8)
                  .map((flag) => `<span class="status-chip status-fail">${escapeHtml(flag)}</span>`)
                  .join("")
              : '<span class="status-chip status-pass">No anti-slop flags</span>'
          }
        </div>
      </article>
      <article class="glass-card">
        <h3>Trace Units</h3>
        <div class="table-wrap">
          <table class="lucid-table">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Trace</th>
                <th>Coverage</th>
                <th>Uncovered</th>
              </tr>
            </thead>
            <tbody>${traceRows || "<tr><td colspan='4'>No trace artifacts found.</td></tr>"}</tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}
