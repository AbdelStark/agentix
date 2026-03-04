export type DagNodeView = {
  id: string;
  title: string;
  tier: string;
  priority: string;
  deps: string[];
  state: string;
};

export type DagEdgeView = {
  from: string;
  to: string;
};

export type DagViewModel = {
  nodes: DagNodeView[];
  edges: DagEdgeView[];
  warnings: string[];
};

export function buildDagViewModel(opts: {
  workPlanUnits: Array<{
    id: string;
    name: string;
    tier: string;
    priority?: string;
    deps: string[];
  }>;
  nodeStates: Array<{ nodeId: string; state: string }>;
}): DagViewModel {
  const warnings: string[] = [];
  const units = opts.workPlanUnits ?? [];
  const unitIds = new Set(units.map((unit) => unit.id));

  const stateByUnitId = new Map<string, string>();
  for (const node of opts.nodeStates ?? []) {
    const unitId = String(node.nodeId ?? "").split(":")[0] ?? "";
    const existing = stateByUnitId.get(unitId);
    if (!existing) {
      stateByUnitId.set(unitId, String(node.state ?? "unknown"));
      continue;
    }

    const ranking: Record<string, number> = {
      failed: 4,
      "in-progress": 3,
      finished: 2,
      pending: 1,
      unknown: 0,
    };

    const currentRank = ranking[existing] ?? 0;
    const nextRank = ranking[String(node.state ?? "unknown")] ?? 0;
    if (nextRank > currentRank) {
      stateByUnitId.set(unitId, String(node.state ?? "unknown"));
    }
  }

  const nodes: DagNodeView[] = units
    .map((unit) => ({
      id: unit.id,
      title: unit.name,
      tier: unit.tier,
      priority: unit.priority ?? "medium",
      deps: Array.isArray(unit.deps) ? unit.deps : [],
      state: stateByUnitId.get(unit.id) ?? "pending",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const edges: DagEdgeView[] = [];
  for (const node of nodes) {
    for (const dep of node.deps) {
      if (!unitIds.has(dep)) {
        warnings.push(`Unknown dependency edge: ${dep} -> ${node.id}`);
        continue;
      }
      edges.push({ from: dep, to: node.id });
    }
  }

  edges.sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    return a.to.localeCompare(b.to);
  });

  return { nodes, edges, warnings };
}
