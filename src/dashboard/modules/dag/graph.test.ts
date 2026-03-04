import { describe, expect, test } from "bun:test";

import { buildDagViewModel } from "./graph";

describe("dag view model", () => {
  test("builds nodes + dependency edges with deterministic ordering", () => {
    const dag = buildDagViewModel({
      workPlanUnits: [
        {
          id: "obs-01",
          name: "Read Model",
          tier: "medium",
          priority: "high",
          deps: [],
        },
        {
          id: "obs-02",
          name: "Stream",
          tier: "medium",
          priority: "high",
          deps: ["obs-01"],
        },
      ],
      nodeStates: [
        { nodeId: "obs-01:implement", state: "finished" },
        { nodeId: "obs-02:plan", state: "in-progress" },
      ],
    });

    expect(dag.nodes.map((node) => node.id)).toEqual(["obs-01", "obs-02"]);
    expect(dag.nodes[0]?.state).toBe("finished");
    expect(dag.nodes[1]?.state).toBe("in-progress");
    expect(dag.edges).toEqual([{ from: "obs-01", to: "obs-02" }]);
    expect(dag.warnings).toEqual([]);
  });

  test("flags missing dependency targets", () => {
    const dag = buildDagViewModel({
      workPlanUnits: [
        {
          id: "obs-05",
          name: "Attempt Explorer",
          tier: "medium",
          deps: ["missing-unit"],
        },
      ],
      nodeStates: [],
    });

    expect(dag.edges).toEqual([]);
    expect(dag.warnings).toEqual([
      "Unknown dependency edge: missing-unit -> obs-05",
    ]);
  });
});
