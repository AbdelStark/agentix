import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { WorkUnit } from "./types";

export type ScenarioTraceEvidence = {
  given: string;
  when: string;
  then: string;
};

export type ScenarioTraceEntry = {
  scenarioId: string;
  mappedTests: string[];
  evidence: ScenarioTraceEvidence;
};

export type AssertionSignals = {
  totalAssertions: number;
  filesWithAssertions: number;
  weakTestsDetected: boolean;
};

export type TraceMatrixTestResult = {
  buildPassed: boolean;
  testsPassed: boolean;
  testsPassCount: number;
  testsFailCount: number;
  scenariosTotal: number;
  scenariosCovered: number;
  uncoveredScenarios: string[];
  tddEvidence: string;
  scenarioCoverageNotes: string;
  failingSummary: string | null;
  testOutput: string;
  scenarioTrace: ScenarioTraceEntry[];
  traceCompleteness: boolean;
  assertionSignals: AssertionSignals;
  antiSlopFlags: string[];
};

export const ANTI_SLOP_FLAGS = {
  TRACE_INCOMPLETE: "trace-incomplete",
  TRACE_SCENARIO_COUNT_MISMATCH: "trace-scenario-count-mismatch",
  SCENARIO_UNMAPPED: "scenario-unmapped",
  REPORTED_TRACE_INCOMPLETE: "reported-trace-incomplete",
  REPORTED_WEAK_TESTS: "reported-weak-tests",
  MISSING_TEST_FILE_CHANGES: "missing-test-file-changes",
  ASSERTION_SIGNAL_WEAK: "assertion-signal-weak",
  WEAK_TEST_PATTERN_DETECTED: "weak-test-pattern-detected",
} as const;

const WEAK_TEST_PATTERNS: RegExp[] = [
  /\b(?:todo|tbd|placeholder|stub|wip)\b/i,
  /\b(?:test\.todo|it\.todo|describe\.todo|test\.skip|it\.skip)\b/i,
  /\b(?:0 assertions|no assertions|assertions?\s*:\s*0)\b/i,
  /\b(?:dummy test|example test)\b/i,
];

const TEST_FILE_RE =
  /(^|\/)__tests__\/|(^|\/)(test|tests)\/|(\.|-)(test|spec)\.[cm]?[jt]sx?$/i;
const DOC_FILE_RE = /\.(md|mdx|txt)$/i;

const DEFAULT_NON_BLOCKING_ANTI_SLOP_FLAGS = new Set<string>();

function uniqSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function toNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizeEvidence(value: unknown): ScenarioTraceEvidence {
  const raw = (value ?? {}) as Partial<ScenarioTraceEvidence>;
  return {
    given: typeof raw.given === "string" ? raw.given.trim() : "",
    when: typeof raw.when === "string" ? raw.when.trim() : "",
    then: typeof raw.then === "string" ? raw.then.trim() : "",
  };
}

function normalizeScenarioTrace(value: unknown): ScenarioTraceEntry[] {
  if (!Array.isArray(value)) return [];
  const merged = new Map<string, ScenarioTraceEntry>();

  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const raw = row as Partial<ScenarioTraceEntry>;
    const scenarioId = typeof raw.scenarioId === "string"
      ? raw.scenarioId.trim()
      : "";
    if (!scenarioId) continue;

    const mappedTests = uniqSorted(
      Array.isArray(raw.mappedTests) ? raw.mappedTests.filter((entry): entry is string => typeof entry === "string") : [],
    );
    const evidence = normalizeEvidence(raw.evidence);
    const prior = merged.get(scenarioId);

    if (!prior) {
      merged.set(scenarioId, {
        scenarioId,
        mappedTests,
        evidence,
      });
      continue;
    }

    merged.set(scenarioId, {
      scenarioId,
      mappedTests: uniqSorted([...prior.mappedTests, ...mappedTests]),
      evidence: {
        given: prior.evidence.given || evidence.given,
        when: prior.evidence.when || evidence.when,
        then: prior.evidence.then || evidence.then,
      },
    });
  }

  return [...merged.values()].sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
}

export function normalizeAssertionSignals(value: unknown): AssertionSignals {
  const raw = (value ?? {}) as Partial<AssertionSignals>;
  return {
    totalAssertions: toNonNegativeInt(raw.totalAssertions),
    filesWithAssertions: toNonNegativeInt(raw.filesWithAssertions),
    weakTestsDetected: Boolean(raw.weakTestsDetected),
  };
}

function looksLikeTestFile(filePath: string): boolean {
  return TEST_FILE_RE.test(filePath);
}

function looksLikeBehaviorChange(filePath: string): boolean {
  return !looksLikeTestFile(filePath) && !DOC_FILE_RE.test(filePath);
}

