/**
 * Scheduled-work workflow toolkit — RFC-driven AI development engine.
 *
 * Provides:
 * - QualityPipeline: per-unit quality pipeline (research → implement → test → review)
 * - ScheduledWorkflow: orchestrator composing pipelines + merge queue
 * - AgenticMergeQueue: lands completed units onto main
 * - Monitor: TUI for observing workflow progress
 * - Scheduled work types and schemas
 */

// Components
export {
  QualityPipeline,
  ScheduledWorkflow,
  AgenticMergeQueue,
  mergeQueueResultSchema,
  Monitor,
  monitorOutputSchema,
} from "./components";

export type {
  QualityPipelineProps,
  QualityPipelineAgents,
  DepSummary,
  ScheduledWorkflowProps,
  ScheduledWorkflowAgents,
  AgenticMergeQueueProps,
  AgenticMergeQueueTicket,
  MergeQueueResult,
  MonitorOutput,
  MonitorProps,
} from "./components";

// Scheduled work types
export {
  DEFAULT_AGENTIX_POLICY_CONFIG,
  POLICY_CLASSES,
  POLICY_SEVERITIES,
  agentixPolicyConfigInputSchema,
  computeLayers,
  evaluatePolicyGates,
  getPolicyChecks,
  isPolicyClassEnabledForTier,
  loadAgentixPolicyConfig,
  policyIssueSchema,
  policyReviewOutputSchema,
  policySeveritySchema,
  validateDAG,
  SCHEDULED_TIERS,
  workPlanSchema,
  workUnitSchema,
  agentixConfigSchema,
} from "./scheduled";

export type {
  AgentixPolicyConfig,
  LoadedPolicyConfig,
  PolicyClass,
  PolicyClassConfig,
  PolicyGateDecision,
  PolicyGateEvaluation,
  PolicyReviewGateInput,
  PolicyReviewOutput,
  PolicySeverity,
  WorkPlan,
  WorkUnit,
  AgentixConfig,
  ScheduledTier,
} from "./scheduled";

// Schemas
export { scheduledOutputSchemas } from "./scheduled/schemas";
