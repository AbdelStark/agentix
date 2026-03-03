import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ScheduledTier } from "./types";

export const POLICY_CLASSES = [
  "security",
  "performance",
  "operational",
] as const;
export type PolicyClass = (typeof POLICY_CLASSES)[number];

export const POLICY_SEVERITIES = [
  "none",
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type PolicySeverity = (typeof POLICY_SEVERITIES)[number];

const policyTierSchema = z.enum(["medium", "large"]);
export const policySeveritySchema = z.enum(POLICY_SEVERITIES);
const policyIssueSeveritySchema = z.enum(["low", "medium", "high", "critical"]);

export const policyIssueSchema = z.object({
  severity: policyIssueSeveritySchema,
  description: z.string(),
  file: z.string().nullable(),
  recommendation: z.string().nullable(),
  check: z.string().nullable(),
});

export const policyReviewOutputSchema = z.object({
  approved: z.boolean(),
  severity: policySeveritySchema,
  issues: z.array(policyIssueSchema),
  remediationActions: z.array(z.string()),
  evidence: z.array(z.string()),
  acceptanceRationale: z.string().nullable(),
}).superRefine((value, ctx) => {
  if (
    value.severity === "medium" &&
    value.approved &&
    (!value.acceptanceRationale || value.acceptanceRationale.trim().length === 0)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["acceptanceRationale"],
      message:
        "acceptanceRationale is required when severity is medium and approved is true",
    });
  }
});

export type PolicyReviewOutput = z.infer<typeof policyReviewOutputSchema>;

export type PolicyClassConfig = {
  enabled: boolean;
  enabledTiers: Array<z.infer<typeof policyTierSchema>>;
  blockOn: PolicySeverity[];
  blockUnlessResolvedOrAccepted: PolicySeverity[];
  acceptanceRequiresRationale: boolean;
  checks: string[];
};

export type AgentixPolicyConfig = {
  schemaVersion: 1;
  classes: Record<PolicyClass, PolicyClassConfig>;
};

const DEFAULT_SECURITY_CHECKS = [
  "Authn/Authz boundaries are enforced and cannot be bypassed",
  "Input handling prevents injection in changed paths",
  "Secrets and credentials are never logged, hardcoded, or leaked",
  "Error responses do not leak internals or sensitive data",
];

const DEFAULT_PERFORMANCE_CHECKS = [
  "Algorithmic complexity does not regress hot paths",
  "I/O and query access patterns avoid N+1 and redundant work",
  "New synchronous work is not added to critical request/startup paths",
  "Caching/memoization invalidation remains bounded and correct",
];

const DEFAULT_OPERATIONAL_CHECKS = [
  "Failure handling keeps system behavior observable and recoverable",
  "Rollout/rollback path is documented for risky changes",
];

const DEFAULT_SECURITY_CONFIG: PolicyClassConfig = {
  enabled: true,
  enabledTiers: ["medium", "large"],
  blockOn: ["high", "critical"],
  blockUnlessResolvedOrAccepted: ["medium"],
  acceptanceRequiresRationale: true,
  checks: DEFAULT_SECURITY_CHECKS,
};

const DEFAULT_PERFORMANCE_CONFIG: PolicyClassConfig = {
  enabled: true,
  enabledTiers: ["medium", "large"],
  blockOn: ["high", "critical"],
  blockUnlessResolvedOrAccepted: ["medium"],
  acceptanceRequiresRationale: true,
  checks: DEFAULT_PERFORMANCE_CHECKS,
};

const DEFAULT_OPERATIONAL_CONFIG: PolicyClassConfig = {
  enabled: false,
  enabledTiers: ["large"],
  blockOn: ["critical"],
  blockUnlessResolvedOrAccepted: ["high"],
  acceptanceRequiresRationale: true,
  checks: DEFAULT_OPERATIONAL_CHECKS,
};

export const DEFAULT_AGENTIX_POLICY_CONFIG: AgentixPolicyConfig = {
  schemaVersion: 1,
  classes: {
    security: DEFAULT_SECURITY_CONFIG,
    performance: DEFAULT_PERFORMANCE_CONFIG,
    operational: DEFAULT_OPERATIONAL_CONFIG,
  },
};

