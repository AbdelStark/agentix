import { afterEach, describe, expect, test } from "bun:test";

import { runWorkflow } from "../run";
import {
  cleanupTempRepos,
  createExitStub,
  createLaunchStub,
  createPromptStub,
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

describe("run command integration", () => {
  test("starts a fresh run after confirmation", async () => {
    const repoRoot = await createTempRepo();
    const rfcPath = await writeRfc(repoRoot);
    await writeAgentixConfig(repoRoot, { rfcPath, maxConcurrency: 4 });
    await writeAgentixWorkPlan(repoRoot);
    await writeGeneratedWorkflow(repoRoot);

    const promptStub = createPromptStub([0]);
    const launchStub = createLaunchStub([0]);

    await runWorkflow({
      flags: {},
      repoRoot,
      deps: {
        findSmithersCliPath: () => "/tmp/fake-smithers.ts",
        promptChoice: promptStub.prompt,
        launchSmithers: launchStub.launch,
        createRunId: () => "sw-fixed-run",
      },
    });

    expect(promptStub.calls).toHaveLength(1);
    expect(launchStub.calls).toHaveLength(1);
    expect(launchStub.calls[0]).toEqual(
      expect.objectContaining({
        mode: "run",
        runId: "sw-fixed-run",
        maxConcurrency: 4,
      }),
    );

    const events = await readAgentixEvents(repoRoot);
    expectEvent(events, "command.started");
    const completed = expectEvent(events, "command.completed");
    expect(completed.command).toBe("run");
    expect(completed.runId).toBe("sw-fixed-run");
    expect(completed.details?.mode).toBe("run");
  });

  test("cancels before execution when confirmation is declined", async () => {
    const repoRoot = await createTempRepo();
    const rfcPath = await writeRfc(repoRoot);
    await writeAgentixConfig(repoRoot, { rfcPath });
    await writeAgentixWorkPlan(repoRoot);
    await writeGeneratedWorkflow(repoRoot);

    const promptStub = createPromptStub([1]);
    const launchStub = createLaunchStub([0]);
    const exitStub = createExitStub();

    await expectProcessExit(
      runWorkflow({
        flags: {},
        repoRoot,
        deps: {
          findSmithersCliPath: () => "/tmp/fake-smithers.ts",
          promptChoice: promptStub.prompt,
          launchSmithers: launchStub.launch,
          createRunId: () => "sw-cancelled",
          exit: exitStub.exit,
        },
      }),
      0,
    );

    expect(launchStub.calls).toHaveLength(0);

    const events = await readAgentixEvents(repoRoot);
    const cancelled = expectEvent(events, "command.cancelled");
    expect(cancelled.command).toBe("run");
    expect(cancelled.details?.reason).toBe("user-cancelled-pre-run-confirmation");
  });

  test("resumes explicitly with --resume", async () => {
    const repoRoot = await createTempRepo();
    const rfcPath = await writeRfc(repoRoot);
    await writeAgentixConfig(repoRoot, { rfcPath, maxConcurrency: 3 });
    await writeAgentixWorkPlan(repoRoot);
    await writeGeneratedWorkflow(repoRoot);
    await writeWorkflowDbWithRuns(repoRoot, ["sw-existing"]);

    const launchStub = createLaunchStub([0]);

    await runWorkflow({
      flags: { resume: "sw-existing" },
      repoRoot,
      deps: {
        findSmithersCliPath: () => "/tmp/fake-smithers.ts",
        launchSmithers: launchStub.launch,
      },
    });

    expect(launchStub.calls).toHaveLength(1);
    expect(launchStub.calls[0]).toEqual(
      expect.objectContaining({
        mode: "resume",
        runId: "sw-existing",
        maxConcurrency: 3,
      }),
    );

    const events = await readAgentixEvents(repoRoot);
    const completed = expectEvent(events, "command.completed");
    expect(completed.command).toBe("run");
    expect(completed.runId).toBe("sw-existing");
    expect(completed.details?.mode).toBe("resume");
  });

  test("fails resume when workflow DB is missing", async () => {
    const repoRoot = await createTempRepo();
    const rfcPath = await writeRfc(repoRoot);
    await writeAgentixConfig(repoRoot, { rfcPath });
    await writeAgentixWorkPlan(repoRoot);
    await writeGeneratedWorkflow(repoRoot);

    const exitStub = createExitStub();

    await expectProcessExit(
      runWorkflow({
        flags: { resume: "sw-missing" },
        repoRoot,
        deps: {
          findSmithersCliPath: () => "/tmp/fake-smithers.ts",
          exit: exitStub.exit,
        },
      }),
      1,
    );

    const events = await readAgentixEvents(repoRoot);
    const failed = expectEvent(events, "command.failed");
    expect(failed.command).toBe("run");
    expect(failed.details?.reason).toBe("missing-db-for-resume");
    expect(failed.details?.resumeRunId).toBe("sw-missing");
  });

  test("exits with non-zero code when launcher fails", async () => {
    const repoRoot = await createTempRepo();
    const rfcPath = await writeRfc(repoRoot);
    await writeAgentixConfig(repoRoot, { rfcPath });
    await writeAgentixWorkPlan(repoRoot);
    await writeGeneratedWorkflow(repoRoot);

    const promptStub = createPromptStub([0]);
    const launchStub = createLaunchStub([7]);
    const exitStub = createExitStub();

    await expectProcessExit(
      runWorkflow({
        flags: {},
        repoRoot,
        deps: {
          findSmithersCliPath: () => "/tmp/fake-smithers.ts",
          promptChoice: promptStub.prompt,
          launchSmithers: launchStub.launch,
          createRunId: () => "sw-fail",
          exit: exitStub.exit,
        },
      }),
      7,
    );

    const events = await readAgentixEvents(repoRoot);
    const failed = expectEvent(events, "command.failed");
    expect(failed.command).toBe("run");
    expect(failed.runId).toBe("sw-fail");
    expect(String(failed.details?.message)).toContain("exited with code 7");
  });
});
