import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

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
  writeWorkflowDbWithFailedResumeNodes,
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
    expect(
      events.find((entry) => entry.event === "run.resume.failure_snapshot"),
    ).toBeUndefined();
  });

  test("passes force resume flag to smithers when --resume-force is enabled", async () => {
    const repoRoot = await createTempRepo();
    const rfcPath = await writeRfc(repoRoot);
    await writeAgentixConfig(repoRoot, { rfcPath, maxConcurrency: 3 });
    await writeAgentixWorkPlan(repoRoot);
    await writeGeneratedWorkflow(repoRoot);
    await writeWorkflowDbWithRuns(repoRoot, ["sw-force"]);

    const launchStub = createLaunchStub([0]);

    await runWorkflow({
      flags: { resume: "sw-force", "resume-force": true },
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
        runId: "sw-force",
        forceResume: true,
      }),
    );
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

  test("resume recovery reopens failed nodes before launch", async () => {
    const repoRoot = await createTempRepo();
    const rfcPath = await writeRfc(repoRoot);
    await writeAgentixConfig(repoRoot, { rfcPath, maxConcurrency: 3 });
    await writeAgentixWorkPlan(repoRoot);
    await writeGeneratedWorkflow(repoRoot);
    const dbPath = await writeWorkflowDbWithFailedResumeNodes(repoRoot, "sw-stuck");

    const launchStub = createLaunchStub([0]);

    await runWorkflow({
      flags: { resume: "sw-stuck" },
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
        runId: "sw-stuck",
      }),
    );

    const db = new Database(dbPath, { readonly: true });
    const node = db
      .query(
        "SELECT state FROM _smithers_nodes WHERE run_id = ? AND node_id = ? AND iteration = ?",
      )
      .get("sw-stuck", "stuck-unit:final-review", 4) as
      | { state: string }
      | null;
    const attempts = db
      .query(
        "SELECT state FROM _smithers_attempts WHERE run_id = ? AND node_id = ? AND iteration = ? ORDER BY attempt",
      )
      .all("sw-stuck", "stuck-unit:final-review", 4) as Array<{ state: string }>;
    db.close();

    expect(node?.state).toBe("pending");
    expect(attempts.map((attempt) => attempt.state)).toEqual([
      "cancelled",
      "cancelled",
    ]);

    const events = await readAgentixEvents(repoRoot);
    const failureSnapshot = expectEvent(events, "run.resume.failure_snapshot");
    expect(failureSnapshot.command).toBe("run");
    expect(failureSnapshot.runId).toBe("sw-stuck");
    expect(failureSnapshot.details?.failedNodeCount).toBe(1);
    expect(failureSnapshot.details?.failedAttemptCount).toBe(2);
    const latestFailedAttempts = Array.isArray(
      failureSnapshot.details?.latestFailedAttempts,
    )
      ? (failureSnapshot.details?.latestFailedAttempts as Array<{
          message?: string;
        }>)
      : [];
    expect(latestFailedAttempts[0]?.message ?? "").toContain(
      "CLI timed out after 300000ms",
    );

    const recovered = expectEvent(events, "run.resume.recovered");
    expect(recovered.command).toBe("run");
    expect(recovered.runId).toBe("sw-stuck");
  });

  test("resume recovery can be disabled with --no-resume-recovery", async () => {
    const repoRoot = await createTempRepo();
    const rfcPath = await writeRfc(repoRoot);
    await writeAgentixConfig(repoRoot, { rfcPath, maxConcurrency: 3 });
    await writeAgentixWorkPlan(repoRoot);
    await writeGeneratedWorkflow(repoRoot);
    const dbPath = await writeWorkflowDbWithFailedResumeNodes(repoRoot, "sw-stuck-disabled");

    const launchStub = createLaunchStub([0]);

    await runWorkflow({
      flags: { resume: "sw-stuck-disabled", "no-resume-recovery": true },
      repoRoot,
      deps: {
        findSmithersCliPath: () => "/tmp/fake-smithers.ts",
        launchSmithers: launchStub.launch,
      },
    });

    const db = new Database(dbPath, { readonly: true });
    const attempts = db
      .query(
        "SELECT state FROM _smithers_attempts WHERE run_id = ? AND node_id = ? AND iteration = ? ORDER BY attempt",
      )
      .all("sw-stuck-disabled", "stuck-unit:final-review", 4) as Array<{ state: string }>;
    db.close();

    expect(attempts.map((attempt) => attempt.state)).toEqual([
      "failed",
      "failed",
    ]);
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
