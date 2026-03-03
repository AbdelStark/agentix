import React from "react";
import { Task } from "smithers-orchestrator";
import type { AgentLike } from "smithers-orchestrator";
import { z } from "zod";
import { buildMergeRiskPlan, type MergeRiskPlan } from "./merge-risk";

const mergeQueuePrioritySchema = z.enum(["critical", "high", "medium", "low"]);
const mergeRiskBandSchema = z.enum(["low", "medium", "high"]);
const mergeStrategySchema = z.enum(["speculative", "sequential"]);

const mergeRiskContributionsSchema = z.object({
  baseRisk: z.number().int().nonnegative(),
  tierComplexity: z.number().int().nonnegative(),
  overlap: z.number().int().nonnegative(),
  churn: z.number().int().nonnegative(),
  historicalEvictions: z.number().int().nonnegative(),
  dependencyProximity: z.number().int().nonnegative(),
});

const mergeQueueRiskTableEntrySchema = z.object({
  ticketId: z.string(),
  priority: mergeQueuePrioritySchema,
  ticketCategory: z.string(),
  overlapCount: z.number().int().nonnegative(),
  churnScore: z.number().int().nonnegative(),
  historicalEvictions: z.number().int().nonnegative(),
  dependencyProximity: z.number().int().nonnegative(),
  contributions: mergeRiskContributionsSchema,
  riskScore: z.number().int().min(0).max(100),
  riskBand: mergeRiskBandSchema,
  mergeStrategy: mergeStrategySchema,
});

const mergeQueueRiskOrderEntrySchema = z.object({
  rank: z.number().int().positive(),
  ticketId: z.string(),
  priority: mergeQueuePrioritySchema,
  riskScore: z.number().int().min(0).max(100),
  riskBand: mergeRiskBandSchema,
  mergeStrategy: mergeStrategySchema,
  speculativeBatch: z.string().nullable(),
});

export const mergeQueueRiskSnapshotSchema = z.object({
  scoringVersion: z.string(),
  recommendedOrder: z.array(mergeQueueRiskOrderEntrySchema),
  riskTable: z.array(mergeQueueRiskTableEntrySchema),
  speculativeBatches: z.array(z.array(z.string())),
  sequentialTickets: z.array(z.string()),
});

export const mergeQueueResultSchema = z.object({
  riskSnapshot: mergeQueueRiskSnapshotSchema,
  ticketsLanded: z.array(z.object({
    ticketId: z.string(),
    mergeCommit: z.string().nullable(),
    summary: z.string(),
  })),
  ticketsEvicted: z.array(z.object({
    ticketId: z.string(),
    reason: z.string(),
    details: z.string(),
  })),
  ticketsSkipped: z.array(z.object({
    ticketId: z.string(),
    reason: z.string(),
  })),
  summary: z.string(),
  nextActions: z.string().nullable(),
});

export type MergeQueueRiskSnapshot = z.infer<typeof mergeQueueRiskSnapshotSchema>;
export type MergeQueueResult = z.infer<typeof mergeQueueResultSchema>;

export type AgenticMergeQueueTicket = {
  ticketId: string;
  ticketTitle: string;
  ticketCategory: string;
  priority: z.infer<typeof mergeQueuePrioritySchema>;
  reportComplete: boolean;
  landed: boolean;
  filesModified: string[];
  filesCreated: string[];
  worktreePath: string;
  historicalEvictions?: number;
  dependencyProximity?: number;
};

export type AgenticMergeQueueProps = {
  ctx?: unknown;
  outputs?: unknown;
  tickets: AgenticMergeQueueTicket[];
  agent: AgentLike | AgentLike[];
  postLandChecks: string[];
  preLandChecks: string[];
  repoRoot: string;
  mainBranch?: string;
  maxSpeculativeDepth?: number;
  output: z.ZodObject<any>;
  /** Override the Task node ID (default: "agentic-merge-queue") */
  nodeId?: string;
  /** Branch prefix for unit branches (default: "ticket/") */
  branchPrefix?: string;
};

