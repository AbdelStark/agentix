import React from "react";
import { Task, Sequence, Parallel, Worktree } from "smithers-orchestrator";
import type { SmithersCtx, AgentLike } from "smithers-orchestrator";
import { SCHEDULED_TIERS, type WorkUnit, type WorkPlan } from "../scheduled/types";
import { scheduledOutputSchemas } from "../scheduled/schemas";
import type { AgentixPolicyConfig, PolicyReviewOutput } from "../scheduled/policy";
import { getPolicyChecks, isPolicyClassEnabledForTier } from "../scheduled/policy";

import ResearchPrompt from "../prompts/Research.mdx";
import PlanPrompt from "../prompts/Plan.mdx";
import ImplementPrompt from "../prompts/Implement.mdx";
import TestPrompt from "../prompts/Test.mdx";
import PrdReviewPrompt from "../prompts/PrdReview.mdx";
import CodeReviewPrompt from "../prompts/CodeReview.mdx";
import SecurityReviewPrompt from "../prompts/SecurityReview.mdx";
import PerformanceReviewPrompt from "../prompts/PerformanceReview.mdx";
import OperationalReviewPrompt from "../prompts/OperationalReview.mdx";
import ReviewFixPrompt from "../prompts/ReviewFix.mdx";
import FinalReviewPrompt from "../prompts/FinalReview.mdx";

export type ScheduledOutputs = typeof scheduledOutputSchemas;

export type DepSummary = {
  id: string;
  whatWasDone: string;
  filesCreated: string[];
  filesModified: string[];
};

export type QualityPipelineAgents = {
  researcher: AgentLike | AgentLike[];
  planner: AgentLike | AgentLike[];
  implementer: AgentLike | AgentLike[];
  tester: AgentLike | AgentLike[];
  prdReviewer: AgentLike | AgentLike[];
  codeReviewer: AgentLike | AgentLike[];
  securityReviewer: AgentLike | AgentLike[];
  performanceReviewer: AgentLike | AgentLike[];
  operationalReviewer: AgentLike | AgentLike[];
  reviewFixer: AgentLike | AgentLike[];
  finalReviewer: AgentLike | AgentLike[];
};

export type QualityPipelineProps = {
  unit: WorkUnit;
  ctx: SmithersCtx<ScheduledOutputs>;
  outputs: ScheduledOutputs;
  agents: QualityPipelineAgents;
  workPlan: WorkPlan;
  policyConfig: AgentixPolicyConfig;
  depSummaries: DepSummary[];
  evictionContext: string | null;
  pass?: number;
  maxPasses?: number;
  retries?: number;
  branchPrefix?: string;
};

function tierHasStep(tier: string, step: string): boolean {
  const stages = SCHEDULED_TIERS[tier as keyof typeof SCHEDULED_TIERS];
  return stages
    ? (stages as readonly string[]).includes(step)
    : (SCHEDULED_TIERS.large as readonly string[]).includes(step);
}

function buildReviewFeedback(parts: Array<string | null | undefined>): string | undefined {
  const lines = parts
    .filter(Boolean)
    .map((p) => String(p).trim())
    .filter((p) => p.length > 0);
  return lines.length > 0 ? lines.join("\n\n") : undefined;
}

function buildIssueList(issues: unknown): string[] {
  if (!Array.isArray(issues)) return [];
  return issues.map((issue) => {
    const entry = issue as {
      severity?: string;
      description?: string;
      file?: string | null;
    };
    const sev = entry.severity ? `[${entry.severity}] ` : "";
    const desc = entry.description ?? "Unspecified issue";
    const file = entry.file ? ` (${entry.file})` : "";
    return `${sev}${desc}${file}`;
  });
}

function formatPolicyFeedback(
  label: string,
  review: Partial<PolicyReviewOutput> | null | undefined,
): string | null {
  if (!review) return null;
  const severity = typeof review.severity === "string" ? review.severity : "none";
  const approved = review.approved === true ? "approved" : "not approved";
  const actions = Array.isArray(review.remediationActions)
    ? review.remediationActions.filter((entry): entry is string => typeof entry === "string")
    : [];
  const evidence = Array.isArray(review.evidence)
    ? review.evidence.filter((entry): entry is string => typeof entry === "string")
    : [];
  const rationale =
    typeof review.acceptanceRationale === "string" && review.acceptanceRationale.trim().length > 0
      ? `Acceptance rationale: ${review.acceptanceRationale.trim()}`
      : null;
  const actionSummary =
    actions.length > 0 ? `Remediation actions:\n- ${actions.join("\n- ")}` : null;
  const evidenceSummary = evidence.length > 0 ? `Evidence:\n- ${evidence.join("\n- ")}` : null;

  return [
    `${label} review: severity=${severity}, ${approved}`,
    actionSummary,
    evidenceSummary,
    rationale,
  ]
    .filter(Boolean)
    .join("\n");
}