const policyClassConfigInputSchema = z.object({
  enabled: z.boolean().optional(),
  enabledTiers: z.array(policyTierSchema).optional(),
  blockOn: z.array(policySeveritySchema).optional(),
  blockUnlessResolvedOrAccepted: z.array(policySeveritySchema).optional(),
  acceptanceRequiresRationale: z.boolean().optional(),
  checks: z.array(z.string()).optional(),
});

export const agentixPolicyConfigInputSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  classes: z
    .object({
      security: policyClassConfigInputSchema.optional(),
      performance: policyClassConfigInputSchema.optional(),
      operational: policyClassConfigInputSchema.optional(),
    })
    .optional(),
});

type PolicyConfigInput = z.infer<typeof agentixPolicyConfigInputSchema>;

function uniq<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function mergeClassConfig(
  base: PolicyClassConfig,
  input?: z.infer<typeof policyClassConfigInputSchema>,
): PolicyClassConfig {
  return {
    enabled: input?.enabled ?? base.enabled,
    enabledTiers: uniq(input?.enabledTiers ?? base.enabledTiers),
    blockOn: uniq((input?.blockOn ?? base.blockOn).filter((s) => s !== "none")),
    blockUnlessResolvedOrAccepted: uniq(
      (input?.blockUnlessResolvedOrAccepted ?? base.blockUnlessResolvedOrAccepted).filter(
        (s) => s !== "none",
      ),
    ),
    acceptanceRequiresRationale:
      input?.acceptanceRequiresRationale ?? base.acceptanceRequiresRationale,
    checks: uniq((input?.checks ?? base.checks).map((entry) => entry.trim()).filter(Boolean)),
  };
}

function normalizePolicyConfig(input: PolicyConfigInput): AgentixPolicyConfig {
  return {
    schemaVersion: 1,
    classes: {
      security: mergeClassConfig(
        DEFAULT_AGENTIX_POLICY_CONFIG.classes.security,
        input.classes?.security,
      ),
      performance: mergeClassConfig(
        DEFAULT_AGENTIX_POLICY_CONFIG.classes.performance,
        input.classes?.performance,
      ),
      operational: mergeClassConfig(
        DEFAULT_AGENTIX_POLICY_CONFIG.classes.operational,
        input.classes?.operational,
      ),
    },
  };
}

export type LoadedPolicyConfig = {
  config: AgentixPolicyConfig;
  configPath: string;
  found: boolean;
  warnings: string[];
};

