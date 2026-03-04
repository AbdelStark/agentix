import { describe, expect, test } from "bun:test";

import { buildRiskPanelModel, buildRiskTimeline } from "./risk-model";

describe("risk panel model", () => {
  test("maps risk snapshot to sorted rows and high-risk list", () => {
    const model = buildRiskPanelModel({
      riskTable: [
        { ticketId: "obs-02", riskScore: 25, riskBand: "medium", mergeStrategy: "speculative" },
        { ticketId: "obs-06", riskScore: 89, riskBand: "high", mergeStrategy: "sequential" },
      ],
      recommendedOrder: [{ ticketId: "obs-06" }, { ticketId: "obs-02" }],
    });

    expect(model.rows.map((row) => row.ticketId)).toEqual(["obs-06", "obs-02"]);
    expect(model.highRiskTickets).toEqual(["obs-06"]);
    expect(model.recommendedOrder).toEqual(["obs-06", "obs-02"]);
    expect(model.strategy).toBe("mixed");
  });

  test("builds deterministic landed/evicted/skipped trend timeline", () => {
    const timeline = buildRiskTimeline([
      {
        iteration: 3,
        ticketsLanded: [{ ticketId: "obs-06" }],
        ticketsEvicted: [{ ticketId: "obs-04", reason: "rebase conflict" }],
        ticketsSkipped: [],
      },
      {
        iteration: 2,
        ticketsLanded: [{ ticketId: "obs-03" }, { ticketId: "obs-01" }],
        ticketsEvicted: [],
        ticketsSkipped: [{ ticketId: "obs-02" }],
      },
    ]);

    expect(timeline).toEqual([
      {
        iteration: 3,
        landedCount: 1,
        evictedCount: 1,
        skippedCount: 0,
        evictedTickets: ["obs-04"],
      },
      {
        iteration: 2,
        landedCount: 2,
        evictedCount: 0,
        skippedCount: 1,
        evictedTickets: [],
      },
    ]);
  });
});
