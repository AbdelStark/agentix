import { describe, expect, test } from "bun:test";

import {
  buildVirtualLogWindow,
  deriveAttemptFocusFromEvent,
  filterLogsByStream,
  groupAttemptsByNode,
} from "./grouping";

describe("attempt explorer grouping", () => {
  test("groups retries chronologically and computes total duration", () => {
    const groups = groupAttemptsByNode([
      {
        nodeId: "obs-05:implement",
        attempt: 2,
        state: "finished",
        startedAt: "2026-03-03T10:00:10.000Z",
        finishedAt: "2026-03-03T10:00:30.000Z",
        durationMs: 20_000,
        responseText: "pass",
      },
      {
        nodeId: "obs-05:implement",
        attempt: 1,
        state: "failed",
        startedAt: "2026-03-03T10:00:00.000Z",
        finishedAt: "2026-03-03T10:00:05.000Z",
        durationMs: 5_000,
        responseText: "fail",
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.retries).toBe(1);
    expect(groups[0]?.latestState).toBe("finished");
    expect(groups[0]?.totalDurationMs).toBe(25_000);
    expect(groups[0]?.attempts.map((entry) => entry.attempt)).toEqual([1, 2]);
  });

  test("filters logs by stream deterministically", () => {
    const logs = [
      { stream: "stdout" as const, text: "ok" },
      { stream: "stderr" as const, text: "err" },
    ];

    expect(filterLogsByStream(logs, "all")).toEqual(logs);
    expect(filterLogsByStream(logs, "stdout")).toEqual([logs[0]]);
    expect(filterLogsByStream(logs, "stderr")).toEqual([logs[1]]);
  });

  test("builds a deterministic virtualized log window", () => {
    const logs = Array.from({ length: 100 }).map((_, index) => ({
      stream: "stdout" as const,
      text: `line-${index}`,
    }));

    const windowed = buildVirtualLogWindow({
      logs,
      rowHeightPx: 28,
      viewportHeightPx: 112,
      scrollTopPx: 280,
      overscanRows: 2,
    });

    expect(windowed.totalRows).toBe(100);
    expect(windowed.startIndex).toBe(8);
    expect(windowed.endIndex).toBe(15);
    expect(windowed.items.map((item) => item.text)).toEqual([
      "line-8",
      "line-9",
      "line-10",
      "line-11",
      "line-12",
      "line-13",
      "line-14",
      "line-15",
    ]);
    expect(windowed.paddingTopPx).toBe(224);
    expect(windowed.paddingBottomPx).toBe(2352);
  });

  test("derives node and attempt focus from node output event payload", () => {
    const focus = deriveAttemptFocusFromEvent({
      type: "NodeOutput",
      payload: {
        nodeId: "obs-05:implement",
        attempt: 2,
      },
    });

    expect(focus).toEqual({
      nodeId: "obs-05:implement",
      attempt: 2,
    });
  });
});
