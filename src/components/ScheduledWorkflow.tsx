/**
 * ScheduledWorkflow — Main orchestrator for RFC-driven scheduled work.
 *
 * Composes QualityPipeline + AgenticMergeQueue inside a single Ralph loop
 * with dynamic dependency-based scheduling:
 *
 * 1. On each iteration, classify every unit: Done / NotReady / Active
 * 2. Run quality pipelines in parallel for all Active units
 * 3. Run merge queue for all freshly quality-complete units
 * 4. Repeat until all units are Done (landed) or maxPasses reached
 * 5. Emit completion report
 *
 * Units become Active only when ALL their deps are Done (landed on main).
 * This replaces the previous fixed-layer model with dynamic dep-based gating.
 */

import React from "react";
import { Ralph, Sequence, Parallel, Task } from "smithers-orchestrator";
import type { SmithersCtx, AgentLike } from "smithers-orchestrator";
import type { WorkUnit, WorkPlan } from "../scheduled/types";
import { QualityPipeline, type DepSummary, type QualityPipelineAgents, type ScheduledOutputs } from "./QualityPipeline";
import { AgenticMergeQueue, type AgenticMergeQueueTicket } from "./AgenticMergeQueue";
import {
  evaluateTraceMatrix,
  writeTraceMatrixArtifact,
  type TraceMatrixEvaluation,
  type TraceMatrixTestResult,
} from "../scheduled/trace-matrix";
import {
  DEFAULT_AGENTIX_POLICY_CONFIG,
  POLICY_CLASSES,
  evaluatePolicyGates,
  loadAgentixPolicyConfig,
  type AgentixPolicyConfig,
} from "../scheduled/policy";

// ── Types ────────────────────────────────────────────────────────────

export type ScheduledWorkflowAgents = QualityPipelineAgents & {
  mergeQueue: AgentLike | AgentLike[];
};

export type ScheduledWorkflowProps = {
  ctx: SmithersCtx<ScheduledOutputs>;
  outputs: ScheduledOutputs;
  workPlan: WorkPlan;
  repoRoot: string;
  maxConcurrency: number;
  maxPasses?: number;
  mainBranch?: string;
  agents: ScheduledWorkflowAgents;
  retries?: number;
};

// ── Unit States ─────────────────────────────────────────────────────

type UnitState = "done" | "not-ready" | "active";

type MergeQueueLandedEntry = {
  ticketId: string;
  mergeCommit: string | null;
  summary: string;
};

type MergeQueueEvictedEntry = {
  ticketId: string;
  reason: string;
  details: string;
};

type MergeQueueRow = {
  nodeId?: string;
  ticketsLanded: MergeQueueLandedEntry[];
  ticketsEvicted: MergeQueueEvictedEntry[];
  ticketsSkipped: Array<{ ticketId: string; reason: string }>;
  summary: string;
  nextActions?: string | null;
};

// ── Tier Completion ─────────────────────────────────────────────────

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeTraceTestResult(test: any): TraceMatrixTestResult {
  return {
    buildPassed: Boolean(test?.buildPassed),
    testsPassed: Boolean(test?.testsPassed),
    testsPassCount:
      typeof test?.testsPassCount === "number" ? test.testsPassCount : 0,
    testsFailCount:
      typeof test?.testsFailCount === "number" ? test.testsFailCount : 0,
    scenariosTotal:
      typeof test?.scenariosTotal === "number" ? test.scenariosTotal : 0,
    scenariosCovered:
      typeof test?.scenariosCovered === "number" ? test.scenariosCovered : 0,
    uncoveredScenarios: normalizeStringArray(test?.uncoveredScenarios),
    tddEvidence: typeof test?.tddEvidence === "string" ? test.tddEvidence : "",
    scenarioCoverageNotes:
      typeof test?.scenarioCoverageNotes === "string"
        ? test.scenarioCoverageNotes
        : "",
    failingSummary:
      typeof test?.failingSummary === "string" ? test.failingSummary : null,
    testOutput: typeof test?.testOutput === "string" ? test.testOutput : "",
    scenarioTrace: Array.isArray(test?.scenarioTrace) ? test.scenarioTrace : [],
    traceCompleteness:
      typeof test?.traceCompleteness === "boolean"
        ? test.traceCompleteness
        : false,
    assertionSignals: test?.assertionSignals ?? {
      totalAssertions: 0,
      filesWithAssertions: 0,
      weakTestsDetected: false,
    },
    antiSlopFlags: normalizeStringArray(test?.antiSlopFlags),
  };
}

