import { afterEach, describe, expect, test } from "bun:test";

import { runMonitor } from "../monitor-cmd";
import { runStatus } from "../status";
import {
  cleanupTempRepos,
  createExitStub,
  createMonitorLaunchStub,
  createTempRepo,
  expectEvent,
  expectProcessExit,
  readAgentixEvents,
  writeAgentixConfig,
  writeAgentixWorkPlan,
  writeGeneratedWorkflow,
  writeRfc,
  writeWorkflowDbWithRuns,
} from "./fixtures";

afterEach(async () => {
  await cleanupTempRepos();
});

describe("status and monitor command integration", () => {
  test("status reports uninitialized repository", async () => {
    const repoRoot = await createTempRepo();

    await runStatus({ repoRoot });

    const events = await readAgentixEvents(repoRoot);
    expectEvent(events, "command.started");
    const completed = expectEvent(events, "command.completed");
    expect(completed.command).toBe("status");
    expect(completed.details?.initialized).toBe(false);
  });

  test("status reports initialized repository with latest run metadata", async () => {
    const repoRoot = await createTempRepo();
    const rfcPath = await writeRfc(repoRoot);
    await writeAgentixConfig(repoRoot, { rfcPath });
    await writeAgentixWorkPlan(repoRoot);
    await writeGeneratedWorkflow(repoRoot);
    await writeWorkflowDbWithRuns(repoRoot, ["sw-status-a", "sw-status-b"]);

    await runStatus({
      repoRoot,
      deps: {
        getLatestRunId: async () => "sw-status-b",
      },
    });

    const events = await readAgentixEvents(repoRoot);
    const completed = expectEvent(events, "command.completed");
    expect(completed.command).toBe("status");
    expect(completed.runId).toBe("sw-status-b");
    expect(completed.details?.initialized).toBe(true);
    expect(completed.details?.unitCount).toBe(1);
    expect(completed.details?.workflowGenerated).toBe(true);
  });

  test("monitor fails when no config exists", async () => {
    const repoRoot = await createTempRepo();
    const exitStub = createExitStub();

    await expectProcessExit(
      runMonitor({
        flags: {},
        repoRoot,
        deps: {
          exit: exitStub.exit,
        },
      }),
      1,
    );

    const events = await readAgentixEvents(repoRoot);
    const failed = expectEvent(events, "command.failed");
    expect(failed.command).toBe("monitor");
    expect(failed.details?.reason).toBe("missing-config");
  });

  test("monitor fails when workflow DB is missing", async () => {
    const repoRoot = await createTempRepo();
    const rfcPath = await writeRfc(repoRoot);
    await writeAgentixConfig(repoRoot, { rfcPath });

    const exitStub = createExitStub();

    await expectProcessExit(
      runMonitor({
        flags: {},
        repoRoot,
        deps: {
          exit: exitStub.exit,
        },
      }),
      1,
    );

    const events = await readAgentixEvents(repoRoot);
    const failed = expectEvent(events, "command.failed");
    expect(failed.command).toBe("monitor");
    expect(failed.details?.reason).toBe("missing-workflow-db");
  });

  test("monitor fails when run ID cannot be determined", async () => {
    const repoRoot = await createTempRepo();
    const rfcPath = await writeRfc(repoRoot);
    await writeAgentixConfig(repoRoot, { rfcPath });
    await writeWorkflowDbWithRuns(repoRoot, []);

    const exitStub = createExitStub();

    await expectProcessExit(
      runMonitor({
        flags: {},
        repoRoot,
        deps: {
          exit: exitStub.exit,
          getLatestRunId: async () => null,
        },
      }),
      1,
    );

    const events = await readAgentixEvents(repoRoot);
    const failed = expectEvent(events, "command.failed");
    expect(failed.command).toBe("monitor");
    expect(failed.details?.reason).toBe("missing-run-id");
  });

  test("monitor launches standalone monitor for latest run", async () => {
    const repoRoot = await createTempRepo();
    const rfcPath = await writeRfc(repoRoot);
    await writeAgentixConfig(repoRoot, { rfcPath });
    await writeWorkflowDbWithRuns(repoRoot, ["sw-monitor"]);

    const monitorStub = createMonitorLaunchStub([0]);

    await runMonitor({
      flags: {},
      repoRoot,
      deps: {
        getLatestRunId: async () => "sw-monitor",
        launchMonitor: monitorStub.launchMonitor,
      },
    });

    expect(monitorStub.calls).toHaveLength(1);
    expect(monitorStub.calls[0]).toEqual(
      expect.objectContaining({
        runId: "sw-monitor",
        projectName: repoRoot.split("/").pop(),
      }),
    );

    const events = await readAgentixEvents(repoRoot);
    const completed = expectEvent(events, "command.completed");
    expect(completed.command).toBe("monitor");
    expect(completed.runId).toBe("sw-monitor");
  });
});
