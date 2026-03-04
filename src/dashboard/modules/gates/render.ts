import { evaluateGateBoard } from "./gate-evaluator.ts";
import { escapeHtml } from "../../components/format.ts";

export function renderGateBoard(opts: {
  stageOutputs: Array<{ table: string; row: Record<string, unknown> }>;
  traces: Array<{
    traceCompleteness: boolean | null;
    uncoveredScenarios: string[];
    scenariosTotal: number;
    scenariosCovered: number;
    antiSlopFlags?: string[];
  }>;
}): string {
  const gates = evaluateGateBoard({
    stageOutputs: opts.stageOutputs,
    traces: opts.traces,
  });

  const cards = gates
    .map((gate) => {
      const className =
        gate.state === "pass"
          ? "status-pass"
          : gate.state === "fail"
            ? "status-fail"
            : "status-pending";
      return `
        <article class="glass-card gate-card">
          <header>
            <h4>${escapeHtml(gate.label)}</h4>
            <span class="status-chip ${className}">${escapeHtml(gate.state)}</span>
          </header>
          <p class="gate-reason">${escapeHtml(gate.reason)}</p>
          ${
            gate.evidence.length > 0
              ? `<div class="chip-row">${gate.evidence
                  .slice(0, 6)
                  .map((item) => `<span class="status-chip status-fail">${escapeHtml(item)}</span>`)
                  .join("")}</div>`
              : ""
          }
          ${
            gate.actionTarget
              ? `<button type="button" class="lucid-button gate-action" data-gate-action="${gate.actionTarget}">Inspect in ${gate.actionTarget}</button>`
              : ""
          }
        </article>
      `;
    })
    .join("");

  return `
    <section class="panel-grid panel-grid-triple">
      ${cards}
    </section>
  `;
}