export type TierGateEvaluation = {
  complete: boolean;
  reason: string;
  testResult: TraceMatrixTestResult | null;
  traceEvaluation: TraceMatrixEvaluation | null;
};

export type TierGateOptions = {
  policyConfig?: AgentixPolicyConfig;
};

export function evaluateTierCompletion(
  ctx: SmithersCtx<ScheduledOutputs>,
  units: WorkUnit[],
  unitId: string,
  options: TierGateOptions = {},
): TierGateEvaluation {
  const unit = units.find((u) => u.id === unitId);
  if (!unit) {
    return {
      complete: false,
      reason: `Missing work unit "${unitId}" in workflow plan`,
      testResult: null,
      traceEvaluation: null,
    };
  }

  const tier = unit?.tier ?? "large";
  const policyConfig = options.policyConfig ?? DEFAULT_AGENTIX_POLICY_CONFIG;

  // All tiers require tests to pass
  const test = ctx.latest("test", `${unitId}:test`);
  if (!test) {
    return {
      complete: false,
      reason: "Missing test output",
      testResult: null,
      traceEvaluation: null,
    };
  }

  const traceTestResult = normalizeTraceTestResult(test);

  if (!traceTestResult.testsPassed) {
    return {
      complete: false,
      reason: `Tests failing: ${traceTestResult.failingSummary ?? "unknown"}`,
      testResult: traceTestResult,
      traceEvaluation: null,
    };
  }
  if (
    traceTestResult.scenariosCovered < traceTestResult.scenariosTotal
  ) {
    return {
      complete: false,
      reason: `Scenario coverage incomplete: ${traceTestResult.scenariosCovered}/${traceTestResult.scenariosTotal}`,
      testResult: traceTestResult,
      traceEvaluation: null,
    };
  }
  if (traceTestResult.uncoveredScenarios.length > 0) {
    return {
      complete: false,
      reason: `Scenario coverage incomplete: ${traceTestResult.uncoveredScenarios.join(", ")}`,
      testResult: traceTestResult,
      traceEvaluation: null,
    };
  }

  const impl = ctx.latest("implement", `${unitId}:implement`);
  const traceEvaluation = evaluateTraceMatrix({
    unit,
    scenarioTrace: traceTestResult.scenarioTrace,
    traceCompleteness: traceTestResult.traceCompleteness,
    assertionSignals: traceTestResult.assertionSignals,
    antiSlopFlags: traceTestResult.antiSlopFlags,
    filesCreated: (impl?.filesCreated as string[] | null) ?? [],
    filesModified: (impl?.filesModified as string[] | null) ?? [],
    testOutput: traceTestResult.testOutput,
  });

  if (!traceEvaluation.traceCompleteness) {
    return {
      complete: false,
      reason: "Scenario trace matrix is incomplete",
      testResult: traceTestResult,
      traceEvaluation,
    };
  }

  if (traceEvaluation.blockingAntiSlopFlags.length > 0) {
    return {
      complete: false,
      reason: `Anti-slop flags blocking merge: ${traceEvaluation.blockingAntiSlopFlags.join(", ")}`,
      testResult: traceTestResult,
      traceEvaluation,
    };
  }

  // buildPassed is required unless a final_review explicitly overrides it
  // (handles pre-existing failures in unrelated packages)
  if (!traceTestResult.buildPassed) {
    const fr = ctx.latest("final_review", `${unitId}:final-review`);
    if (!fr?.readyToMoveOn) {
      return {
        complete: false,
        reason: "Build gate failed without final review override",
        testResult: traceTestResult,
        traceEvaluation,
      };
    }
  }

  const reviewFix = ctx.latest("review_fix", `${unitId}:review-fix`);
  const policyGate = evaluatePolicyGates({
    tier,
    policyConfig,
    reviewFixResolved: reviewFix?.allIssuesResolved ?? false,
    securityReview: ctx.latest("security_review", `${unitId}:security-review`),
    performanceReview: ctx.latest(
      "performance_review",
      `${unitId}:performance-review`,
    ),
    operationalReview: ctx.latest(
      "operational_review",
      `${unitId}:operational-review`,
    ),
  });
  if (!policyGate.passed) {
    return {
      complete: false,
      reason: policyGate.reason,
      testResult: traceTestResult,
      traceEvaluation,
    };
  }

  switch (tier) {
    case "trivial":
      return {
        complete: true,
        reason: "ready",
        testResult: traceTestResult,
        traceEvaluation,
      };
    case "small": {
      const cr = ctx.latest("code_review", `${unitId}:code-review`);
      const approved = cr?.approved ?? false;
      return {
        complete: approved,
        reason: approved ? "ready" : "Code review not approved",
        testResult: traceTestResult,
        traceEvaluation,
      };
    }
    case "medium": {
      const prd = ctx.latest("prd_review", `${unitId}:prd-review`);
      const cr = ctx.latest("code_review", `${unitId}:code-review`);
      if ((prd?.approved ?? false) && (cr?.approved ?? false)) {
        return {
          complete: true,
          reason: "ready",
          testResult: traceTestResult,
          traceEvaluation,
        };
      }
      const resolved = reviewFix?.allIssuesResolved ?? false;
      return {
        complete: resolved,
        reason: resolved
          ? "ready"
          : "PRD/code review not approved and review-fix unresolved",
        testResult: traceTestResult,
        traceEvaluation,
      };
    }
    case "large":
    default: {
      const fr = ctx.latest("final_review", `${unitId}:final-review`);
      const ready = fr?.readyToMoveOn ?? false;
      return {
        complete: ready,
        reason: ready ? "ready" : "Final review not ready to move on",
        testResult: traceTestResult,
        traceEvaluation,
      };
    }
  }
}

