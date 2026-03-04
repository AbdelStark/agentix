import { describe, expect, test } from "bun:test";

import { evaluateGateBoard } from "./gate-evaluator";

describe("gate board evaluator", () => {
  test("marks scenario gate as fail when uncovered scenarios exist", () => {
    const gates = evaluateGateBoard({
      stageOutputs: [
        {
          table: "test",
          row: {
            tests_passed: true,
            build_passed: true,
            scenarios_total: 3,
            scenarios_covered: 2,
            uncovered_scenarios: ["obs06-s1"],
          },
        },
      ],
      traces: [
        {
          traceCompleteness: true,
          scenariosTotal: 3,
          scenariosCovered: 2,
          uncoveredScenarios: ["obs06-s1"],
        },
      ],
    });

    const scenarioGate = gates.find((entry) => entry.key === "scenarios");
    expect(scenarioGate?.state).toBe("fail");
  });

  test("passes trace gate only when all traces are complete", () => {
    const gates = evaluateGateBoard({
      stageOutputs: [],
      traces: [
        {
          traceCompleteness: false,
          scenariosTotal: 1,
          scenariosCovered: 1,
          uncoveredScenarios: [],
        },
      ],
    });

    const traceGate = gates.find((entry) => entry.key === "trace");
    expect(traceGate?.state).toBe("fail");
  });

  test("fails trace gate when anti-slop flags are present", () => {
    const gates = evaluateGateBoard({
      stageOutputs: [],
      traces: [
        {
          traceCompleteness: true,
          scenariosTotal: 2,
          scenariosCovered: 2,
          uncoveredScenarios: [],
          antiSlopFlags: ["missing-assertion-signals"],
        },
      ],
    });

    const traceGate = gates.find((entry) => entry.key === "trace");
    expect(traceGate?.state).toBe("fail");
    expect(traceGate?.reason).toContain("anti-slop");
    expect(traceGate?.actionTarget).toBe("attempts");
  });
});
