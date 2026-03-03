import { describe, expect, test } from "bun:test";
import type { SmithersCtx } from "smithers-orchestrator";
import type { WorkUnit } from "../../scheduled/types";
import type { ScheduledOutputs } from "../QualityPipeline";
import { evaluateTierCompletion } from "../ScheduledWorkflow";

function mkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "unit-a",
    name: "Unit A",
    rfcSections: ["§1"],
    description: "Trace gate behavior",
    deps: [],
    acceptance: ["All scenarios are covered"],
    boundedContext: "quality-gates",
    ubiquitousLanguage: ["scenario", "trace", "anti-slop"],
    domainInvariants: ["No scenario can remain unmapped"],
    gherkinFeature: "Trace gate",
    gherkinRule: null,
    gherkinScenarios: [
      {
        id: "scenario-a",
        title: "trace happy path",
        given: ["setup exists"],
        when: ["tests execute"],
        then: ["scenario is validated"],
      },
    ],
    tier: "trivial",
    ...overrides,
  };
}

function mkCtx(rows: Record<string, any>): SmithersCtx<ScheduledOutputs> {
  return {
    latest: (table: string, nodeId: string) => rows[`${table}:${nodeId}`],
  } as unknown as SmithersCtx<ScheduledOutputs>;
}

function mkTestOutput(overrides: Record<string, unknown> = {}) {
  return {
    buildPassed: true,
    testsPassed: true,
    testsPassCount: 5,
    testsFailCount: 0,
    scenariosTotal: 1,
    scenariosCovered: 1,
    uncoveredScenarios: [],
    scenarioTrace: [
      {
        scenarioId: "scenario-a",
        mappedTests: ["src/unit-a.test.ts::scenario-a"],
        evidence: {
          given: "fixture seeded",
          when: "command runs",
          then: "behavior confirmed",
        },
      },
    ],
    traceCompleteness: true,
    assertionSignals: {
      totalAssertions: 3,
      filesWithAssertions: 1,
      weakTestsDetected: false,
    },
    antiSlopFlags: [],
    tddEvidence: "RED->GREEN->REFACTOR",
    scenarioCoverageNotes: "scenario-a mapped",
    failingSummary: null,
    testOutput: "bun test",
    ...overrides,
  };
}

describe("evaluateTierCompletion trace gates", () => {
  test("passes when trace is complete and anti-slop flags are clean", () => {
    const unit = mkUnit();
    const ctx = mkCtx({
      "test:unit-a:test": mkTestOutput(),
      "implement:unit-a:implement": {
        filesCreated: ["src/unit-a.ts", "src/unit-a.test.ts"],
        filesModified: [],
      },
    });

    const result = evaluateTierCompletion(ctx, [unit], unit.id);
    expect(result.complete).toBe(true);
    expect(result.reason).toBe("ready");
  });

  test("blocks when trace is incomplete", () => {
    const unit = mkUnit();
    const ctx = mkCtx({
      "test:unit-a:test": mkTestOutput({
        scenarioTrace: [],
        traceCompleteness: false,
      }),
      "implement:unit-a:implement": {
        filesCreated: ["src/unit-a.ts", "src/unit-a.test.ts"],
        filesModified: [],
      },
    });

    const result = evaluateTierCompletion(ctx, [unit], unit.id);
    expect(result.complete).toBe(false);
    expect(result.reason).toContain("trace matrix");
  });

  test("blocks when anti-slop flags are present", () => {
    const unit = mkUnit();
    const ctx = mkCtx({
      "test:unit-a:test": mkTestOutput({
        antiSlopFlags: ["manual-anti-slop-flag"],
      }),
      "implement:unit-a:implement": {
        filesCreated: ["src/unit-a.ts", "src/unit-a.test.ts"],
        filesModified: [],
      },
    });

    const result = evaluateTierCompletion(ctx, [unit], unit.id);
    expect(result.complete).toBe(false);
    expect(result.reason).toContain("Anti-slop flags");
    expect(result.traceEvaluation?.blockingAntiSlopFlags).toContain(
      "manual-anti-slop-flag",
    );
  });
});
