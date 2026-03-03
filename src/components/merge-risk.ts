export type MergeQueuePriority = "critical" | "high" | "medium" | "low";
export type MergeRiskBand = "low" | "medium" | "high";
export type MergeStrategy = "speculative" | "sequential";
export type MergeRiskTier = "trivial" | "small" | "medium" | "large";

export type MergeRiskTicketInput = {
  ticketId: string;
  priority: MergeQueuePriority;
  ticketCategory: string;
  filesModified: string[];
  filesCreated: string[];
  historicalEvictions?: number;
  dependencyProximity?: number;
};

export type MergeRiskConfig = {
  scoringVersion: string;
  weights: {
    baseRisk: number;
    overlapCount: number;
    churnScore: number;
    historicalEvictions: number;
    dependencyProximity: number;
    tierComplexity: Record<MergeRiskTier, number>;
  };
  caps: {
    overlap: number;
    churn: number;
    historicalEvictions: number;
    dependencyProximity: number;
  };
  thresholds: {
    medium: number;
    high: number;
    sequential: number;
  };
  maxSpeculativeBatchSizeByBand: Record<MergeRiskBand, number>;
};

export type MergeRiskTableEntry = {
  ticketId: string;
  priority: MergeQueuePriority;
  ticketCategory: string;
  overlapCount: number;
  churnScore: number;
  historicalEvictions: number;
  dependencyProximity: number;
  contributions: {
    baseRisk: number;
    tierComplexity: number;
    overlap: number;
    churn: number;
    historicalEvictions: number;
    dependencyProximity: number;
  };
  riskScore: number;
  riskBand: MergeRiskBand;
  mergeStrategy: MergeStrategy;
};

export type MergeRiskOrderEntry = {
  rank: number;
  ticketId: string;
  priority: MergeQueuePriority;
  riskScore: number;
  riskBand: MergeRiskBand;
  mergeStrategy: MergeStrategy;
  speculativeBatch: string | null;
};

export type MergeRiskPlan = {
  scoringVersion: string;
  config: MergeRiskConfig;
  riskTable: MergeRiskTableEntry[];
  recommendedOrder: MergeRiskOrderEntry[];
  speculativeBatches: string[][];
  sequentialTickets: string[];
};

export type MergeRiskPlanOptions = {
  config?: MergeRiskConfig;
  maxSpeculativeDepth?: number;
  fileEditFrequency?: Record<string, number>;
};

const PRIORITY_ORDER: Record<MergeQueuePriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const DEFAULT_MERGE_RISK_CONFIG: MergeRiskConfig = {
  scoringVersion: "merge-risk-v1",
  weights: {
    baseRisk: 5,
    overlapCount: 14,
    churnScore: 4,
    historicalEvictions: 12,
    dependencyProximity: 7,
    tierComplexity: {
      trivial: 4,
      small: 10,
      medium: 18,
      large: 26,
    },
  },
  caps: {
    overlap: 40,
    churn: 20,
    historicalEvictions: 24,
    dependencyProximity: 21,
  },
  thresholds: {
    medium: 35,
    high: 65,
    sequential: 65,
  },
  maxSpeculativeBatchSizeByBand: {
    low: 4,
    medium: 2,
    high: 0,
  },
};

