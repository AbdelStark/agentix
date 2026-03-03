import { describe, expect, test } from "bun:test";
import {
  computeLayers,
  validateDAG,
  workUnitSchema,
  type WorkUnit,
} from "./types";

function mkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "base-unit",
    name: "Base Unit",
    rfcSections: ["§1"],
    description: "Base unit description",
    deps: [],
    acceptance: ["Base acceptance criterion"],
    boundedContext: "billing",
    ubiquitousLanguage: ["invoice", "ledger"],
    domainInvariants: ["Invoice total must equal sum of line items"],
    gherkinFeature: "Invoice creation",
    gherkinRule: null,
    gherkinScenarios: [
      {
        id: "create-invoice-success",
        title: "Create invoice with valid line items",
        given: ["a customer exists"],
        when: ["an invoice is created with 2 line items"],
        then: ["invoice is persisted", "invoice total is computed"],
      },
    ],
    tier: "small",
    ...overrides,
  };
}

describe("workUnitSchema", () => {
  test("accepts a fully specified DDD/BDD work unit", () => {
    const parsed = workUnitSchema.parse(mkUnit());
    expect(parsed.boundedContext).toBe("billing");
    expect(parsed.gherkinScenarios.length).toBe(1);
  });

  test("rejects missing ubiquitous language", () => {
    expect(() =>
      workUnitSchema.parse(
        mkUnit({
          ubiquitousLanguage: [],
        }),
      ),
    ).toThrow();
  });

  test("rejects scenario without Then clause", () => {
    expect(() =>
      workUnitSchema.parse(
        mkUnit({
          gherkinScenarios: [
            {
              id: "broken-scenario",
              title: "Broken scenario",
              given: ["a precondition exists"],
              when: ["an action is triggered"],
              then: [],
            },
          ],
        }),
      ),
    ).toThrow();
  });
});

describe("validateDAG", () => {
  test("reports missing dependency references", () => {
    const result = validateDAG([
      mkUnit({
        id: "a",
        deps: ["missing"],
      }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("does not exist"))).toBe(
      true,
    );
  });

  test("reports dependency cycles", () => {
    const result = validateDAG([
      mkUnit({ id: "a", deps: ["b"] }),
      mkUnit({ id: "b", deps: ["a"] }),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("Cycle detected"))).toBe(
      true,
    );
  });

  test("accepts a valid acyclic graph", () => {
    const result = validateDAG([
      mkUnit({ id: "a" }),
      mkUnit({ id: "b", deps: ["a"] }),
      mkUnit({ id: "c", deps: ["a"] }),
    ]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("computeLayers", () => {
  test("builds deterministic topological layers", () => {
    const layers = computeLayers([
      mkUnit({ id: "a", deps: [] }),
      mkUnit({ id: "b", deps: ["a"] }),
      mkUnit({ id: "c", deps: ["a"] }),
      mkUnit({ id: "d", deps: ["b", "c"] }),
    ]);

    expect(layers).toHaveLength(3);
    expect(layers[0].map((unit) => unit.id)).toEqual(["a"]);
    expect(layers[1].map((unit) => unit.id)).toEqual(["b", "c"]);
    expect(layers[2].map((unit) => unit.id)).toEqual(["d"]);
  });
});
