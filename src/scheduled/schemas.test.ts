import { describe, expect, test } from "bun:test";
import { scheduledOutputSchemas } from "./schemas";

describe("scheduledOutputSchemas.test", () => {
  test("accepts trace matrix and anti-slop fields", () => {
    const parsed = scheduledOutputSchemas.test.parse({
      buildPassed: true,
      testsPassed: true,
      testsPassCount: 12,
      testsFailCount: 0,
      scenariosTotal: 2,
      scenariosCovered: 2,
      uncoveredScenarios: [],
      scenarioTrace: [
        {
          scenarioId: "scenario-a",
          mappedTests: ["src/foo.test.ts::scenario-a"],
          evidence: {
            given: "setup was seeded",
            when: "action executed",
            then: "expected behavior observed",
          },
        },
      ],
      traceCompleteness: true,
      assertionSignals: {
        totalAssertions: 8,
        filesWithAssertions: 2,
        weakTestsDetected: false,
      },
      antiSlopFlags: [],
      tddEvidence: "RED->GREEN->REFACTOR was followed",
      scenarioCoverageNotes: "All scenarios mapped to deterministic tests",
      failingSummary: null,
      testOutput: "bun test",
    });

    expect(parsed.traceCompleteness).toBe(true);
    expect(parsed.assertionSignals.totalAssertions).toBe(8);
    expect(parsed.scenarioTrace[0].scenarioId).toBe("scenario-a");
  });

  test("rejects payload missing scenarioTrace", () => {
    expect(() =>
      scheduledOutputSchemas.test.parse({
        buildPassed: true,
        testsPassed: true,
        testsPassCount: 1,
        testsFailCount: 0,
        scenariosTotal: 1,
        scenariosCovered: 1,
        uncoveredScenarios: [],
        traceCompleteness: true,
        assertionSignals: {
          totalAssertions: 1,
          filesWithAssertions: 1,
          weakTestsDetected: false,
        },
        antiSlopFlags: [],
        tddEvidence: "ok",
        scenarioCoverageNotes: "ok",
        failingSummary: null,
        testOutput: "ok",
      }),
    ).toThrow();
  });

  test("rejects negative assertion counts", () => {
    expect(() =>
      scheduledOutputSchemas.test.parse({
        buildPassed: true,
        testsPassed: true,
        testsPassCount: 1,
        testsFailCount: 0,
        scenariosTotal: 1,
        scenariosCovered: 1,
        uncoveredScenarios: [],
        scenarioTrace: [
          {
            scenarioId: "scenario-a",
            mappedTests: ["src/foo.test.ts::scenario-a"],
            evidence: {
              given: "g",
              when: "w",
              then: "t",
            },
          },
        ],
        traceCompleteness: true,
        assertionSignals: {
          totalAssertions: -1,
          filesWithAssertions: 1,
          weakTestsDetected: false,
        },
        antiSlopFlags: [],
        tddEvidence: "ok",
        scenarioCoverageNotes: "ok",
        failingSummary: null,
        testOutput: "ok",
      }),
    ).toThrow();
  });
});
