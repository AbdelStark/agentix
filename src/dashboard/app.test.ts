import { describe, expect, test } from "bun:test";

import {
  buildDashboardSearch,
  getDashboardModules,
  readDashboardUrlState,
  resolveModuleByShortcut,
} from "./app";

describe("dashboard app routing", () => {
  test("exposes deterministic module registry", () => {
    const modules = getDashboardModules();
    expect(modules.map((module) => module.id)).toEqual([
      "cockpit",
      "dag",
      "attempts",
      "readiness",
      "analytics",
      "telemetry",
    ]);
  });

  test("maps keyboard shortcuts to module ids", () => {
    expect(resolveModuleByShortcut("1")).toBe("cockpit");
    expect(resolveModuleByShortcut("4")).toBe("readiness");
    expect(resolveModuleByShortcut("9")).toBeNull();
  });

  test("parses URL state using defensive defaults", () => {
    expect(
      readDashboardUrlState(
        "?module=dag&run=run-42&q=failed&unit=obs03&node=node.plan&attempt=2&stream=stderr&logs=timeout",
      ),
    ).toEqual({
      selectedModule: "dag",
      selectedRunId: "run-42",
      runSearch: "failed",
      selectedUnitId: "obs03",
      attemptsNodeFilter: "node.plan",
      attemptsAttemptFilter: 2,
      logStreamFilter: "stderr",
      logSearch: "timeout",
      stepBoardFilter: "all",
      stepBoardSort: "newest",
      stepBoardQuery: "",
      timelineCriticalOnly: false,
      timelineFailuresOnly: false,
      timelineSystemEvents: true,
      timelineToolEvents: true,
      timelineResourceAnomalies: false,
      timelineQuery: "",
      timelineFocusEventKey: null,
    });

    expect(readDashboardUrlState("?module=nope&attempt=bad&stream=all")).toEqual({
      selectedModule: null,
      selectedRunId: null,
      runSearch: "",
      selectedUnitId: null,
      attemptsNodeFilter: null,
      attemptsAttemptFilter: null,
      logStreamFilter: "all",
      logSearch: "",
      stepBoardFilter: "all",
      stepBoardSort: "newest",
      stepBoardQuery: "",
      timelineCriticalOnly: false,
      timelineFailuresOnly: false,
      timelineSystemEvents: true,
      timelineToolEvents: true,
      timelineResourceAnomalies: false,
      timelineQuery: "",
      timelineFocusEventKey: null,
    });
  });

  test("serializes URL state and keeps security token query params", () => {
    expect(
      buildDashboardSearch(
        {
          selectedModule: "attempts",
          selectedRunId: "run-99",
          runSearch: "failed",
          selectedUnitId: "obs04",
          attemptsNodeFilter: "node.implement",
          attemptsAttemptFilter: 3,
          logStreamFilter: "stderr",
          logSearch: "stack",
          stepBoardFilter: "failed",
          stepBoardSort: "failing-first",
          stepBoardQuery: "obs",
          timelineCriticalOnly: true,
          timelineFailuresOnly: true,
          timelineSystemEvents: false,
          timelineToolEvents: true,
          timelineResourceAnomalies: true,
          timelineQuery: "blocked",
          timelineFocusEventKey: "evt-9",
        },
        "?token=secret-token",
      ),
    ).toBe(
      "?token=secret-token&module=attempts&run=run-99&q=failed&unit=obs04&node=node.implement&attempt=3&stream=stderr&logs=stack&sfilter=failed&ssort=failing-first&squery=obs&tlc=1&tlf=1&tls=0&tlr=1&tlq=blocked&tle=evt-9",
    );

    expect(
      buildDashboardSearch(
        {
          selectedModule: "cockpit",
          selectedRunId: null,
          runSearch: "",
          selectedUnitId: null,
          attemptsNodeFilter: null,
          attemptsAttemptFilter: null,
          logStreamFilter: "all",
          logSearch: "",
          stepBoardFilter: "all",
          stepBoardSort: "newest",
          stepBoardQuery: "",
          timelineCriticalOnly: false,
          timelineFailuresOnly: false,
          timelineSystemEvents: true,
          timelineToolEvents: true,
          timelineResourceAnomalies: false,
          timelineQuery: "",
          timelineFocusEventKey: null,
        },
        "?token=secret-token&module=dag",
      ),
    ).toBe("?token=secret-token");
  });
});
