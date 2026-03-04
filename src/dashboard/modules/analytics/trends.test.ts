import { describe, expect, test } from "bun:test";

import { buildAnalyticsSeries, summarizeFailureTaxonomy } from "./trends";

describe("analytics trends", () => {
  test("builds chronological success/failure/cancellation rate series", () => {
    const series = buildAnalyticsSeries([
      { date: "2026-03-02", started: 3, completed: 2, failed: 1, cancelled: 0 },
      { date: "2026-03-01", started: 2, completed: 1, failed: 1, cancelled: 0 },
    ]);

    expect(series.dates).toEqual(["2026-03-01", "2026-03-02"]);
    expect(series.successRate).toEqual([0.5, 0.6667]);
    expect(series.failureRate).toEqual([0.5, 0.3333]);
  });

  test("sorts failure taxonomy descending", () => {
    const list = summarizeFailureTaxonomy({
      infra: 3,
      environment: 1,
      config: 3,
    });

    expect(list).toEqual([
      { reason: "config", count: 3 },
      { reason: "infra", count: 3 },
      { reason: "environment", count: 1 },
    ]);
  });
});