function normalizeFiles(ticket: AgenticMergeQueueTicket): string[] {
  return [...new Set([...(ticket.filesModified ?? []), ...(ticket.filesCreated ?? [])])].sort();
}

function toRiskPlanInput(ticket: AgenticMergeQueueTicket): AgenticMergeQueueTicket {
  return {
    ...ticket,
    filesModified: normalizeFiles(ticket),
    filesCreated: [],
    historicalEvictions: Math.max(0, Math.floor(ticket.historicalEvictions ?? 0)),
    dependencyProximity: Math.max(0, Math.floor(ticket.dependencyProximity ?? 0)),
  };
}

function toRiskSnapshot(plan: MergeRiskPlan): MergeQueueRiskSnapshot {
  return {
    scoringVersion: plan.scoringVersion,
    recommendedOrder: plan.recommendedOrder,
    riskTable: plan.riskTable,
    speculativeBatches: plan.speculativeBatches,
    sequentialTickets: plan.sequentialTickets,
  };
}

function buildQueueStatusTable(
  tickets: AgenticMergeQueueTicket[],
  plan: MergeRiskPlan,
): string {
  const ticketsById = new Map(tickets.map((ticket) => [ticket.ticketId, ticket]));
  const header = "| # | Ticket ID | Title | Tier | Priority | Risk | Strategy | Files Touched | Worktree |";
  const separator = "|---|-----------|-------|------|----------|------|----------|---------------|----------|";
  const rows = plan.recommendedOrder.map((entry, idx) => {
    const ticket = ticketsById.get(entry.ticketId);
    if (!ticket) return null;
    const files = normalizeFiles(ticket);
    const fileSummary = files.length > 0
      ? `${files.slice(0, 5).join(", ")}${files.length > 5 ? ` (+${files.length - 5} more)` : ""}`
      : "(none)";
    return `| ${idx + 1} | ${ticket.ticketId} | ${ticket.ticketTitle} | ${ticket.ticketCategory} | ${ticket.priority} | ${entry.riskScore} (${entry.riskBand}) | ${entry.mergeStrategy} | ${fileSummary} | ${ticket.worktreePath} |`;
  }).filter((row): row is string => row !== null);

  return [header, separator, ...rows].join("\n");
}

function buildFileOverlapAnalysis(tickets: AgenticMergeQueueTicket[]): string {
  const fileToTickets = new Map<string, Set<string>>();
  for (const ticket of tickets) {
    const files = normalizeFiles(ticket);
    for (const file of files) {
      const existing = fileToTickets.get(file) ?? new Set<string>();
      existing.add(ticket.ticketId);
      fileToTickets.set(file, existing);
    }
  }

  const conflicts = [...fileToTickets.entries()]
    .filter(([, ids]) => ids.size > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, ids]) => {
      const sortedIds = [...ids].sort((a, b) => a.localeCompare(b));
      return `- \`${file}\` touched by: ${sortedIds.join(", ")}`;
    });

  if (conflicts.length === 0) {
    return "No file overlaps detected across ready tickets.";
  }

  return [
    "**File overlaps detected** (prefer non-overlapping speculative batches first, then sequential conflict-heavy tickets):",
    ...conflicts,
  ].join("\n");
}

function buildRiskModelSummary(plan: MergeRiskPlan): string {
  const cfg = plan.config;
  return [
    `- Scoring version: \`${plan.scoringVersion}\``,
    "- Deterministic sort keys: `priority -> riskScore -> dependencyProximity -> ticketId`",
    `- Base risk: ${cfg.weights.baseRisk}`,
    `- Weights: overlap=${cfg.weights.overlapCount}, churn=${cfg.weights.churnScore}, evictions=${cfg.weights.historicalEvictions}, dependency=${cfg.weights.dependencyProximity}`,
    `- Tier complexity: trivial=${cfg.weights.tierComplexity.trivial}, small=${cfg.weights.tierComplexity.small}, medium=${cfg.weights.tierComplexity.medium}, large=${cfg.weights.tierComplexity.large}`,
    `- Band thresholds: medium>=${cfg.thresholds.medium}, high>=${cfg.thresholds.high}`,
    `- Sequential threshold: riskScore>=${cfg.thresholds.sequential}`,
    `- Max speculative batch size by band: low=${cfg.maxSpeculativeBatchSizeByBand.low}, medium=${cfg.maxSpeculativeBatchSizeByBand.medium}, high=${cfg.maxSpeculativeBatchSizeByBand.high}`,
  ].join("\n");
}

