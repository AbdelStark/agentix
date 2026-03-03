import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_AGENTIX_POLICY_CONFIG,
  evaluatePolicyGates,
  evaluateTelemetryPolicyGates,
  isPolicyClassEnabledForTier,
  loadAgentixPolicyConfig,
  type AgentixPolicyConfig,
  type PolicyReviewOutput,
  type PolicySeverity,
} from "./policy";

function mkReview(overrides: Partial<PolicyReviewOutput> = {}): PolicyReviewOutput {
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

describe("loadAgentixPolicyConfig", () => {
  test("returns default config when policy file is missing", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "agentix-policy-missing-"));
    try {
      const loaded = loadAgentixPolicyConfig(repoRoot);
      expect(loaded.found).toBe(false);
      expect(loaded.config).toEqual(DEFAULT_AGENTIX_POLICY_CONFIG);
      expect(loaded.warnings).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("loads and validates repo policy config", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "agentix-policy-valid-"));
    try {
      writeFileSync(
        join(repoRoot, "agentix.policy.json"),
        JSON.stringify({
          schemaVersion: 1,
          classes: {
            security: {
              blockOn: ["medium", "high", "critical"],
            },
          },
          telemetry: {
            runNonZeroExitHardGate: {
              enabled: true,
              threshold: 2,
            },
          },
        }),
        "utf8",
      );

      const loaded = loadAgentixPolicyConfig(repoRoot);
      expect(loaded.found).toBe(true);
      expect(loaded.warnings).toEqual([]);
      expect(loaded.config.classes.security.blockOn).toContain("medium");
      expect(loaded.config.classes.security.blockOn).toContain("critical");
      expect(loaded.config.telemetry.runNonZeroExitHardGate.enabled).toBe(true);
      expect(loaded.config.telemetry.runNonZeroExitHardGate.threshold).toBe(2);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("falls back to defaults and reports warning on invalid config", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "agentix-policy-invalid-"));
    try {
      writeFileSync(
        join(repoRoot, "agentix.policy.json"),
        JSON.stringify({
          schemaVersion: 9,
          classes: {
            security: {
              blockOn: ["invalid-severity"],
            },
          },
        }),
        "utf8",
      );

      const loaded = loadAgentixPolicyConfig(repoRoot);
      expect(loaded.found).toBe(true);
      expect(loaded.config).toEqual(DEFAULT_AGENTIX_POLICY_CONFIG);
      expect(loaded.warnings.length).toBeGreaterThan(0);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("evaluatePolicyGates", () => {
  test("blocks medium tier on high severity even when review-fix claims resolution", () => {
    const gate = evaluatePolicyGates({
      tier: "medium",
      reviewFixResolved: true,
      securityReview: mkReview({ severity: "high", approved: false }),
      performanceReview: mkReview(),
    });

    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("security");
    expect(gate.reason).toContain("high");
  });

  test("blocks medium severity unless fixed or accepted with rationale", () => {
    const gate = evaluatePolicyGates({
      tier: "medium",
      reviewFixResolved: false,
      securityReview: mkReview({ severity: "medium", approved: false }),
      performanceReview: mkReview(),
    });

    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("security");
    expect(gate.reason).toContain("medium");
  });

  test("allows medium severity when explicitly accepted with rationale", () => {
    const gate = evaluatePolicyGates({
      tier: "medium",
      reviewFixResolved: false,
      securityReview: mkReview({
        severity: "medium",
        approved: true,
        acceptanceRationale: "Risk accepted for staged rollout with compensating controls.",
      }),
      performanceReview: mkReview(),
    });

    expect(gate.passed).toBe(true);
    expect(gate.reason).toBe("ready");
  });

  test("allows medium severity when remediated in review-fix", () => {
    const gate = evaluatePolicyGates({
      tier: "medium",
      reviewFixResolved: true,
      securityReview: mkReview({
        severity: "medium",
        approved: false,
        acceptanceRationale: null,
      }),
      performanceReview: mkReview(),
    });

    expect(gate.passed).toBe(true);
    expect(gate.reason).toBe("ready");
  });

  test("supports config overrides for tighter blocking thresholds", () => {
    const stricterBlockOn: PolicySeverity[] = [
      "low",
      "medium",
      "high",
      "critical",
    ];
    const custom: AgentixPolicyConfig = {
      ...DEFAULT_AGENTIX_POLICY_CONFIG,
      classes: {
        ...DEFAULT_AGENTIX_POLICY_CONFIG.classes,
        security: {
          ...DEFAULT_AGENTIX_POLICY_CONFIG.classes.security,
          blockOn: stricterBlockOn,
        },
      },
    };

    const gate = evaluatePolicyGates({
      tier: "medium",
      policyConfig: custom,
      reviewFixResolved: false,
      securityReview: mkReview({
        severity: "low",
        approved: true,
      }),
      performanceReview: mkReview(),
    });

    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("security");
    expect(gate.reason).toContain("low");
  });

  test("blocks when operational policy is enabled for tier and review is missing", () => {
    const custom: AgentixPolicyConfig = {
      ...DEFAULT_AGENTIX_POLICY_CONFIG,
      classes: {
        ...DEFAULT_AGENTIX_POLICY_CONFIG.classes,
        operational: {
          ...DEFAULT_AGENTIX_POLICY_CONFIG.classes.operational,
          enabled: true,
          enabledTiers: ["large"],
          blockOn: ["high", "critical"],
          blockUnlessResolvedOrAccepted: ["medium"],
        },
      },
    };

    const gate = evaluatePolicyGates({
      tier: "large",
      policyConfig: custom,
      reviewFixResolved: false,
      securityReview: mkReview(),
      performanceReview: mkReview(),
      operationalReview: null,
    });

    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("Missing operational policy review");
  });

  test("blocks when telemetry hard gate threshold is reached", () => {
    const custom: AgentixPolicyConfig = {
      ...DEFAULT_AGENTIX_POLICY_CONFIG,
      telemetry: {
        runNonZeroExitHardGate: {
          enabled: true,
          threshold: 1,
        },
      },
    };

    const gate = evaluatePolicyGates({
      tier: "medium",
      policyConfig: custom,
      reviewFixResolved: false,
      securityReview: mkReview(),
      performanceReview: mkReview(),
      runNonZeroExitCount: 1,
    });

    expect(gate.passed).toBe(false);
    expect(gate.reason).toContain("Operational telemetry hard gate blocked");
  });
});

describe("isPolicyClassEnabledForTier", () => {
  test("returns false for tiers below medium", () => {
    expect(
      isPolicyClassEnabledForTier(
        DEFAULT_AGENTIX_POLICY_CONFIG,
        "security",
        "small",
      ),
    ).toBe(false);
  });

  test("respects policy class enabled flag and tier mapping", () => {
    expect(
      isPolicyClassEnabledForTier(
        DEFAULT_AGENTIX_POLICY_CONFIG,
        "security",
        "medium",
      ),
    ).toBe(true);
    expect(
      isPolicyClassEnabledForTier(
        DEFAULT_AGENTIX_POLICY_CONFIG,
        "operational",
        "large",
      ),
    ).toBe(false);
  });
});

describe("evaluateTelemetryPolicyGates", () => {
  test("passes when hard gate is disabled", () => {
    const gate = evaluateTelemetryPolicyGates({
      policyConfig: DEFAULT_AGENTIX_POLICY_CONFIG,
      runNonZeroExitCount: 5,
    });

    expect(gate.enabled).toBe(false);
    expect(gate.passed).toBe(true);
  });

  test("blocks when run non-zero exit count meets configured threshold", () => {
    const config: AgentixPolicyConfig = {
      ...DEFAULT_AGENTIX_POLICY_CONFIG,
      telemetry: {
        runNonZeroExitHardGate: {
          enabled: true,
          threshold: 2,
        },
      },
    };

    const gate = evaluateTelemetryPolicyGates({
      policyConfig: config,
      runNonZeroExitCount: 2,
    });

    expect(gate.enabled).toBe(true);
    expect(gate.passed).toBe(false);
    expect(gate.blockedBy).toBe("run-non-zero-hard-gate");
    expect(gate.reason).toContain("run non-zero exits 2");
  });
});
