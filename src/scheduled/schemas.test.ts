import { describe, expect, test } from "bun:test";
import { scheduledOutputSchemas } from "./schemas";

describe("scheduledOutputSchemas.test", () => {
  test("accepts trace matrix and anti-slop fields", () => {
    const parsed = scheduledOutputSchemas.test.parse({
      buildPassed: true,
      testsPassed: true,
      testsPassCount: 12,
      testsFailCount: 0,
      scenariosTotal: 2,
      scenariosCovered: 2,
      uncoveredScenarios: [],
      scenarioTrace: [
        {
          scenarioId: "scenario-a",
          mappedTests: ["src/foo.test.ts::scenario-a"],
          evidence: {
            given: "setup was seeded",
            when: "action executed",
            then: "expected behavior observed",
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
      tddEvidence: "RED->GREEN->REFACTOR was followed",
      scenarioCoverageNotes: "All scenarios mapped to deterministic tests",
      failingSummary: null,
      testOutput: "bun test",
    });

    expect(parsed.traceCompleteness).toBe(true);
    expect(parsed.assertionSignals.totalAssertions).toBe(8);
    expect(parsed.scenarioTrace[0].scenarioId).toBe("scenario-a");
  });

  test("rejects payload missing scenarioTrace", () => {
    expect(() =>
      scheduledOutputSchemas.test.parse({
        buildPassed: true,
        testsPassed: true,
        testsPassCount: 1,
        testsFailCount: 0,
        scenariosTotal: 1,
        scenariosCovered: 1,
        uncoveredScenarios: [],
        traceCompleteness: true,
        assertionSignals: {
          totalAssertions: 1,
          filesWithAssertions: 1,
          weakTestsDetected: false,
        },
        antiSlopFlags: [],
        tddEvidence: "ok",
        scenarioCoverageNotes: "ok",
        failingSummary: null,
        testOutput: "ok",
      }),
    ).toThrow();
  });

  test("rejects negative assertion counts", () => {
    expect(() =>
      scheduledOutputSchemas.test.parse({
        buildPassed: true,
        testsPassed: true,
        testsPassCount: 1,
        testsFailCount: 0,
        scenariosTotal: 1,
        scenariosCovered: 1,
        uncoveredScenarios: [],
        scenarioTrace: [
          {
            scenarioId: "scenario-a",
            mappedTests: ["src/foo.test.ts::scenario-a"],
            evidence: {
              given: "g",
              when: "w",
              then: "t",
            },
          },
        ],
        traceCompleteness: true,
        assertionSignals: {
          totalAssertions: -1,
          filesWithAssertions: 1,
          weakTestsDetected: false,
        },
        antiSlopFlags: [],
        tddEvidence: "ok",
        scenarioCoverageNotes: "ok",
        failingSummary: null,
        testOutput: "ok",
      }),
    ).toThrow();
  });

  test("accepts policy review payload with remediation evidence", () => {
    const parsed = scheduledOutputSchemas.security_review.parse({
      approved: true,
      severity: "medium",
      issues: [
        {
          severity: "medium",
          description: "Token validation fallback allows unsigned tokens",
          file: "src/auth/token.ts",
          recommendation: "Require signature verification for all token paths",
          check: "auth-boundary",
        },
      ],
      remediationActions: [
        "Enforced strict signature validation in token parser",
      ],
      evidence: [
        "Added regression tests for unsigned token rejection",
      ],
      acceptanceRationale:
        "Accepted temporarily with compensating control in API gateway until rollout completes.",
    });

    expect(parsed.severity).toBe("medium");
    expect(parsed.issues).toHaveLength(1);
  });

  test("accepts operational policy review payload", () => {
    const parsed = scheduledOutputSchemas.operational_review.parse({
      approved: false,
      severity: "high",
      issues: [
        {
          severity: "high",
          description: "No rollback path for migration and no failure containment",
          file: "src/migrations/user-index.ts",
          recommendation: "Add reversible migration and rollback runbook",
          check: "rollback-readiness",
        },
      ],
      remediationActions: [
        "Added reversible migration and rollback command",
      ],
      evidence: [
        "Documented rollback in docs/runbooks/migration.md",
      ],
      acceptanceRationale: null,
    });

    expect(parsed.severity).toBe("high");
    expect(parsed.issues[0]?.check).toBe("rollback-readiness");
  });

  test("rejects policy review payload missing required evidence fields", () => {
    expect(() =>
      scheduledOutputSchemas.performance_review.parse({
        approved: false,
        severity: "high",
        issues: [
          {
            severity: "high",
            description: "Hot path performs O(n^2) recomputation",
            file: "src/cache/hot-path.ts",
          },
        ],
      }),
    ).toThrow();
  });

  test("rejects medium severity approval without acceptance rationale", () => {
    expect(() =>
      scheduledOutputSchemas.security_review.parse({
        approved: true,
        severity: "medium",
        issues: [],
        remediationActions: [],
        evidence: ["manual risk acceptance noted"],
        acceptanceRationale: null,
      }),
    ).toThrow();
  });

  test("accepts structured policy status output", () => {
    const parsed = scheduledOutputSchemas.policy_status.parse({
      configPath: "/repo/agentix.policy.json",
      configFound: true,
      warningCount: 1,
      warnings: ["Invalid blockOn value for security policy class"],
      summary: "Policy config loaded with 1 warning(s).",
      effectiveClasses: [
        {
          policyClass: "security",
          enabled: true,
          enabledTiers: ["medium", "large"],
          blockOn: ["high", "critical"],
          blockUnlessResolvedOrAccepted: ["medium"],
        },
        {
          policyClass: "performance",
          enabled: true,
          enabledTiers: ["medium", "large"],
          blockOn: ["high", "critical"],
          blockUnlessResolvedOrAccepted: ["medium"],
        },
        {
          policyClass: "operational",
          enabled: false,
          enabledTiers: ["large"],
          blockOn: ["critical"],
          blockUnlessResolvedOrAccepted: ["high"],
        },
      ],
    });

    expect(parsed.warningCount).toBe(1);
    expect(parsed.effectiveClasses).toHaveLength(3);
  });
});
