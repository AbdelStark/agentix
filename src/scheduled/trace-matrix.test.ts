import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorkUnit } from "./types";
import {
  ANTI_SLOP_FLAGS,
  evaluateTraceMatrix,
  writeTraceMatrixArtifact,
  type TraceMatrixTestResult,
} from "./trace-matrix";

function mkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "trace-unit",
    name: "Trace Unit",
    rfcSections: ["§1"],
    description: "Trace behavior",
    deps: [],
    acceptance: ["Scenario coverage is complete"],
    boundedContext: "quality-gates",
    ubiquitousLanguage: ["scenario", "trace", "anti-slop"],
    domainInvariants: ["Each scenario maps to at least one test"],
    gherkinFeature: "Scenario traceability",
    gherkinRule: null,
    gherkinScenarios: [
      {
        id: "trace-happy",
        title: "happy path trace",
        given: ["an implementation exists"],
        when: ["tests are executed"],
        then: ["coverage evidence is reported"],
      },
      {
        id: "trace-edge",
        title: "edge trace",
        given: ["an edge condition exists"],
        when: ["tests validate the edge"],
        then: ["behavior remains correct"],
      },
    ],
    tier: "small",
    ...overrides,
  };
}

function mkTestResult(overrides: Partial<TraceMatrixTestResult> = {}): TraceMatrixTestResult {
  return {
    buildPassed: true,
    testsPassed: true,
    testsPassCount: 12,
    testsFailCount: 0,
    scenariosTotal: 2,
    scenariosCovered: 2,
    uncoveredScenarios: [],
    tddEvidence: "RED->GREEN->REFACTOR",
    scenarioCoverageNotes: "all scenarios mapped",
    failingSummary: null,
    testOutput: "bun test",
    scenarioTrace: [
      {
        scenarioId: "trace-happy",
        mappedTests: ["src/trace.test.ts::trace-happy"],
        evidence: {
          given: "fixture created",
          when: "command runs",
          then: "happy behavior observed",
        },
      },
      {
        scenarioId: "trace-edge",
        mappedTests: ["src/trace.test.ts::trace-edge"],
        evidence: {
          given: "edge fixture created",
          when: "edge command runs",
          then: "edge behavior observed",
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
    ...overrides,
  };
}

describe("evaluateTraceMatrix", () => {
  test("passes for complete trace with strong assertion signals", () => {
    const unit = mkUnit();
    const testResult = mkTestResult();
    const evaluation = evaluateTraceMatrix({
      unit,
      scenarioTrace: testResult.scenarioTrace,
      traceCompleteness: testResult.traceCompleteness,
      assertionSignals: testResult.assertionSignals,
      antiSlopFlags: testResult.antiSlopFlags,
      filesCreated: ["src/trace.ts", "src/trace.test.ts"],
      filesModified: [],
      testOutput: testResult.testOutput,
    });

    expect(evaluation.traceCompleteness).toBe(true);
    expect(evaluation.blockingAntiSlopFlags).toEqual([]);
  });

  test("flags incomplete trace when a scenario is unmapped", () => {
    const unit = mkUnit();
    const testResult = mkTestResult({
      scenarioTrace: [
        {
          scenarioId: "trace-happy",
          mappedTests: ["src/trace.test.ts::trace-happy"],
          evidence: {
            given: "fixture created",
            when: "command runs",
            then: "happy behavior observed",
          },
        },
      ],
      traceCompleteness: false,
    });
    const evaluation = evaluateTraceMatrix({
      unit,
      scenarioTrace: testResult.scenarioTrace,
      traceCompleteness: testResult.traceCompleteness,
      assertionSignals: testResult.assertionSignals,
      antiSlopFlags: testResult.antiSlopFlags,
      filesCreated: ["src/trace.ts", "src/trace.test.ts"],
      filesModified: [],
      testOutput: testResult.testOutput,
    });

    expect(evaluation.traceCompleteness).toBe(false);
    expect(evaluation.antiSlopFlags).toContain(ANTI_SLOP_FLAGS.SCENARIO_UNMAPPED);
    expect(evaluation.antiSlopFlags).toContain(ANTI_SLOP_FLAGS.TRACE_INCOMPLETE);
  });

  test("flags anti-slop patterns for weak or missing test evidence", () => {
    const unit = mkUnit();
    const testResult = mkTestResult({
      assertionSignals: {
        totalAssertions: 0,
        filesWithAssertions: 0,
        weakTestsDetected: true,
      },
      testOutput: "test.todo('TODO add assertions')",
    });
    const evaluation = evaluateTraceMatrix({
      unit,
      scenarioTrace: testResult.scenarioTrace,
      traceCompleteness: testResult.traceCompleteness,
      assertionSignals: testResult.assertionSignals,
      antiSlopFlags: testResult.antiSlopFlags,
      filesCreated: ["src/trace.ts"],
      filesModified: [],
      testOutput: testResult.testOutput,
    });

    expect(evaluation.blockingAntiSlopFlags).toContain(
      ANTI_SLOP_FLAGS.MISSING_TEST_FILE_CHANGES,
    );
    expect(evaluation.blockingAntiSlopFlags).toContain(
      ANTI_SLOP_FLAGS.ASSERTION_SIGNAL_WEAK,
    );
    expect(evaluation.blockingAntiSlopFlags).toContain(
      ANTI_SLOP_FLAGS.REPORTED_WEAK_TESTS,
    );
    expect(evaluation.blockingAntiSlopFlags).toContain(
      ANTI_SLOP_FLAGS.WEAK_TEST_PATTERN_DETECTED,
    );
  });
});

describe("writeTraceMatrixArtifact", () => {
  test("writes deterministic artifact content and is idempotent", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "agentix-trace-"));
    try {
      const unit = mkUnit();
      const testResult = mkTestResult();

      const first = writeTraceMatrixArtifact({
        repoRoot,
        unit,
        testResult,
        filesCreated: ["src/trace.ts", "src/trace.test.ts"],
        filesModified: [],
      });
      const firstContent = readFileSync(first.artifactAbsolutePath, "utf8");

      const second = writeTraceMatrixArtifact({
        repoRoot,
        unit,
        testResult,
        filesCreated: ["src/trace.ts", "src/trace.test.ts"],
        filesModified: [],
      });
      const secondContent = readFileSync(second.artifactAbsolutePath, "utf8");

      expect(first.artifactPath).toBe(
        ".agentix/generated/traces/trace-unit.json",
      );
      expect(second.artifactPath).toBe(first.artifactPath);
      expect(secondContent).toBe(firstContent);
      expect(first.artifact.traceCompleteness).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