function isPolicyReviewResolvedForFixSkip(
  review: Partial<PolicyReviewOutput> | null | undefined,
): boolean {
  if (!review) return false;
  const severity = typeof review.severity === "string" ? review.severity : "none";
  if (severity === "high" || severity === "critical") return false;
  if (severity === "medium") {
    if (!review.approved) return false;
    return (
      typeof review.acceptanceRationale === "string" &&
      review.acceptanceRationale.trim().length > 0
    );
  }
  return Boolean(review.approved);
}

function buildTestSuites(workPlan: WorkPlan): Array<{ name: string; command: string; description: string }> {
  const suites: Array<{ name: string; command: string; description: string }> = [];

  for (const [name, command] of Object.entries(workPlan.repo.buildCmds)) {
    suites.push({ name: `Build: ${name}`, command, description: "Build or typecheck validation" });
  }
  for (const [name, command] of Object.entries(workPlan.repo.testCmds)) {
    suites.push({ name: `Test: ${name}`, command, description: "Automated test suite" });
  }

  return suites;
}

export function QualityPipeline({
  unit,
  ctx,
  outputs,
  agents,
  workPlan,
  policyConfig,
  depSummaries,
  evictionContext,
  pass = 0,
  maxPasses = 3,
  retries = 1,
  branchPrefix = "unit/",
}: QualityPipelineProps) {
  const uid = unit.id;
  const tier = unit.tier;

  // In Ralph loops, cross-stage reads must use latest() to see prior iterations.
  const research = ctx.latest("research", `${uid}:research`);
  const plan = ctx.latest("plan", `${uid}:plan`);
  const impl = ctx.latest("implement", `${uid}:implement`);
  const test = ctx.latest("test", `${uid}:test`);
  const prdReview = ctx.latest("prd_review", `${uid}:prd-review`);
  const codeReview = ctx.latest("code_review", `${uid}:code-review`);
  const securityReview = ctx.latest("security_review", `${uid}:security-review`);
  const performanceReview = ctx.latest(
    "performance_review",
    `${uid}:performance-review`,
  );
  const operationalReview = ctx.latest(
    "operational_review",
    `${uid}:operational-review`,
  );
  const reviewFix = ctx.latest("review_fix", `${uid}:review-fix`);
  const finalReview = ctx.latest("final_review", `${uid}:final-review`);

  const policyTier = tier;
  const runSecurityReview =
    tierHasStep(tier, "security-review") &&
    isPolicyClassEnabledForTier(policyConfig, "security", policyTier);
  const runPerformanceReview =
    tierHasStep(tier, "performance-review") &&
    isPolicyClassEnabledForTier(policyConfig, "performance", policyTier);
  const runOperationalReview =
    tierHasStep(tier, "operational-review") &&
    isPolicyClassEnabledForTier(policyConfig, "operational", policyTier);

  const combinedReviewFeedback = buildReviewFeedback([
    finalReview?.reasoning ? `Final review feedback:\n${finalReview.reasoning}` : null,
    prdReview?.feedback ? `PRD review feedback:\n${prdReview.feedback}` : null,
    codeReview?.feedback ? `Code review feedback:\n${codeReview.feedback}` : null,
    formatPolicyFeedback("Security", securityReview),
    formatPolicyFeedback("Performance", performanceReview),
    formatPolicyFeedback("Operational", operationalReview),
  ]);

  const securityChecks = getPolicyChecks(policyConfig, "security");
  const performanceChecks = getPolicyChecks(policyConfig, "performance");
  const operationalChecks = getPolicyChecks(policyConfig, "operational");

  const verifyCommands = [
    ...Object.values(workPlan.repo.buildCmds),
    ...Object.values(workPlan.repo.testCmds),
  ];

  const testSuites = buildTestSuites(workPlan);

  const bothApproved =
    (prdReview?.approved ?? !tierHasStep(tier, "prd-review")) &&
    (codeReview?.approved ?? false) &&
    (runSecurityReview
      ? isPolicyReviewResolvedForFixSkip(securityReview)
      : true) &&
    (runPerformanceReview
      ? isPolicyReviewResolvedForFixSkip(performanceReview)
      : true) &&
    (runOperationalReview
      ? isPolicyReviewResolvedForFixSkip(operationalReview)
      : true);

  return (
    <Worktree path={`/tmp/workflow-wt-${uid}`} branch={`${branchPrefix}${uid}`}>
      <Sequence>
        {tierHasStep(tier, "research") && (
          <Task
            id={`${uid}:research`}
            output={outputs.research}
            agent={agents.researcher}
            retries={retries}
            skipIf={!!research}
          >
            <ResearchPrompt
              unitId={uid}
              unitName={unit.name}
              unitDescription={unit.description}
              unitCategory={tier}
              boundedContext={unit.boundedContext}
              ubiquitousLanguage={unit.ubiquitousLanguage}
              domainInvariants={unit.domainInvariants}
              gherkinFeature={unit.gherkinFeature}
              gherkinScenarios={unit.gherkinScenarios}
              evictionContext={evictionContext}
              rfcSource={workPlan.source}
              rfcSections={unit.rfcSections}
              referencePaths={[workPlan.source]}
              referenceFiles={[]}
              relevantFiles={[]}
              contextFilePath={research?.contextFilePath ?? `docs/research/${uid}.md`}
              branchPrefix={branchPrefix}
            />
          </Task>
        )}

        {tierHasStep(tier, "plan") && (
          <Task
            id={`${uid}:plan`}
            output={outputs.plan}
            agent={agents.planner}
            retries={retries}
            skipIf={!!plan}
          >
            <PlanPrompt
              unitId={uid}
              unitName={unit.name}
              unitDescription={unit.description}
              unitCategory={tier}
              boundedContext={unit.boundedContext}
              ubiquitousLanguage={unit.ubiquitousLanguage}
              domainInvariants={unit.domainInvariants}
              gherkinFeature={unit.gherkinFeature}
              gherkinScenarios={unit.gherkinScenarios}
              acceptanceCriteria={unit.acceptance}
              contextFilePath={research?.contextFilePath ?? `docs/research/${uid}.md`}
              researchSummary={research?.findings?.join?.("\n") ?? null}
              evictionContext={evictionContext}
              tddPatterns={[]}
              planFilePath={plan?.planFilePath ?? `docs/plans/${uid}.md`}
              commitPrefix="📝"
              branchPrefix={branchPrefix}
            />
          </Task>
        )}

        <Task
          id={`${uid}:implement`}
          output={outputs.implement}
          agent={agents.implementer}
          retries={retries}
        >
          <ImplementPrompt
            unitId={uid}
            unitName={unit.name}
            unitCategory={tier}
            boundedContext={unit.boundedContext}
            ubiquitousLanguage={unit.ubiquitousLanguage}
            domainInvariants={unit.domainInvariants}
            gherkinFeature={unit.gherkinFeature}
            gherkinScenarios={unit.gherkinScenarios}
            planFilePath={plan?.planFilePath ?? `docs/plans/${uid}.md`}
            contextFilePath={research?.contextFilePath ?? `docs/research/${uid}.md`}
            implementationSteps={plan?.implementationSteps ?? []}
            previousImplementation={impl ?? null}
            evictionContext={evictionContext}
            reviewFeedback={combinedReviewFeedback}
            failingTests={test?.testsPassed ? null : (test?.failingSummary ?? null)}
            acceptanceCriteria={unit.acceptance}
            depSummaries={depSummaries}
            testWritingGuidance={[]}
            implementationGuidance={[]}
            formatterCommands={[]}
            verifyCommands={verifyCommands}
            architectureRules={[]}
            commitPrefix="feat"
            emojiPrefixes="feat, fix, refactor, chore, test, docs"
            branchPrefix={branchPrefix}
          />
        </Task>

        <Task
          id={`${uid}:test`}
          output={outputs.test}
          agent={agents.tester}
          retries={retries}
        >
          <TestPrompt
            unitId={uid}
            unitName={unit.name}
            unitCategory={tier}
            gherkinFeature={unit.gherkinFeature}
            gherkinScenarios={unit.gherkinScenarios}
            domainInvariants={unit.domainInvariants}
            whatWasDone={impl?.whatWasDone ?? "Unknown"}
            filesCreated={impl?.filesCreated ?? []}
            filesModified={impl?.filesModified ?? []}
            testSuites={testSuites}
            fixCommitPrefix="fix"
            branchPrefix={branchPrefix}
          />
        </Task>

        <Parallel>
          {tierHasStep(tier, "prd-review") && (
            <Task
              id={`${uid}:prd-review`}
              output={outputs.prd_review}
              agent={agents.prdReviewer}
              retries={retries}
              continueOnFail
            >
              <PrdReviewPrompt
                unitId={uid}
                unitName={unit.name}
                unitCategory={tier}
                acceptanceCriteria={unit.acceptance}
                boundedContext={unit.boundedContext}
                ubiquitousLanguage={unit.ubiquitousLanguage}
                domainInvariants={unit.domainInvariants}
                gherkinFeature={unit.gherkinFeature}
                gherkinScenarios={unit.gherkinScenarios}
                scenariosTotal={test?.scenariosTotal ?? unit.gherkinScenarios.length}
                scenariosCovered={test?.scenariosCovered ?? 0}
                uncoveredScenarios={test?.uncoveredScenarios ?? []}
                filesCreated={impl?.filesCreated ?? []}
                filesModified={impl?.filesModified ?? []}
                testResults={[
                  { name: "Build", status: test?.buildPassed ? "passed" : "failed" },
                  { name: "Tests", status: test?.testsPassed ? "passed" : "failed" },
                ]}
                failingSummary={test?.failingSummary ?? null}
                specChecks={[
                  {
                    name: "Acceptance criteria",
                    items: unit.acceptance,
                  },
                  {
                    name: "BDD executable specification",
                    items: unit.gherkinScenarios.map(
                      (scenario) =>
                        `${scenario.id}: ${scenario.title}`,
                    ),
                  },
                ]}
              />
            </Task>
          )}
          {tierHasStep(tier, "code-review") && (
            <Task
              id={`${uid}:code-review`}
              output={outputs.code_review}
              agent={agents.codeReviewer}
              retries={retries}
              continueOnFail
            >
              <CodeReviewPrompt
                unitId={uid}
                unitName={unit.name}
                unitCategory={tier}
                whatWasDone={impl?.whatWasDone ?? "Unknown"}
                filesCreated={impl?.filesCreated ?? []}
                filesModified={impl?.filesModified ?? []}
                qualityChecks={[
                  {
                    name: "Correctness and safety",
                    items: [
                      "No regressions in changed paths",
                      "Error handling covers new edge cases",
                      "No security issues introduced",
                    ],
                  },
                ]}
              />
            </Task>
          )}
          {runSecurityReview && (
            <Task
              id={`${uid}:security-review`}
              output={outputs.security_review}
              agent={agents.securityReviewer}
              retries={retries}
              continueOnFail
            >
              <SecurityReviewPrompt
                unitId={uid}
                unitName={unit.name}
                unitCategory={tier}
                boundedContext={unit.boundedContext}
                domainInvariants={unit.domainInvariants}
                whatWasDone={impl?.whatWasDone ?? "Unknown"}
                filesCreated={impl?.filesCreated ?? []}
                filesModified={impl?.filesModified ?? []}
                buildPassed={test?.buildPassed ?? false}
                testsPassed={test?.testsPassed ?? false}
                scenariosCovered={test?.scenariosCovered ?? 0}
                scenariosTotal={test?.scenariosTotal ?? unit.gherkinScenarios.length}
                policyChecks={securityChecks}
              />
            </Task>
          )}
          {runPerformanceReview && (
            <Task
              id={`${uid}:performance-review`}
              output={outputs.performance_review}
              agent={agents.performanceReviewer}
              retries={retries}
              continueOnFail
            >
              <PerformanceReviewPrompt
                unitId={uid}
                unitName={unit.name}
                unitCategory={tier}
                boundedContext={unit.boundedContext}
                domainInvariants={unit.domainInvariants}
                whatWasDone={impl?.whatWasDone ?? "Unknown"}
                filesCreated={impl?.filesCreated ?? []}
                filesModified={impl?.filesModified ?? []}
                buildPassed={test?.buildPassed ?? false}
                testsPassed={test?.testsPassed ?? false}
                scenariosCovered={test?.scenariosCovered ?? 0}
                scenariosTotal={test?.scenariosTotal ?? unit.gherkinScenarios.length}
                policyChecks={performanceChecks}
              />
            </Task>
          )}
          {runOperationalReview && (
            <Task
              id={`${uid}:operational-review`}
              output={outputs.operational_review}
              agent={agents.operationalReviewer}
              retries={retries}
              continueOnFail
            >
              <OperationalReviewPrompt
                unitId={uid}
                unitName={unit.name}
                unitCategory={tier}
                boundedContext={unit.boundedContext}
                domainInvariants={unit.domainInvariants}
                whatWasDone={impl?.whatWasDone ?? "Unknown"}
                filesCreated={impl?.filesCreated ?? []}
                filesModified={impl?.filesModified ?? []}
                buildPassed={test?.buildPassed ?? false}
                testsPassed={test?.testsPassed ?? false}
                scenariosCovered={test?.scenariosCovered ?? 0}
                scenariosTotal={test?.scenariosTotal ?? unit.gherkinScenarios.length}
                policyChecks={operationalChecks}
              />
            </Task>
          )}
        </Parallel>

        {tierHasStep(tier, "review-fix") && (
          <Task
            id={`${uid}:review-fix`}
            output={outputs.review_fix}
            agent={agents.reviewFixer}
            retries={retries}
            skipIf={bothApproved}
          >
            <ReviewFixPrompt
              unitId={uid}
              unitName={unit.name}
              unitCategory={tier}
              specSeverity={prdReview?.severity ?? "none"}
              specFeedback={prdReview?.feedback ?? ""}
              specIssues={buildIssueList(prdReview?.issues)}
              codeSeverity={codeReview?.severity ?? "none"}
              codeFeedback={codeReview?.feedback ?? ""}
              codeIssues={buildIssueList(codeReview?.issues)}
              securitySeverity={securityReview?.severity ?? "none"}
              securityIssues={buildIssueList(securityReview?.issues)}
              securityRemediationActions={securityReview?.remediationActions ?? []}
              securityAcceptanceRationale={securityReview?.acceptanceRationale ?? null}
              performanceSeverity={performanceReview?.severity ?? "none"}
              performanceIssues={buildIssueList(performanceReview?.issues)}
              performanceRemediationActions={performanceReview?.remediationActions ?? []}
              performanceAcceptanceRationale={performanceReview?.acceptanceRationale ?? null}
              operationalSeverity={operationalReview?.severity ?? "none"}
              operationalIssues={buildIssueList(operationalReview?.issues)}
              operationalRemediationActions={operationalReview?.remediationActions ?? []}
              operationalAcceptanceRationale={operationalReview?.acceptanceRationale ?? null}
              validationCommands={verifyCommands}
              commitPrefix="fix"
              emojiPrefixes="fix, refactor, test"
              branchPrefix={branchPrefix}
            />
          </Task>
        )}

        {tierHasStep(tier, "final-review") && (
          <Task
            id={`${uid}:final-review`}
            output={outputs.final_review}
            agent={agents.finalReviewer}
            retries={retries}
          >
            <FinalReviewPrompt
              unitId={uid}
              unitName={unit.name}
              description={unit.description}
              acceptanceCriteria={unit.acceptance}
              boundedContext={unit.boundedContext}
              domainInvariants={unit.domainInvariants}
              gherkinFeature={unit.gherkinFeature}
              gherkinScenarios={unit.gherkinScenarios}
              pass={pass + 1}
              maxPasses={maxPasses}
              implSummary={impl?.whatWasDone ?? null}
              believesComplete={impl?.believesComplete ?? false}
              buildPassed={test?.buildPassed ?? null}
              testsPassCount={test?.testsPassCount ?? 0}
              testsFailCount={test?.testsFailCount ?? 0}
              scenariosTotal={test?.scenariosTotal ?? unit.gherkinScenarios.length}
              scenariosCovered={test?.scenariosCovered ?? 0}
              uncoveredScenarios={test?.uncoveredScenarios ?? []}
              traceCompleteness={test?.traceCompleteness ?? false}
              antiSlopFlags={test?.antiSlopFlags ?? []}
              tddEvidence={test?.tddEvidence ?? null}
              failingSummary={test?.failingSummary ?? null}
              prdSeverity={prdReview?.severity ?? null}
              prdApproved={prdReview?.approved ?? null}
              codeSeverity={codeReview?.severity ?? null}
              codeApproved={codeReview?.approved ?? null}
              securitySeverity={securityReview?.severity ?? null}
              securityApproved={securityReview?.approved ?? null}
              securityAcceptanceRationale={securityReview?.acceptanceRationale ?? null}
              performanceSeverity={performanceReview?.severity ?? null}
              performanceApproved={performanceReview?.approved ?? null}
              performanceAcceptanceRationale={performanceReview?.acceptanceRationale ?? null}
              operationalSeverity={operationalReview?.severity ?? null}
              operationalApproved={operationalReview?.approved ?? null}
              operationalAcceptanceRationale={operationalReview?.acceptanceRationale ?? null}
              issuesResolved={reviewFix?.allIssuesResolved ?? null}
            />
          </Task>
        )}
      </Sequence>
    </Worktree>
  );
}
