import { describe, expect, test } from "bun:test";
import {
  buildMergeRiskPlan,
  DEFAULT_MERGE_RISK_CONFIG,
  type MergeRiskTicketInput,
} from "./merge-risk";

function mkTicket(
  overrides: Partial<MergeRiskTicketInput> & Pick<MergeRiskTicketInput, "ticketId">,
): MergeRiskTicketInput {
  return {
    ticketId: overrides.ticketId,
    priority: "medium",
    ticketCategory: "medium",
    filesModified: [],
    filesCreated: [],
    historicalEvictions: 0,
    dependencyProximity: 0,
    ...overrides,
  };
}

describe("buildMergeRiskPlan", () => {
  test("scores risk deterministically from overlap, churn, tier, evictions, and dependency proximity", () => {
    const tickets: MergeRiskTicketInput[] = [
      mkTicket({
        ticketId: "unit-a",
        ticketCategory: "medium",
        filesModified: ["src/shared.ts", "src/a.ts"],
        historicalEvictions: 1,
        dependencyProximity: 1,
      }),
      mkTicket({
        ticketId: "unit-b",
        ticketCategory: "large",
        filesModified: ["src/shared.ts", "src/b.ts"],
      }),
      mkTicket({
        ticketId: "unit-c",
        ticketCategory: "trivial",
        filesModified: ["src/c.ts"],
      }),
    ];

    const plan = buildMergeRiskPlan(tickets);
    const byId = new Map(plan.riskTable.map((entry) => [entry.ticketId, entry]));

    expect(byId.get("unit-a")).toEqual(
      expect.objectContaining({
        overlapCount: 1,
        churnScore: 1,
        historicalEvictions: 1,
        dependencyProximity: 1,
        riskScore: 60,
        riskBand: "medium",
        mergeStrategy: "speculative",
      }),
    );
    expect(byId.get("unit-b")).toEqual(
      expect.objectContaining({
        overlapCount: 1,
        churnScore: 1,
        historicalEvictions: 0,
        dependencyProximity: 0,
        riskScore: 49,
        riskBand: "medium",
        mergeStrategy: "speculative",
      }),
    );
    expect(byId.get("unit-c")).toEqual(
      expect.objectContaining({
        overlapCount: 0,
        churnScore: 0,
        historicalEvictions: 0,
        dependencyProximity: 0,
        riskScore: 9,
        riskBand: "low",
        mergeStrategy: "speculative",
      }),
    );
  });

  test("orders by priority first, then risk score, then ticket ID for stable deterministic ties", () => {
    const tickets: MergeRiskTicketInput[] = [
      mkTicket({
        ticketId: "z-medium",
        priority: "medium",
        ticketCategory: "small",
        filesModified: ["src/m1.ts"],
      }),
      mkTicket({
        ticketId: "a-medium",
        priority: "medium",
        ticketCategory: "small",
        filesModified: ["src/m2.ts"],
      }),
      mkTicket({
        ticketId: "critical-risky",
        priority: "critical",
        ticketCategory: "large",
        filesModified: ["src/m1.ts", "src/critical.ts"],
        historicalEvictions: 2,
      }),
    ];

    const plan = buildMergeRiskPlan(tickets);
    expect(plan.recommendedOrder.map((entry) => entry.ticketId)).toEqual([
      "critical-risky",
      "a-medium",
      "z-medium",
    ]);
  });

  test("forces high-risk tickets to sequential strategy and breaks speculative batches", () => {
    const tickets: MergeRiskTicketInput[] = [
      mkTicket({
        ticketId: "batch-low-1",
        ticketCategory: "trivial",
        filesModified: ["src/l1.ts"],
      }),
      mkTicket({
        ticketId: "batch-low-2",
        ticketCategory: "trivial",
        filesModified: ["src/l2.ts"],
      }),
      mkTicket({
        ticketId: "high-risk",
        ticketCategory: "large",
        filesModified: ["src/high.ts", "src/critical.ts"],
        historicalEvictions: 2,
        dependencyProximity: 2,
      }),
      mkTicket({
        ticketId: "batch-medium-1",
        ticketCategory: "medium",
        filesModified: ["src/medium-shared.ts", "src/m1.ts"],
      }),
      mkTicket({
        ticketId: "batch-medium-2",
        ticketCategory: "medium",
        filesModified: ["src/medium-shared.ts", "src/m2.ts"],
      }),
      mkTicket({
        ticketId: "batch-medium-3",
        ticketCategory: "medium",
        filesModified: ["src/medium-shared.ts", "src/m3.ts"],
      }),
    ];

    const plan = buildMergeRiskPlan(tickets, { maxSpeculativeDepth: 4 });
    const highRisk = plan.riskTable.find((entry) => entry.ticketId === "high-risk");
    expect(highRisk).toEqual(
      expect.objectContaining({
        riskBand: "high",
        mergeStrategy: "sequential",
      }),
    );

    expect(plan.speculativeBatches).toEqual([
      ["batch-low-1", "batch-low-2"],
      ["batch-medium-1", "batch-medium-2"],
      ["batch-medium-3"],
    ]);
    expect(plan.sequentialTickets).toEqual(["high-risk"]);
  });

  test("is deterministic for identical inputs regardless of ticket array order", () => {
    const tickets: MergeRiskTicketInput[] = [
      mkTicket({
        ticketId: "unit-z",
        ticketCategory: "small",
        filesModified: ["src/shared.ts", "src/z.ts"],
      }),
      mkTicket({
        ticketId: "unit-a",
        ticketCategory: "small",
        filesModified: ["src/shared.ts", "src/a.ts"],
      }),
      mkTicket({
        ticketId: "unit-m",
        ticketCategory: "medium",
        filesModified: ["src/m.ts"],
      }),
    ];

    const first = buildMergeRiskPlan(tickets, {
      maxSpeculativeDepth: 3,
      config: DEFAULT_MERGE_RISK_CONFIG,
    });
    const second = buildMergeRiskPlan([...tickets].reverse(), {
      maxSpeculativeDepth: 3,
      config: DEFAULT_MERGE_RISK_CONFIG,
    });

    expect(first.recommendedOrder).toEqual(second.recommendedOrder);
    expect(first.speculativeBatches).toEqual(second.speculativeBatches);
    expect(first.sequentialTickets).toEqual(second.sequentialTickets);

    const firstRiskById = [...first.riskTable].sort((a, b) => a.ticketId.localeCompare(b.ticketId));
    const secondRiskById = [...second.riskTable].sort((a, b) => a.ticketId.localeCompare(b.ticketId));
    expect(firstRiskById).toEqual(secondRiskById);
  });
});
