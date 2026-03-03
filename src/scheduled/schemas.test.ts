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

  test("accepts merge queue output with deterministic risk snapshot", () => {
    const parsed = scheduledOutputSchemas.merge_queue.parse({
      riskSnapshot: {
        scoringVersion: "merge-risk-v1",
        recommendedOrder: [
          {
            rank: 1,
            ticketId: "unit-a",
            priority: "medium",
            riskScore: 22,
            riskBand: "low",
            mergeStrategy: "speculative",
            speculativeBatch: "batch-1",
          },
          {
            rank: 2,
            ticketId: "unit-b",
            priority: "medium",
            riskScore: 79,
            riskBand: "high",
            mergeStrategy: "sequential",
            speculativeBatch: null,
          },
        ],
        riskTable: [
          {
            ticketId: "unit-a",
            priority: "medium",
            ticketCategory: "small",
            overlapCount: 0,
            churnScore: 0,
            historicalEvictions: 0,
            dependencyProximity: 0,
            contributions: {
              baseRisk: 5,
              tierComplexity: 10,
              overlap: 0,
              churn: 0,
              historicalEvictions: 0,
              dependencyProximity: 0,
            },
            riskScore: 15,
            riskBand: "low",
            mergeStrategy: "speculative",
          },
          {
            ticketId: "unit-b",
            priority: "medium",
            ticketCategory: "large",
            overlapCount: 2,
            churnScore: 2,
            historicalEvictions: 1,
            dependencyProximity: 1,
            contributions: {
              baseRisk: 5,
              tierComplexity: 26,
              overlap: 28,
              churn: 8,
              historicalEvictions: 12,
              dependencyProximity: 7,
            },
            riskScore: 86,
            riskBand: "high",
            mergeStrategy: "sequential",
          },
        ],
        speculativeBatches: [["unit-a"]],
        sequentialTickets: ["unit-b"],
      },
      ticketsLanded: [
        {
          ticketId: "unit-a",
          mergeCommit: "abc123",
          summary: "Landed cleanly",
        },
      ],
      ticketsEvicted: [
        {
          ticketId: "unit-b",
          reason: "merge-conflict",
          details: "conflicted on src/shared.ts",
        },
      ],
      ticketsSkipped: [],
      summary: "1 landed, 1 evicted",
      nextActions: "Resolve unit-b conflict and retry",
    });

    expect(parsed.riskSnapshot.scoringVersion).toBe("merge-risk-v1");
    expect(parsed.riskSnapshot.recommendedOrder[0]?.ticketId).toBe("unit-a");
    expect(parsed.riskSnapshot.sequentialTickets).toEqual(["unit-b"]);
  });

  test("rejects merge queue output when risk snapshot is missing", () => {
    expect(() =>
      scheduledOutputSchemas.merge_queue.parse({
        ticketsLanded: [],
        ticketsEvicted: [],
        ticketsSkipped: [],
        summary: "none",
        nextActions: null,
      }),
    ).toThrow();
  });
});
