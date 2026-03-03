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

function mkPolicyReview(overrides: Record<string, unknown> = {}) {
  return {
    approved: true,
    severity: "none",
    issues: [],
    remediationActions: [],
    evidence: [],
    acceptanceRationale: null,
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

  test("blocks medium tier when security review reports high severity", () => {
    const unit = mkUnit({ tier: "medium" });
    const ctx = mkCtx({
      "test:unit-a:test": mkTestOutput(),
      "implement:unit-a:implement": {
        filesCreated: ["src/unit-a.ts", "src/unit-a.test.ts"],
        filesModified: [],
      },
      "prd_review:unit-a:prd-review": {
        approved: true,
        severity: "none",
      },
      "code_review:unit-a:code-review": {
        approved: true,
        severity: "none",
      },
      "review_fix:unit-a:review-fix": {
        allIssuesResolved: true,
      },
      "security_review:unit-a:security-review": mkPolicyReview({
        approved: false,
        severity: "high",
      }),
      "performance_review:unit-a:performance-review": mkPolicyReview(),
    });

    const result = evaluateTierCompletion(ctx, [unit], unit.id);
    expect(result.complete).toBe(false);
    expect(result.reason).toContain("security");
    expect(result.reason).toContain("high");
  });

  test("allows medium tier when medium policy finding is accepted with rationale", () => {
    const unit = mkUnit({ tier: "medium" });
    const ctx = mkCtx({
      "test:unit-a:test": mkTestOutput(),
      "implement:unit-a:implement": {
        filesCreated: ["src/unit-a.ts", "src/unit-a.test.ts"],
        filesModified: [],
      },
      "prd_review:unit-a:prd-review": {
        approved: true,
        severity: "none",
      },
      "code_review:unit-a:code-review": {
        approved: true,
        severity: "none",
      },
      "security_review:unit-a:security-review": mkPolicyReview({
        approved: true,
        severity: "medium",
        acceptanceRationale:
          "Risk accepted with explicit compensating controls and monitoring.",
      }),
      "performance_review:unit-a:performance-review": mkPolicyReview(),
    });

    const result = evaluateTierCompletion(ctx, [unit], unit.id);
    expect(result.complete).toBe(true);
    expect(result.reason).toBe("ready");
  });

  test("allows medium tier when medium policy finding is remediated in review-fix", () => {
    const unit = mkUnit({ tier: "medium" });
    const ctx = mkCtx({
      "test:unit-a:test": mkTestOutput(),
      "implement:unit-a:implement": {
        filesCreated: ["src/unit-a.ts", "src/unit-a.test.ts"],
        filesModified: [],
      },
      "prd_review:unit-a:prd-review": {
        approved: false,
        severity: "major",
      },
      "code_review:unit-a:code-review": {
        approved: false,
        severity: "major",
      },
      "review_fix:unit-a:review-fix": {
        allIssuesResolved: true,
      },
      "security_review:unit-a:security-review": mkPolicyReview({
        approved: false,
        severity: "medium",
        acceptanceRationale: null,
      }),
      "performance_review:unit-a:performance-review": mkPolicyReview(),
    });

    const result = evaluateTierCompletion(ctx, [unit], unit.id);
    expect(result.complete).toBe(true);
    expect(result.reason).toBe("ready");
  });

  test("blocks large tier when performance review reports critical severity", () => {
    const unit = mkUnit({ tier: "large" });
    const ctx = mkCtx({
      "test:unit-a:test": mkTestOutput(),
      "implement:unit-a:implement": {
        filesCreated: ["src/unit-a.ts", "src/unit-a.test.ts"],
        filesModified: [],
      },
      "final_review:unit-a:final-review": {
        readyToMoveOn: true,
      },
      "review_fix:unit-a:review-fix": {
        allIssuesResolved: true,
      },
      "security_review:unit-a:security-review": mkPolicyReview(),
      "performance_review:unit-a:performance-review": mkPolicyReview({
        approved: false,
        severity: "critical",
      }),
    });

    const result = evaluateTierCompletion(ctx, [unit], unit.id);
    expect(result.complete).toBe(false);
    expect(result.reason).toContain("performance");
    expect(result.reason).toContain("critical");
  });
});
