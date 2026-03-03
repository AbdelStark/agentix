import { describe, expect, test } from "bun:test";
import {
  buildMergeQueuePrompt,
  type AgenticMergeQueueTicket,
} from "./AgenticMergeQueue";

function mkTicket(
  overrides: Partial<AgenticMergeQueueTicket> & Pick<AgenticMergeQueueTicket, "ticketId">,
): AgenticMergeQueueTicket {
  return {
    ticketId: overrides.ticketId,
    ticketTitle: overrides.ticketTitle ?? overrides.ticketId,
    ticketCategory: overrides.ticketCategory ?? "medium",
    priority: overrides.priority ?? "medium",
    reportComplete: true,
    landed: false,
    filesModified: overrides.filesModified ?? [],
    filesCreated: overrides.filesCreated ?? [],
    worktreePath: overrides.worktreePath ?? `/tmp/workflow-wt-${overrides.ticketId}`,
    historicalEvictions: overrides.historicalEvictions ?? 0,
    dependencyProximity: overrides.dependencyProximity ?? 0,
  };
}

describe("buildMergeQueuePrompt", () => {
  test("includes deterministic risk metadata and recommended order in prompt context", () => {
    const tickets: AgenticMergeQueueTicket[] = [
      mkTicket({
        ticketId: "unit-high-risk",
        ticketCategory: "large",
        filesModified: ["src/shared.ts", "src/high-risk.ts"],
        historicalEvictions: 2,
        dependencyProximity: 2,
      }),
      mkTicket({
        ticketId: "unit-low-risk",
        ticketCategory: "trivial",
        filesModified: ["src/low.ts"],
      }),
      mkTicket({
        ticketId: "unit-medium-risk",
        ticketCategory: "medium",
        filesModified: ["src/shared.ts", "src/medium.ts"],
      }),
    ];

    const prompt = buildMergeQueuePrompt(
      tickets,
      "/repo",
      "main",
      [],
      ["bun run check"],
      4,
      "unit/",
    );

    expect(prompt).toContain("Deterministic Risk Model");
    expect(prompt).toContain("Risk Table");
    expect(prompt).toContain("Recommended Deterministic Order");
    expect(prompt).toContain("Speculative Batch Boundaries");
    expect(prompt).toContain("unit-low-risk");
    expect(prompt).toContain("unit-medium-risk");
    expect(prompt).toContain("unit-high-risk");
    expect(prompt).toContain("sequential");
  });

  test("is deterministic for identical inputs", () => {
    const tickets: AgenticMergeQueueTicket[] = [
      mkTicket({
        ticketId: "unit-b",
        ticketCategory: "small",
        filesModified: ["src/shared.ts", "src/b.ts"],
      }),
      mkTicket({
        ticketId: "unit-a",
        ticketCategory: "small",
        filesModified: ["src/shared.ts", "src/a.ts"],
      }),
    ];

    const first = buildMergeQueuePrompt(
      tickets,
      "/repo",
      "main",
      [],
      ["bun run check"],
      3,
      "unit/",
    );
    const second = buildMergeQueuePrompt(
      [...tickets].reverse(),
      "/repo",
      "main",
      [],
      ["bun run check"],
      3,
      "unit/",
    );

    expect(first).toBe(second);
    expect(first).not.toContain("Current Time");
  });
});