export function getBlockingAntiSlopFlags(
  antiSlopFlags: string[],
  nonBlockingAllowlist: string[] = [],
): string[] {
  const allowlist = new Set<string>([
    ...DEFAULT_NON_BLOCKING_ANTI_SLOP_FLAGS,
    ...nonBlockingAllowlist,
  ]);
  return uniqSorted(antiSlopFlags).filter((flag) => !allowlist.has(flag));
}

export type TraceMatrixEvaluation = {
  scenarioTrace: ScenarioTraceEntry[];
  traceCompleteness: boolean;
  assertionSignals: AssertionSignals;
  antiSlopFlags: string[];
  blockingAntiSlopFlags: string[];
};

export function evaluateTraceMatrix(params: {
  unit: Pick<WorkUnit, "gherkinScenarios">;
  scenarioTrace: unknown;
  traceCompleteness: boolean | null | undefined;
  assertionSignals: unknown;
  antiSlopFlags: string[] | null | undefined;
  filesCreated: string[] | null | undefined;
  filesModified: string[] | null | undefined;
  testOutput: string | null | undefined;
  nonBlockingAllowlist?: string[];
}): TraceMatrixEvaluation {
  const scenarioTrace = normalizeScenarioTrace(params.scenarioTrace);
  const assertionSignals = normalizeAssertionSignals(params.assertionSignals);
  const expectedScenarioIds = params.unit.gherkinScenarios
    .map((scenario) => scenario.id)
    .sort();
  const traceByScenario = new Map(
    scenarioTrace.map((entry) => [entry.scenarioId, entry]),
  );

  const antiSlopFlagSet = new Set<string>(
    (params.antiSlopFlags ?? []).map((flag) => flag.trim()).filter(Boolean),
  );

  if (scenarioTrace.length !== expectedScenarioIds.length) {
    antiSlopFlagSet.add(ANTI_SLOP_FLAGS.TRACE_SCENARIO_COUNT_MISMATCH);
  }

  const traceMissingScenario = expectedScenarioIds.some((scenarioId) => {
    const trace = traceByScenario.get(scenarioId);
    return !trace || trace.mappedTests.length === 0;
  });

  if (traceMissingScenario) {
    antiSlopFlagSet.add(ANTI_SLOP_FLAGS.SCENARIO_UNMAPPED);
  }

  const changedFiles = uniqSorted([
    ...(params.filesCreated ?? []),
    ...(params.filesModified ?? []),
  ]);

  const hasBehaviorChange = changedFiles.some((filePath) =>
    looksLikeBehaviorChange(filePath)
  );
  const hasTestFileChange = changedFiles.some((filePath) =>
    looksLikeTestFile(filePath)
  );

  if (hasBehaviorChange && !hasTestFileChange) {
    antiSlopFlagSet.add(ANTI_SLOP_FLAGS.MISSING_TEST_FILE_CHANGES);
  }

  if (
    assertionSignals.totalAssertions <= 0 ||
    assertionSignals.filesWithAssertions <= 0
  ) {
    antiSlopFlagSet.add(ANTI_SLOP_FLAGS.ASSERTION_SIGNAL_WEAK);
  }
  if (assertionSignals.weakTestsDetected) {
    antiSlopFlagSet.add(ANTI_SLOP_FLAGS.REPORTED_WEAK_TESTS);
  }

  const weakPatternInput = [
    params.testOutput ?? "",
    ...scenarioTrace.flatMap((entry) => entry.mappedTests),
    ...scenarioTrace.flatMap((entry) => Object.values(entry.evidence)),
  ]
    .join("\n")
    .trim();
  if (
    weakPatternInput &&
    WEAK_TEST_PATTERNS.some((pattern) => pattern.test(weakPatternInput))
  ) {
    antiSlopFlagSet.add(ANTI_SLOP_FLAGS.WEAK_TEST_PATTERN_DETECTED);
  }

  const computedTraceCompleteness = !traceMissingScenario;
  const traceCompleteness =
    params.traceCompleteness === false
      ? false
      : computedTraceCompleteness;
  if (params.traceCompleteness === false) {
    antiSlopFlagSet.add(ANTI_SLOP_FLAGS.REPORTED_TRACE_INCOMPLETE);
  }
  if (!traceCompleteness) {
    antiSlopFlagSet.add(ANTI_SLOP_FLAGS.TRACE_INCOMPLETE);
  }

  const antiSlopFlags = uniqSorted([...antiSlopFlagSet]);
  const blockingAntiSlopFlags = getBlockingAntiSlopFlags(
    antiSlopFlags,
    params.nonBlockingAllowlist ?? [],
  );

  return {
    scenarioTrace,
    traceCompleteness,
    assertionSignals,
    antiSlopFlags,
    blockingAntiSlopFlags,
  };
}