export function loadAgentixPolicyConfig(repoRoot: string): LoadedPolicyConfig {
  const configPath = join(repoRoot, "agentix.policy.json");
  if (!existsSync(configPath)) {
    return {
      config: DEFAULT_AGENTIX_POLICY_CONFIG,
      configPath,
      found: false,
      warnings: [],
    };
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    return {
      config: DEFAULT_AGENTIX_POLICY_CONFIG,
      configPath,
      found: true,
      warnings: [
        `Failed to parse agentix.policy.json: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  const parsed = agentixPolicyConfigInputSchema.safeParse(parsedUnknown);
  if (!parsed.success) {
    return {
      config: DEFAULT_AGENTIX_POLICY_CONFIG,
      configPath,
      found: true,
      warnings: [parsed.error.message],
    };
  }

  return {
    config: normalizePolicyConfig(parsed.data),
    configPath,
    found: true,
    warnings: [],
  };
}

export type PolicyReviewGateInput = Partial<PolicyReviewOutput> | null | undefined;

export type PolicyGateDecision = {
  policyClass: PolicyClass;
  required: boolean;
  passed: boolean;
  reason: string;
  severity: PolicySeverity | null;
  blockedBy:
    | "none"
    | "missing-review"
    | "hard-severity"
    | "needs-resolution"
    | "not-approved";
  acceptedWithRationale: boolean;
  resolvedByReviewFix: boolean;
};

export type PolicyGateEvaluation = {
  passed: boolean;
  reason: string;
  decisions: PolicyGateDecision[];
  blockingDecisions: PolicyGateDecision[];
};

function normalizeSeverity(value: unknown): PolicySeverity {
  if (typeof value !== "string") return "none";
  return POLICY_SEVERITIES.includes(value as PolicySeverity)
    ? (value as PolicySeverity)
    : "none";
}

function rationaleProvided(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isPolicyTier(tier: ScheduledTier): tier is "medium" | "large" {
  return tier === "medium" || tier === "large";
}

export function evaluatePolicyGates(params: {
  tier: ScheduledTier;
  reviewFixResolved: boolean;
  securityReview: PolicyReviewGateInput;
  performanceReview: PolicyReviewGateInput;
  operationalReview?: PolicyReviewGateInput;
  policyConfig?: AgentixPolicyConfig;
}): PolicyGateEvaluation {
  const config = params.policyConfig ?? DEFAULT_AGENTIX_POLICY_CONFIG;

  if (!isPolicyTier(params.tier)) {
    return {
      passed: true,
      reason: "ready",
      decisions: [],
      blockingDecisions: [],
    };
  }

  const reviewsByClass: Record<PolicyClass, PolicyReviewGateInput> = {
    security: params.securityReview,
    performance: params.performanceReview,
    operational: params.operationalReview,
  };

  const decisions: PolicyGateDecision[] = [];

  for (const policyClass of POLICY_CLASSES) {
    const classConfig = config.classes[policyClass];
    if (!classConfig.enabled || !classConfig.enabledTiers.includes(params.tier)) {
      decisions.push({
        policyClass,
        required: false,
        passed: true,
        reason: "policy class not required for this tier",
        severity: null,
        blockedBy: "none",
        acceptedWithRationale: false,
        resolvedByReviewFix: false,
      });
      continue;
    }

    const review = reviewsByClass[policyClass];
    if (!review) {
      decisions.push({
        policyClass,
        required: true,
        passed: false,
        reason: `Missing ${policyClass} policy review output`,
        severity: null,
        blockedBy: "missing-review",
        acceptedWithRationale: false,
        resolvedByReviewFix: false,
      });
      continue;
    }

    const severity = normalizeSeverity(review.severity);
    const approved = Boolean(review.approved);
    const acceptedWithRationale =
      approved &&
      (!classConfig.acceptanceRequiresRationale ||
        rationaleProvided(review.acceptanceRationale));
    const hardBlock = classConfig.blockOn.includes(severity);
    const requiresResolution =
      classConfig.blockUnlessResolvedOrAccepted.includes(severity);

    if (hardBlock) {
      decisions.push({
        policyClass,
        required: true,
        passed: false,
        reason: `${policyClass} policy severity ${severity} blocks merge`,
        severity,
        blockedBy: "hard-severity",
        acceptedWithRationale,
        resolvedByReviewFix: false,
      });
      continue;
    }

    if (requiresResolution) {
      if (acceptedWithRationale) {
        decisions.push({
          policyClass,
          required: true,
          passed: true,
          reason: `${policyClass} policy severity ${severity} accepted with rationale`,
          severity,
          blockedBy: "none",
          acceptedWithRationale: true,
          resolvedByReviewFix: false,
        });
        continue;
      }
      if (params.reviewFixResolved) {
        decisions.push({
          policyClass,
          required: true,
          passed: true,
          reason: `${policyClass} policy severity ${severity} remediated in review-fix`,
          severity,
          blockedBy: "none",
          acceptedWithRationale: false,
          resolvedByReviewFix: true,
        });
        continue;
      }
      decisions.push({
        policyClass,
        required: true,
        passed: false,
        reason:
          `${policyClass} policy severity ${severity} requires remediation or explicit acceptance rationale`,
        severity,
        blockedBy: "needs-resolution",
        acceptedWithRationale: false,
        resolvedByReviewFix: false,
      });
      continue;
    }

    if (approved || params.reviewFixResolved) {
      decisions.push({
        policyClass,
        required: true,
        passed: true,
        reason: approved
          ? `${policyClass} policy review approved`
          : `${policyClass} policy review resolved in review-fix`,
        severity,
        blockedBy: "none",
        acceptedWithRationale,
        resolvedByReviewFix: !approved,
      });
      continue;
    }

    decisions.push({
      policyClass,
      required: true,
      passed: false,
      reason: `${policyClass} policy review not approved`,
      severity,
      blockedBy: "not-approved",
      acceptedWithRationale: false,
      resolvedByReviewFix: false,
    });
  }

  const blockingDecisions = decisions.filter((decision) => decision.required && !decision.passed);

  return {
    passed: blockingDecisions.length === 0,
    reason: blockingDecisions[0]?.reason ?? "ready",
    decisions,
    blockingDecisions,
  };
}

export function getPolicyChecks(
  config: AgentixPolicyConfig,
  policyClass: PolicyClass,
): string[] {
  return config.classes[policyClass].checks;
}
