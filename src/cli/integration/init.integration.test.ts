import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { initScheduledWork } from "../init-scheduled";
import type { AgentixConfig, WorkPlan } from "../../scheduled/types";
import {
  cleanupTempRepos,
  createAgentDetectionStub,
  createDecomposeStub,
  createExitStub,
  createTempRepo,
  expectEvent,
  expectProcessExit,
  readAgentixEvents,
  readAgentixJson,
  writeRfc,
} from "./fixtures";

afterEach(async () => {
  await cleanupTempRepos();
});

describe("init command integration", () => {
  test("writes config, work plan, generated workflow, and telemetry on happy path", async () => {
    const repoRoot = await createTempRepo();
    const rfcPath = await writeRfc(repoRoot, "docs/rfc.md");

    const decomposeStub = createDecomposeStub();
    const detectAgentsStub = createAgentDetectionStub({
      claude: true,
      codex: false,
      gh: true,
    });

    await initScheduledWork({
      positional: ["docs/rfc.md"],
      flags: {},
      repoRoot,
      deps: {
        ensureJjColocated: async () => {},
        detectAgents: detectAgentsStub.detectAgents,
        decomposeRFC: decomposeStub.decompose,
        detectCurrentBranch: async () => "main",
      },
    });

    expect(existsSync(join(repoRoot, ".agentix", "config.json"))).toBe(true);
    expect(existsSync(join(repoRoot, ".agentix", "work-plan.json"))).toBe(true);
    expect(
      existsSync(join(repoRoot, ".agentix", "generated", "workflow.tsx")),
    ).toBe(true);

    const config = await readAgentixJson<AgentixConfig>(repoRoot, "config.json");
    expect(config.mode).toBe("scheduled-work");
    expect(config.rfcPath).toBe(rfcPath);
    expect(config.baseBranch).toBe("main");
    expect(config.maxConcurrency).toBe(6);

    const plan = await readAgentixJson<WorkPlan>(repoRoot, "work-plan.json");
    expect(plan.source).toBe(rfcPath);
    expect(plan.units).toHaveLength(1);

    expect(decomposeStub.calls).toHaveLength(1);
    expect(detectAgentsStub.calls).toEqual([repoRoot]);

    const events = await readAgentixEvents(repoRoot);
    expectEvent(events, "command.started");
    const completed = expectEvent(events, "command.completed");
    expect(completed.command).toBe("init");
    expect(completed.details?.maxConcurrency).toBe(6);
  });

  test("fails with missing RFC path and emits command.failed telemetry", async () => {
    const repoRoot = await createTempRepo();
    const exitStub = createExitStub();

    await expectProcessExit(
      initScheduledWork({
        positional: [],
        flags: {},
        repoRoot,
        deps: {
          exit: exitStub.exit,
        },
      }),
      1,
    );

    expect(exitStub.calls).toEqual([1]);

    const events = await readAgentixEvents(repoRoot);
    const failed = expectEvent(events, "command.failed");
    expect(failed.command).toBe("init");
    expect(failed.details?.reason).toBe("missing-rfc-path");
  });

  test("fails when no supported agents are detected", async () => {
    const repoRoot = await createTempRepo();
    await writeRfc(repoRoot, "docs/rfc.md");

    const exitStub = createExitStub();
    const detectAgentsStub = createAgentDetectionStub({
      claude: false,
      codex: false,
      gh: false,
    });

    await expectProcessExit(
      initScheduledWork({
        positional: ["docs/rfc.md"],
        flags: {},
        repoRoot,
        deps: {
          ensureJjColocated: async () => {},
          detectAgents: detectAgentsStub.detectAgents,
          exit: exitStub.exit,
        },
      }),
      1,
    );

    const events = await readAgentixEvents(repoRoot);
    const failed = expectEvent(events, "command.failed");
    expect(failed.details?.reason).toBe("no-supported-agents");
    expect(failed.command).toBe("init");
  });
});
