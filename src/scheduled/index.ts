/**
 * Scheduled Work module — RFC-driven pre-planned workflow.
 */

export { scheduledOutputSchemas } from "./schemas";
export {
  type WorkPlan,
  type WorkUnit,
  type AgentixConfig,
  type ScheduledTier,
  workPlanSchema,
  workUnitSchema,
  agentixConfigSchema,
  SCHEDULED_TIERS,
  validateDAG,
  computeLayers,
} from "./types";
export { decomposeRFC, printPlanSummary } from "./decompose";
export {
  ANTI_SLOP_FLAGS,
  evaluateTraceMatrix,
  getBlockingAntiSlopFlags,
  normalizeAssertionSignals,
  writeTraceMatrixArtifact,
  type ScenarioTraceEvidence,
  type ScenarioTraceEntry,
  type AssertionSignals,
  type TraceMatrixTestResult,
  type TraceMatrixEvaluation,
  type TraceMatrixArtifact,
} from "./trace-matrix";