function buildRiskTable(plan: MergeRiskPlan): string {
  const header = "| Ticket | Overlap | Churn | Tier | Evictions | Dependency Proximity | Score | Band | Strategy |";
  const separator = "|--------|---------|-------|------|-----------|----------------------|-------|------|----------|";
  const rows = plan.riskTable.map((entry) => {
    return `| ${entry.ticketId} | ${entry.overlapCount} | ${entry.churnScore} | ${entry.ticketCategory} | ${entry.historicalEvictions} | ${entry.dependencyProximity} | ${entry.riskScore} | ${entry.riskBand} | ${entry.mergeStrategy} |`;
  });
  return [header, separator, ...rows].join("\n");
}

function buildRecommendedOrder(plan: MergeRiskPlan): string {
  return plan.recommendedOrder
    .map((entry) => {
      const batchPart = entry.speculativeBatch ? `, batch=${entry.speculativeBatch}` : "";
      return `${entry.rank}. \`${entry.ticketId}\` — priority=${entry.priority}, risk=${entry.riskScore} (${entry.riskBand}), strategy=${entry.mergeStrategy}${batchPart}`;
    })
    .join("\n");
}

function buildSpeculativeBatchBoundaries(plan: MergeRiskPlan): string {
  const lines: string[] = [];
  if (plan.speculativeBatches.length === 0) {
    lines.push("- No speculative batches recommended.");
  } else {
    for (let i = 0; i < plan.speculativeBatches.length; i += 1) {
      lines.push(`- batch-${i + 1}: ${plan.speculativeBatches[i].join(", ")}`);
    }
  }

  if (plan.sequentialTickets.length === 0) {
    lines.push("- No forced sequential tickets.");
  } else {
    lines.push(`- Sequential-only tickets: ${plan.sequentialTickets.join(", ")}`);
  }
  return lines.join("\n");
}

