import { afterEach, describe, expect, test } from "bun:test";

import { runPlan } from "../plan";
import type { WorkPlan } from "../../scheduled/types";
import {
  cleanupTempRepos,
  createDecomposeStub,
  createExitStub,
  createTempRepo,
  expectEvent,
  expectProcessExit,
  makeDeterministicPlan,
  readAgentixEvents,
  readAgentixJson,
  writeAgentixConfig,
  writeAgentixWorkPlan,
  writeRfc,
} from "./fixtures";

afterEach(async () => {
  await cleanupTempRepos();
});

describe("plan command integration", () => {
  test("rewrites work-plan.json on happy path", async () => {
    const repoRoot = await createTempRepo();
    const rfcPath = await writeRfc(repoRoot, "docs/rfc.md", "# RFC\n\nNew plan");
    await writeAgentixConfig(repoRoot, { rfcPath });
    await writeAgentixWorkPlan(
      repoRoot,
      makeDeterministicPlan(rfcPath).plan,
    );

    const regenerated = makeDeterministicPlan(rfcPath);
    regenerated.plan.units[0].id = "plan-regenerated";
    regenerated.plan.units[0].name = "Regenerated Plan";

    const decomposeStub = createDecomposeStub(regenerated);

    await runPlan({
      flags: {},
      repoRoot,
      deps: {
        scanRepo: async () => ({
          projectName: "fixture-repo",
          runner: "bun",
          buildCmds: { typecheck: "bun run typecheck" },
          testCmds: { test: "bun run test" },
          packageScripts: {},
        }),
        decomposeRFC: decomposeStub.decompose,
      },
    });

    const plan = await readAgentixJson<WorkPlan>(repoRoot, "work-plan.json");
    expect(plan.units[0].id).toBe("plan-regenerated");
    expect(plan.source).toBe(rfcPath);

    const events = await readAgentixEvents(repoRoot);
    expectEvent(events, "command.started");
    const completed = expectEvent(events, "command.completed");
    expect(completed.command).toBe("plan");
    expect(completed.details?.unitCount).toBe(1);
  });

  test("fails when config is missing", async () => {
    const repoRoot = await createTempRepo();
    const exitStub = createExitStub();

    await expectProcessExit(
      runPlan({
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
    expect(failed.command).toBe("plan");
    expect(failed.details?.reason).toBe("missing-config");
  });

  test("fails when configured RFC path is missing", async () => {
    const repoRoot = await createTempRepo();
    await writeAgentixConfig(repoRoot, {
      rfcPath: `${repoRoot}/docs/missing-rfc.md`,
    });

    const exitStub = createExitStub();

    await expectProcessExit(
      runPlan({
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
    expect(failed.command).toBe("plan");
    expect(failed.details?.reason).toBe("missing-rfc");
  });
});
