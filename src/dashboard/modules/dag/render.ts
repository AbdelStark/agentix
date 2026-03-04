import { buildDagViewModel } from "./graph.ts";
import { escapeHtml } from "../../components/format.ts";

export type DagFilterState = {
  tier: "all" | string;
  priority: "all" | string;
  failedOnly: boolean;
  evictedOnly: boolean;
};

export function defaultDagFilters(): DagFilterState {
  return {
    tier: "all",
    priority: "all",
    failedOnly: false,
    evictedOnly: false,
  };
}

export function renderDag(opts: {
  workPlan: { units: any[] } | null;
  nodes: any[];
  mergeRiskRows: Array<{ ticketsEvicted: Array<{ ticketId: string }> }>;
  filters: DagFilterState;
}): string {
  const workPlanUnits = opts.workPlan?.units ?? [];
  const evictedIds = new Set<string>();
  for (const row of opts.mergeRiskRows ?? []) {
    for (const evicted of row.ticketsEvicted ?? []) {
      if (evicted?.ticketId) evictedIds.add(String(evicted.ticketId));
    }
  }

  const dag = buildDagViewModel({
    workPlanUnits: workPlanUnits.map((unit) => ({
      id: String(unit.id ?? ""),
      name: String(unit.name ?? unit.id ?? "unknown"),
      tier: String(unit.tier ?? "medium"),
      priority: String(unit.priority ?? "medium"),
      deps: Array.isArray(unit.deps) ? unit.deps.map((dep: unknown) => String(dep)) : [],
    })),
    nodeStates: (opts.nodes ?? []).map((node) => ({
      nodeId: String(node.nodeId ?? ""),
      state: String(node.state ?? "unknown"),
    })),
  });

  const filteredNodes = dag.nodes.filter((node) => {
    if (opts.filters.tier !== "all" && node.tier !== opts.filters.tier) return false;
    if (opts.filters.priority !== "all" && node.priority !== opts.filters.priority) return false;
    if (opts.filters.failedOnly && node.state !== "failed") return false;
    if (opts.filters.evictedOnly && !evictedIds.has(node.id)) return false;
    return true;
  });

  const cardMarkup = filteredNodes
    .map((node) => {
      const evicted = evictedIds.has(node.id);
      const stateClass =
        node.state === "failed"
          ? "status-fail"
          : node.state === "in-progress"
            ? "status-running"
            : node.state === "finished"
              ? "status-pass"
              : "status-pending";

      return `
        <article class="glass-card dag-card" data-unit-id="${escapeHtml(node.id)}">
          <header>
            <h4>${escapeHtml(node.id)}</h4>
            <span class="status-chip ${stateClass}">${escapeHtml(node.state)}</span>
          </header>
          <p class="dag-card-title">${escapeHtml(node.title)}</p>
          <p class="dag-card-meta">tier ${escapeHtml(node.tier)} • priority ${escapeHtml(node.priority)}</p>
          <p class="dag-card-meta">deps ${escapeHtml(node.deps.length ? node.deps.join(", ") : "none")}</p>
          ${evicted ? '<p class="dag-card-meta danger">Latest merge queue status: evicted</p>' : ""}
        </article>
      `;
    })
    .join("");

  const edgeMarkup = dag.edges
    .filter((edge) =>
      filteredNodes.some((node) => node.id === edge.from) &&
      filteredNodes.some((node) => node.id === edge.to),
    )
    .map((edge) => `<li>${escapeHtml(edge.from)} → ${escapeHtml(edge.to)}</li>`)
    .join("");

  return `
    <section class="panel-grid panel-grid-duo">
      <article class="glass-card">
        <h3>Dependency Graph</h3>
        <div class="chip-row">
          <span class="status-chip status-pending">${filteredNodes.length} units visible</span>
          <span class="status-chip status-running">${dag.edges.length} edges</span>
        </div>
        <div class="grid-list dag-grid">${cardMarkup || "<p class='muted'>No units match current filters.</p>"}</div>
      </article>
      <article class="glass-card">
        <h3>Edges</h3>
        <ul class="plain-list">${edgeMarkup || "<li>No edges in filtered view.</li>"}</ul>
        ${dag.warnings.length ? `<p class="muted">${escapeHtml(dag.warnings.join(" • "))}</p>` : ""}
      </article>
    </section>
  `;
}