export function buildMergeQueuePrompt(
  tickets: AgenticMergeQueueTicket[],
  repoRoot: string,
  mainBranch: string,
  preLandChecks: string[],
  postLandChecks: string[],
  maxSpeculativeDepth: number,
  branchPrefix: string = "ticket/",
): string {
  const readyTickets = tickets
    .filter((ticket) => ticket.reportComplete && !ticket.landed)
    .map(toRiskPlanInput);
  const riskPlan = buildMergeRiskPlan(readyTickets, { maxSpeculativeDepth });
  const queueTable = buildQueueStatusTable(readyTickets, riskPlan);
  const overlapAnalysis = buildFileOverlapAnalysis(readyTickets);
  const riskModelSummary = buildRiskModelSummary(riskPlan);
  const riskTable = buildRiskTable(riskPlan);
  const recommendedOrder = buildRecommendedOrder(riskPlan);
  const batchBoundaries = buildSpeculativeBatchBoundaries(riskPlan);
  const riskSnapshot = toRiskSnapshot(riskPlan);
  const riskSnapshotJson = JSON.stringify(riskSnapshot, null, 2);

  const preLandCmds = preLandChecks.length > 0
    ? preLandChecks.map((cmd) => `  - \`${cmd}\``).join("\n")
    : "  - (none configured)";

  const postLandCmds = postLandChecks.length > 0
    ? postLandChecks.map((cmd) => `  - \`${cmd}\``).join("\n")
    : "  - (none configured)";

  return `# Merge Queue Coordinator

You are the **merge queue coordinator**. You run on the \`${mainBranch}\` branch directly (not in a worktree).
Your job is to land completed tickets onto \`${mainBranch}\` in deterministic priority + risk order.

## Repository
- Root: \`${repoRoot}\`
- Main branch: \`${mainBranch}\`
- Max speculative depth: ${maxSpeculativeDepth}

## Queue Status (${readyTickets.length} ticket(s) ready to land)

${queueTable}

## Deterministic Risk Model

${riskModelSummary}

## Risk Table

${riskTable}

## Recommended Deterministic Order

${recommendedOrder}

## Speculative Batch Boundaries

${batchBoundaries}

## File Overlap Analysis

${overlapAnalysis}

## Deterministic Risk Snapshot (copy exactly to output)

\`\`\`json
${riskSnapshotJson}
\`\`\`

## Instructions

Process tickets in the **exact recommended order** above.

1. Tickets with \`mergeStrategy=speculative\` may be processed speculatively within their batch boundary.
2. Tickets with \`mergeStrategy=sequential\` must be processed one-by-one and rebased right before landing.
3. Never reorder tickets unless a ticket is evicted; if eviction occurs, continue with remaining recommended order.

For each ticket:

1. **Pre-land checks** — Run these in the ticket's worktree before rebase:
${preLandCmds}

2. **Rebase onto ${mainBranch}** — Rebase ticket branch to latest \`${mainBranch}\`:
   \`\`\`
   jj rebase -b bookmark("${branchPrefix}{ticketId}") -d ${mainBranch}
   \`\`\`
   If conflicts occur, resolve only trivial conflicts (lockfiles, generated files). Otherwise evict with full conflict context.

3. **Post-land checks** — Validate merged result after rebase:
${postLandCmds}

4. **Fast-forward ${mainBranch}** — When checks pass:
   \`\`\`
   jj bookmark set ${mainBranch} -r bookmark("${branchPrefix}{ticketId}")
   \`\`\`

5. **Push** — Publish updated \`${mainBranch}\`:
   \`\`\`
   jj git push --bookmark ${mainBranch}
   \`\`\`

6. **Cleanup** — Remove ticket bookmark and close worktree:
   \`\`\`
   jj bookmark delete ${branchPrefix}{ticketId}
   jj workspace close {worktreeName}
   \`\`\`

## Failure Handling

- **Merge conflicts**: include conflicted files, conflicting change summary, and what landed on ${mainBranch} that caused divergence.
- **CI failures**: retry once for flaky signals; evict after second failure with full output.
- **Push failures**: fetch + rebase + retry up to 3 times, then evict.

## Output Format

Return JSON matching schema:
- \`riskSnapshot\`: copy the deterministic risk snapshot exactly as provided above.
- \`ticketsLanded\`: landed tickets with merge commit and short summary.
- \`ticketsEvicted\`: evicted tickets with reason and details.
- \`ticketsSkipped\`: skipped tickets with reason.
- \`summary\`: one paragraph summarizing this merge queue run.
- \`nextActions\`: follow-up actions needed, or null.`;
}

export function AgenticMergeQueue({
  tickets,
  agent,
  postLandChecks,
  preLandChecks,
  repoRoot,
  mainBranch = "main",
  maxSpeculativeDepth = 4,
  output,
  nodeId = "agentic-merge-queue",
  branchPrefix = "ticket/",
}: AgenticMergeQueueProps) {
  const readyTickets = tickets
    .filter((ticket) => ticket.reportComplete && !ticket.landed)
    .map(toRiskPlanInput);

  if (readyTickets.length === 0) {
    const emptyRiskPlan = buildMergeRiskPlan([], { maxSpeculativeDepth });
    return (
      <Task id={nodeId} output={output}>
        {{
          riskSnapshot: toRiskSnapshot(emptyRiskPlan),
          ticketsLanded: [],
          ticketsEvicted: [],
          ticketsSkipped: [],
          summary: "No tickets ready for merge queue this iteration.",
          nextActions: null,
        }}
      </Task>
    );
  }

  const prompt = buildMergeQueuePrompt(
    readyTickets,
    repoRoot,
    mainBranch,
    preLandChecks,
    postLandChecks,
    maxSpeculativeDepth,
    branchPrefix,
  );

  return (
    <Task
      id={nodeId}
      output={output}
      agent={agent}
      retries={2}
    >
      {prompt}
    </Task>
  );
}
