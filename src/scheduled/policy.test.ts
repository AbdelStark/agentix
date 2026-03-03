import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_AGENTIX_POLICY_CONFIG,
  evaluatePolicyGates,
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
        }),
        "utf8",
      );

      const loaded = loadAgentixPolicyConfig(repoRoot);
      expect(loaded.found).toBe(true);
      expect(loaded.warnings).toEqual([]);
      expect(loaded.config.classes.security.blockOn).toContain("medium");
      expect(loaded.config.classes.security.blockOn).toContain("critical");
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
});