export type TraceMatrixArtifact = {
  schemaVersion: number;
  unitId: string;
  feature: string;
  traceCompleteness: boolean;
  antiSlopFlags: string[];
  blockingAntiSlopFlags: string[];
  assertionSignals: AssertionSignals;
  scenarioTrace: Array<{
    scenarioId: string;
    title: string;
    given: string[];
    when: string[];
    then: string[];
    mappedTests: string[];
    evidence: ScenarioTraceEvidence;
  }>;
  validation: {
    buildPassed: boolean;
    testsPassed: boolean;
    testsPassCount: number;
    testsFailCount: number;
    scenariosTotal: number;
    scenariosCovered: number;
    uncoveredScenarios: string[];
  };
  commandOutputs: {
    tddEvidence: string;
    scenarioCoverageNotes: string;
    failingSummary: string | null;
    testOutput: string;
  };
};

function buildTraceMatrixArtifact(params: {
  unit: Pick<WorkUnit, "id" | "gherkinFeature" | "gherkinScenarios">;
  testResult: TraceMatrixTestResult;
  evaluation: TraceMatrixEvaluation;
}): TraceMatrixArtifact {
  const traceByScenario = new Map(
    params.evaluation.scenarioTrace.map((entry) => [entry.scenarioId, entry]),
  );

  return {
    schemaVersion: 1,
    unitId: params.unit.id,
    feature: params.unit.gherkinFeature,
    traceCompleteness: params.evaluation.traceCompleteness,
    antiSlopFlags: params.evaluation.antiSlopFlags,
    blockingAntiSlopFlags: params.evaluation.blockingAntiSlopFlags,
    assertionSignals: params.evaluation.assertionSignals,
    scenarioTrace: params.unit.gherkinScenarios
      .map((scenario) => {
        const mapped = traceByScenario.get(scenario.id);
        return {
          scenarioId: scenario.id,
          title: scenario.title,
          given: scenario.given,
          when: scenario.when,
          then: scenario.then,
          mappedTests: mapped?.mappedTests ?? [],
          evidence: mapped?.evidence ?? {
            given: "",
            when: "",
            then: "",
          },
        };
      })
      .sort((a, b) => a.scenarioId.localeCompare(b.scenarioId)),
    validation: {
      buildPassed: Boolean(params.testResult.buildPassed),
      testsPassed: Boolean(params.testResult.testsPassed),
      testsPassCount: toNonNegativeInt(params.testResult.testsPassCount),
      testsFailCount: toNonNegativeInt(params.testResult.testsFailCount),
      scenariosTotal: toNonNegativeInt(params.testResult.scenariosTotal),
      scenariosCovered: toNonNegativeInt(params.testResult.scenariosCovered),
      uncoveredScenarios: uniqSorted(params.testResult.uncoveredScenarios ?? []),
    },
    commandOutputs: {
      tddEvidence: params.testResult.tddEvidence ?? "",
      scenarioCoverageNotes: params.testResult.scenarioCoverageNotes ?? "",
      failingSummary: params.testResult.failingSummary ?? null,
      testOutput: params.testResult.testOutput ?? "",
    },
  };
}

export function writeTraceMatrixArtifact(params: {
  repoRoot: string;
  unit: Pick<WorkUnit, "id" | "gherkinFeature" | "gherkinScenarios">;
  testResult: TraceMatrixTestResult;
  filesCreated: string[] | null | undefined;
  filesModified: string[] | null | undefined;
  nonBlockingAllowlist?: string[];
}): {
  artifactPath: string;
  artifactAbsolutePath: string;
  artifact: TraceMatrixArtifact;
  evaluation: TraceMatrixEvaluation;
} {
  const evaluation = evaluateTraceMatrix({
    unit: params.unit,
    scenarioTrace: params.testResult.scenarioTrace,
    traceCompleteness: params.testResult.traceCompleteness,
    assertionSignals: params.testResult.assertionSignals,
    antiSlopFlags: params.testResult.antiSlopFlags,
    filesCreated: params.filesCreated,
    filesModified: params.filesModified,
    testOutput: params.testResult.testOutput,
    nonBlockingAllowlist: params.nonBlockingAllowlist,
  });

  const artifact = buildTraceMatrixArtifact({
    unit: params.unit,
    testResult: params.testResult,
    evaluation,
  });

  const tracesDir = join(params.repoRoot, ".agentix", "generated", "traces");
  mkdirSync(tracesDir, { recursive: true });

  const artifactAbsolutePath = join(tracesDir, `${params.unit.id}.json`);
  const artifactPath = relative(params.repoRoot, artifactAbsolutePath).replace(
    /\\/g,
    "/",
  );
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;

  if (
    !existsSync(artifactAbsolutePath) ||
    readFileSync(artifactAbsolutePath, "utf8") !== serialized
  ) {
    writeFileSync(artifactAbsolutePath, serialized, "utf8");
  }

  return {
    artifactPath,
    artifactAbsolutePath,
    artifact,
    evaluation,
  };
}
