export type RiskRow = {
  ticketId: string;
  riskScore: number;
  riskBand: string;
  mergeStrategy: string;
};

export type RiskPanelModel = {
  strategy: "speculative" | "sequential" | "mixed" | "unknown";
  recommendedOrder: string[];
  highRiskTickets: string[];
  rows: RiskRow[];
};

export type RiskTimelineEntry = {
  iteration: number;
  landedCount: number;
  evictedCount: number;
  skippedCount: number;
  evictedTickets: string[];
};

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function buildRiskPanelModel(
  riskSnapshot: Record<string, unknown> | null,
): RiskPanelModel {
  if (!riskSnapshot) {
    return {
      strategy: "unknown",
      recommendedOrder: [],
      highRiskTickets: [],
      rows: [],
    };
  }

  const riskTable = Array.isArray(riskSnapshot.riskTable)
    ? (riskSnapshot.riskTable as Array<Record<string, unknown>>)
    : [];
  const recommendedOrderRaw = Array.isArray(riskSnapshot.recommendedOrder)
    ? (riskSnapshot.recommendedOrder as Array<Record<string, unknown>>)
    : [];

  const rows = riskTable
    .map((entry) => ({
      ticketId: String(entry.ticketId ?? "unknown"),
      riskScore: asNumber(entry.riskScore),
      riskBand: String(entry.riskBand ?? "unknown"),
      mergeStrategy: String(entry.mergeStrategy ?? "unknown"),
    }))
    .sort((a, b) => b.riskScore - a.riskScore);

  const strategies = new Set(rows.map((row) => row.mergeStrategy));
  const strategy = strategies.size === 0
    ? "unknown"
    : strategies.size === 1
      ? (strategies.values().next().value as "speculative" | "sequential")
      : "mixed";

  return {
    strategy,
    recommendedOrder: recommendedOrderRaw.map((entry) => String(entry.ticketId ?? "unknown")),
    highRiskTickets: rows
      .filter((row) => row.riskBand === "high")
      .map((row) => row.ticketId),
    rows,
  };
}

export function buildRiskTimeline(
  rows: Array<{
    iteration: number;
    ticketsLanded?: Array<Record<string, unknown>>;
    ticketsEvicted?: Array<Record<string, unknown>>;
    ticketsSkipped?: Array<Record<string, unknown>>;
  }>,
): RiskTimelineEntry[] {
  const timeline = (rows ?? []).map((row) => {
    const iteration = asNumber(row.iteration);
    const landed = Array.isArray(row.ticketsLanded) ? row.ticketsLanded : [];
    const evicted = Array.isArray(row.ticketsEvicted) ? row.ticketsEvicted : [];
    const skipped = Array.isArray(row.ticketsSkipped) ? row.ticketsSkipped : [];

    return {
      iteration,
      landedCount: landed.length,
      evictedCount: evicted.length,
      skippedCount: skipped.length,
      evictedTickets: evicted
        .map((entry) => String(entry.ticketId ?? "").trim())
        .filter((ticketId) => ticketId.length > 0)
        .sort((a, b) => a.localeCompare(b)),
    } satisfies RiskTimelineEntry;
  });

  timeline.sort((a, b) => b.iteration - a.iteration);
  return timeline;
}