function tierComplete(
  ctx: SmithersCtx<ScheduledOutputs>,
  units: WorkUnit[],
  unitId: string,
  options: TierGateOptions = {},
): boolean {
  return evaluateTierCompletion(ctx, units, unitId, options).complete;
}

// ── Component ────────────────────────────────────────────────────────

export function ScheduledWorkflow({
  ctx,
  outputs,
  workPlan,
  repoRoot,
  maxConcurrency,
  maxPasses = 9,
  mainBranch = "main",
  agents,
  retries = 1,
}: ScheduledWorkflowProps) {
  const units = workPlan.units;
  const loadedPolicy = loadAgentixPolicyConfig(repoRoot);
  const policyConfig = loadedPolicy.config;
  const policyWarningCount = loadedPolicy.warnings.length;
  const policyStatusSummary =
    policyWarningCount > 0
      ? `Policy config loaded with ${policyWarningCount} warning(s).`
      : loadedPolicy.found
        ? "Policy config loaded successfully."
        : "Policy config not found; using safe defaults.";

  const getMergeQueueRows = (): MergeQueueRow[] => {
    const rows = ctx.outputs("merge_queue");
    if (!Array.isArray(rows)) return [];
    return rows.filter((row): row is MergeQueueRow => {
      return typeof row === "object" && row !== null;
    });
  };

  const getMergeQueueNodeRows = (): MergeQueueRow[] => {
    return getMergeQueueRows().filter((row) => row.nodeId === "merge-queue");
  };

  // ── Landing status ──────────────────────────────────────────────
  // Land status is read from merge queue outputs (single merge queue node).

  const unitLanded = (unitId: string): boolean => {
    const mq = ctx.latest("merge_queue", "merge-queue");
    if (!mq) return false;
    return mq.ticketsLanded?.some((entry) => entry.ticketId === unitId) ?? false;
  };

  // Check ALL merge queue outputs across iterations for landed status.
  // ctx.outputs(table) returns all rows; we filter by nodeId manually.
  const unitLandedAcrossIterations = (unitId: string): boolean => {
    const nodeRows = getMergeQueueNodeRows();
    if (nodeRows.length === 0) return unitLanded(unitId);
    return nodeRows.some(
      (mq) => mq.ticketsLanded?.some((entry) => entry.ticketId === unitId) ?? false,
    );
  };

  // Scan ALL merge queue outputs (not just ctx.latest) so that empty static
  // outputs from iterations with no tickets don't mask prior evictions.
  const unitEvicted = (unitId: string): boolean => {
    if (unitLandedAcrossIterations(unitId)) return false;
    return getMergeQueueNodeRows().some(
      (mq) => mq.ticketsEvicted?.some((entry) => entry.ticketId === unitId) ?? false,
    );
  };

  const getEvictionContext = (unitId: string): string | null => {
    if (unitLandedAcrossIterations(unitId)) return null;
    // Scan in reverse (most recent first) to get the latest eviction context
    const relevant = [...getMergeQueueNodeRows()].reverse();
    for (const mq of relevant) {
      const entry = mq.ticketsEvicted?.find((evicted) => evicted.ticketId === unitId);
      if (entry) return entry.details ?? null;
    }
    return null;
  };

  // ── Unit state derivation ───────────────────────────────────────

  const getUnitState = (unitId: string): UnitState => {
    // Done: landed on main
    if (unitLandedAcrossIterations(unitId)) return "done";

    // NotReady: at least one dep is not Done
    const unit = units.find((u) => u.id === unitId);
    const deps = unit?.deps ?? [];
    if (deps.length > 0 && !deps.every((depId) => unitLandedAcrossIterations(depId))) {
      return "not-ready";
    }

    // Active: deps satisfied (or none), not landed
    return "active";
  };

  // ── Pass tracking ──────────────────────────────────────────────

  const passTracker = ctx.latest("pass_tracker", "pass-tracker");
  const currentPass = passTracker?.totalIterations ?? 0;
  const allUnitsDone = units.every((u) => unitLandedAcrossIterations(u.id));
  const done = currentPass >= maxPasses || allUnitsDone;

  // ── Dependency summaries ───────────────────────────────────────

  function buildDepSummaries(unit: WorkUnit): DepSummary[] {
    return (unit.deps ?? [])
      .map((depId) => {
        const depImpl = ctx.latest("implement", `${depId}:implement`);
        if (!depImpl) return null;
        return {
          id: depId,
          whatWasDone: depImpl.whatWasDone ?? "",
          filesCreated: (depImpl.filesCreated as string[] | null) ?? [],
          filesModified: (depImpl.filesModified as string[] | null) ?? [],
        };
      })
      .filter(Boolean) as DepSummary[];
  }

  // ── Merge queue ticket builder ─────────────────────────────────

  function buildMergeTickets(): AgenticMergeQueueTicket[] {
    const tickets: AgenticMergeQueueTicket[] = [];

    for (const unit of units) {
      if (unitLandedAcrossIterations(unit.id)) continue;
      if (getUnitState(unit.id) !== "active") continue;

      const gate = evaluateTierCompletion(ctx, units, unit.id, { policyConfig });
      if (!gate.complete || !gate.testResult) continue;

      // If previously evicted, require fresh passing test output from this iteration.
      if (unitEvicted(unit.id)) {
        const freshTest = ctx.outputMaybe("test", {
          nodeId: `${unit.id}:test`,
          iteration: ctx.iteration,
        });
        if (!freshTest?.testsPassed) continue;

        const impl = ctx.latest("implement", `${unit.id}:implement`);
        const freshTrace = evaluateTraceMatrix({
          unit,
          scenarioTrace: freshTest.scenarioTrace,
          traceCompleteness: freshTest.traceCompleteness,
          assertionSignals: freshTest.assertionSignals,
          antiSlopFlags: freshTest.antiSlopFlags,
          filesCreated: (impl?.filesCreated as string[] | null) ?? [],
          filesModified: (impl?.filesModified as string[] | null) ?? [],
          testOutput: freshTest.testOutput,
        });
        if (!freshTrace.traceCompleteness) continue;
        if (freshTrace.blockingAntiSlopFlags.length > 0) continue;

        // buildPassed required unless final_review overrides (pre-existing failures)
        if (!freshTest?.buildPassed) {
          const fr = ctx.latest("final_review", `${unit.id}:final-review`);
          if (fr?.readyToMoveOn !== true) continue;
        }
      }

      const impl = ctx.latest("implement", `${unit.id}:implement`);
      const filesModified = (impl?.filesModified as string[] | null) ?? [];
      const filesCreated = (impl?.filesCreated as string[] | null) ?? [];

      // Deterministic trace artifact required for every merge-eligible unit.
      writeTraceMatrixArtifact({
        repoRoot,
        unit,
        testResult: gate.testResult,
        filesCreated,
        filesModified,
      });

      tickets.push({
        ticketId: unit.id,
        ticketTitle: unit.name,
        ticketCategory: unit.tier,
        priority: "medium" as const,
        reportComplete: true,
        landed: false,
        filesModified,
        filesCreated,
        worktreePath: `/tmp/workflow-wt-${unit.id}`,
      });
    }

    return tickets;
  }

  // ── Completion report data ─────────────────────────────────────

  const landedIds = units.filter((u) => unitLandedAcrossIterations(u.id)).map((u) => u.id);
  const failedUnits = units
    .filter((u) => !unitLandedAcrossIterations(u.id))
    .map((u) => {
      const state = getUnitState(u.id);
      const stages: Array<{
        key: keyof ScheduledOutputs;
        stage: string;
        nodeId: string;
      }> = [
        { key: "final_review", stage: "final-review", nodeId: `${u.id}:final-review` },
        { key: "review_fix", stage: "review-fix", nodeId: `${u.id}:review-fix` },
        {
          key: "performance_review",
          stage: "performance-review",
          nodeId: `${u.id}:performance-review`,
        },
        {
          key: "security_review",
          stage: "security-review",
          nodeId: `${u.id}:security-review`,
        },
        {
          key: "operational_review",
          stage: "operational-review",
          nodeId: `${u.id}:operational-review`,
        },
        { key: "code_review", stage: "code-review", nodeId: `${u.id}:code-review` },
        { key: "prd_review", stage: "prd-review", nodeId: `${u.id}:prd-review` },
        { key: "test", stage: "test", nodeId: `${u.id}:test` },
        { key: "implement", stage: "implement", nodeId: `${u.id}:implement` },
        { key: "plan", stage: "plan", nodeId: `${u.id}:plan` },
        { key: "research", stage: "research", nodeId: `${u.id}:research` },
      ];
      let lastStage = state === "not-ready" ? "blocked-by-deps" : "not-started";
      for (const stage of stages) {
        if (ctx.latest(stage.key, stage.nodeId)) {
          lastStage = stage.stage;
          break;
        }
      }
      let reason = state === "not-ready"
        ? `Blocked: dependencies not landed (${(units.find((x) => x.id === u.id)?.deps ?? []).filter((d) => !unitLandedAcrossIterations(d)).join(", ")})`
        : `Did not complete within ${maxPasses} passes`;
      const evCtx = getEvictionContext(u.id);
      if (evCtx) reason = `Evicted from merge queue: ${evCtx.slice(0, 200)}`;
      if (state === "active" && !evCtx) {
        const gate = evaluateTierCompletion(ctx, units, u.id, { policyConfig });
        if (!gate.complete) {
          reason = gate.reason;
        }
      }
      return { unitId: u.id, lastStage, reason };
    });

  // ── Render ─────────────────────────────────────────────────────

  const testCmd =
    Object.values(workPlan.repo.testCmds).join(" && ") || "none configured";

  const mergeTickets = buildMergeTickets();
  const policyWarningSteps =
    policyWarningCount > 0
      ? [
          `Policy config warnings detected (${policyWarningCount}). Review policy-status output in workflow DB.`,
          ...loadedPolicy.warnings.map((warning) => `policy-warning: ${warning}`),
        ]
      : [];

  return (
    <Sequence>
      <Task
        id="policy-status"
        output={outputs.policy_status}
        skipIf={!!ctx.latest("policy_status", "policy-status")}
      >
        {{
          configPath: loadedPolicy.configPath,
          configFound: loadedPolicy.found,
          warningCount: policyWarningCount,
          warnings: loadedPolicy.warnings,
          summary: policyStatusSummary,
          effectiveClasses: POLICY_CLASSES.map((policyClass) => ({
            policyClass,
            enabled: policyConfig.classes[policyClass].enabled,
            enabledTiers: policyConfig.classes[policyClass].enabledTiers,
            blockOn: policyConfig.classes[policyClass].blockOn,
            blockUnlessResolvedOrAccepted:
              policyConfig.classes[policyClass].blockUnlessResolvedOrAccepted,
          })),
        }}
      </Task>

      <Ralph
        until={done}
        maxIterations={maxPasses * units.length * 20}
        onMaxReached="return-last"
      >
        <Sequence>
          {/* Phase 1: Quality pipelines for all Active units */}
          <Parallel maxConcurrency={maxConcurrency}>
            {units.map((unit) => {
              const state = getUnitState(unit.id);

              // Done or NotReady → skip
              if (state !== "active") return null;

              // Active + already quality-complete → skip pipeline, enters merge queue
              if (
                tierComplete(ctx, units, unit.id, { policyConfig }) &&
                !unitEvicted(unit.id)
              ) {
                return null;
              }

              return (
                <QualityPipeline
                  key={unit.id}
                  unit={unit}
                  ctx={ctx}
                  outputs={outputs}
                  agents={agents}
                  workPlan={workPlan}
                  policyConfig={policyConfig}
                  depSummaries={buildDepSummaries(unit)}
                  evictionContext={getEvictionContext(unit.id)}
                  pass={currentPass}
                  maxPasses={maxPasses}
                  retries={retries}
                  branchPrefix="unit/"
                />
              );
            })}
          </Parallel>

          {/* Phase 2: Merge queue — land all quality-complete units */}
          <AgenticMergeQueue
            nodeId="merge-queue"
            branchPrefix="unit/"
            ctx={ctx}
            tickets={mergeTickets}
            agent={agents.mergeQueue}
            output={outputs.merge_queue}
            outputs={outputs}
            repoRoot={repoRoot}
            mainBranch={mainBranch}
            postLandChecks={[testCmd]}
            preLandChecks={[]}
          />

          {/* Pass tracker (compute task — no agent needed) */}
          <Task id="pass-tracker" output={outputs.pass_tracker}>
            {{
              totalIterations: currentPass + 1,
              unitsRun: units
                .filter((u) => getUnitState(u.id) === "active")
                .map((u) => u.id),
              unitsComplete: units
                .filter((u) => unitLandedAcrossIterations(u.id))
                .map((u) => u.id),
              summary: `Pass ${currentPass + 1} of ${maxPasses}. ${units.filter((u) => unitLandedAcrossIterations(u.id)).length}/${units.length} units landed on main. ${units.filter((u) => getUnitState(u.id) === "not-ready").length} units waiting on deps.`,
            }}
          </Task>
        </Sequence>
      </Ralph>

      {/* Completion report (compute task — no agent needed) */}
      <Task id="completion-report" output={outputs.completion_report}>
        {{
          totalUnits: units.length,
          unitsLanded: landedIds,
          unitsFailed: failedUnits,
          passesUsed: currentPass + 1,
          summary:
            landedIds.length === units.length
              ? `All ${units.length} units landed successfully in ${currentPass + 1} pass(es).`
              : `${landedIds.length}/${units.length} units landed. ${failedUnits.length} unit(s) failed after ${currentPass + 1} pass(es).`,
          nextSteps:
            failedUnits.length === 0
              ? policyWarningSteps
              : [
                  ...policyWarningSteps,
                  "Review failed units and their eviction/test context in .agentix/workflow.db",
                  "Consider running 'agentix run --resume' to retry failed units",
                  ...failedUnits.map(
                    (f) =>
                      `${f.unitId}: last reached ${f.lastStage} — ${f.reason}`,
                  ),
                ],
        }}
      </Task>
    </Sequence>
  );
}