function normalizeTier(ticketCategory: string): MergeRiskTier {
  switch (ticketCategory) {
    case "trivial":
    case "small":
    case "medium":
    case "large":
      return ticketCategory;
    default:
      return "medium";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toNonNegativeInt(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

function uniqueTouchedFiles(ticket: MergeRiskTicketInput): string[] {
  return [...new Set([...(ticket.filesModified ?? []), ...(ticket.filesCreated ?? [])])];
}

function buildFileTicketIndex(
  tickets: MergeRiskTicketInput[],
): {
  byTicket: Map<string, string[]>;
  byFile: Map<string, string[]>;
} {
  const byTicket = new Map<string, string[]>();
  const byFile = new Map<string, string[]>();

  for (const ticket of tickets) {
    const files = uniqueTouchedFiles(ticket);
    byTicket.set(ticket.ticketId, files);
    for (const file of files) {
      const existing = byFile.get(file) ?? [];
      if (!existing.includes(ticket.ticketId)) {
        byFile.set(file, [...existing, ticket.ticketId]);
      }
    }
  }

  return { byTicket, byFile };
}

function deriveFileEditFrequency(
  byFile: Map<string, string[]>,
  provided: Record<string, number> | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [file, ticketIds] of byFile.entries()) {
    if (provided && Object.prototype.hasOwnProperty.call(provided, file)) {
      out.set(file, Math.max(1, toNonNegativeInt(provided[file])));
      continue;
    }
    out.set(file, Math.max(1, ticketIds.length));
  }
  return out;
}

function compareRiskEntries(
  a: MergeRiskTableEntry,
  b: MergeRiskTableEntry,
): number {
  const priorityDelta = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (priorityDelta !== 0) return priorityDelta;

  const riskDelta = a.riskScore - b.riskScore;
  if (riskDelta !== 0) return riskDelta;

  const depDelta = a.dependencyProximity - b.dependencyProximity;
  if (depDelta !== 0) return depDelta;

  return a.ticketId.localeCompare(b.ticketId);
}

function classifyRiskBand(score: number, config: MergeRiskConfig): MergeRiskBand {
  if (score >= config.thresholds.high) return "high";
  if (score >= config.thresholds.medium) return "medium";
  return "low";
}

function classifyMergeStrategy(
  score: number,
  config: MergeRiskConfig,
): MergeStrategy {
  if (score >= config.thresholds.sequential) return "sequential";
  return "speculative";
}

export function buildMergeRiskPlan(
  tickets: MergeRiskTicketInput[],
  options: MergeRiskPlanOptions = {},
): MergeRiskPlan {
  const config = options.config ?? DEFAULT_MERGE_RISK_CONFIG;
  const maxSpeculativeDepth =
    options.maxSpeculativeDepth ?? Number.POSITIVE_INFINITY;
  const { byTicket, byFile } = buildFileTicketIndex(tickets);
  const fileEditFrequency = deriveFileEditFrequency(byFile, options.fileEditFrequency);

  const riskTable = tickets.map((ticket): MergeRiskTableEntry => {
    const files = byTicket.get(ticket.ticketId) ?? [];
    const overlapWith = new Set<string>();
    let churnUnits = 0;

    for (const file of files) {
      const ticketIds = byFile.get(file) ?? [];
      for (const other of ticketIds) {
        if (other !== ticket.ticketId) overlapWith.add(other);
      }
      const frequency = fileEditFrequency.get(file) ?? 1;
      churnUnits += Math.max(0, frequency - 1);
    }

    const overlapCount = overlapWith.size;
    const historicalEvictions = toNonNegativeInt(ticket.historicalEvictions ?? 0);
    const dependencyProximity = toNonNegativeInt(ticket.dependencyProximity ?? 0);
    const tier = normalizeTier(ticket.ticketCategory);

    const contributions = {
      baseRisk: config.weights.baseRisk,
      tierComplexity: config.weights.tierComplexity[tier],
      overlap: Math.min(
        config.caps.overlap,
        overlapCount * config.weights.overlapCount,
      ),
      churn: Math.min(
        config.caps.churn,
        churnUnits * config.weights.churnScore,
      ),
      historicalEvictions: Math.min(
        config.caps.historicalEvictions,
        historicalEvictions * config.weights.historicalEvictions,
      ),
      dependencyProximity: Math.min(
        config.caps.dependencyProximity,
        dependencyProximity * config.weights.dependencyProximity,
      ),
    };

    const riskScore = clamp(
      Math.round(
        contributions.baseRisk +
          contributions.tierComplexity +
          contributions.overlap +
          contributions.churn +
          contributions.historicalEvictions +
          contributions.dependencyProximity,
      ),
      0,
      100,
    );

    return {
      ticketId: ticket.ticketId,
      priority: ticket.priority,
      ticketCategory: ticket.ticketCategory,
      overlapCount,
      churnScore: churnUnits,
      historicalEvictions,
      dependencyProximity,
      contributions,
      riskScore,
      riskBand: classifyRiskBand(riskScore, config),
      mergeStrategy: classifyMergeStrategy(riskScore, config),
    };
  });

  const orderedRisk = [...riskTable].sort(compareRiskEntries);
  const speculativeBatches: string[][] = [];
  const sequentialTickets: string[] = [];
  const batchAssignment = new Map<string, string | null>();

  let currentBatch: string[] = [];
  let currentCap = Number.POSITIVE_INFINITY;

  const flushBatch = () => {
    if (currentBatch.length === 0) return;
    speculativeBatches.push(currentBatch);
    currentBatch = [];
    currentCap = Number.POSITIVE_INFINITY;
  };

  for (const entry of orderedRisk) {
    if (entry.mergeStrategy === "sequential") {
      flushBatch();
      sequentialTickets.push(entry.ticketId);
      batchAssignment.set(entry.ticketId, null);
      continue;
    }

    const bandCap = config.maxSpeculativeBatchSizeByBand[entry.riskBand];
    const cap = clamp(Math.min(maxSpeculativeDepth, bandCap), 0, Number.MAX_SAFE_INTEGER);

    if (cap <= 0) {
      flushBatch();
      sequentialTickets.push(entry.ticketId);
      batchAssignment.set(entry.ticketId, null);
      continue;
    }

    if (currentBatch.length === 0) {
      currentCap = cap;
      currentBatch.push(entry.ticketId);
      continue;
    }

    const effectiveCap = Math.min(currentCap, cap);
    if (currentBatch.length >= effectiveCap) {
      flushBatch();
      currentCap = cap;
    } else {
      currentCap = effectiveCap;
    }

    currentBatch.push(entry.ticketId);
  }
  flushBatch();

  for (let i = 0; i < speculativeBatches.length; i += 1) {
    const batchId = `batch-${i + 1}`;
    for (const ticketId of speculativeBatches[i]) {
      batchAssignment.set(ticketId, batchId);
    }
  }

  const recommendedOrder = orderedRisk.map((entry, idx) => ({
    rank: idx + 1,
    ticketId: entry.ticketId,
    priority: entry.priority,
    riskScore: entry.riskScore,
    riskBand: entry.riskBand,
    mergeStrategy: entry.mergeStrategy,
    speculativeBatch: batchAssignment.get(entry.ticketId) ?? null,
  }));

  return {
    scoringVersion: config.scoringVersion,
    config,
    riskTable: orderedRisk,
    recommendedOrder,
    speculativeBatches,
    sequentialTickets,
  };
}
