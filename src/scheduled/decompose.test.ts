import { describe, expect, test } from "bun:test";
import { extractJsonPayload, parseDecomposeResponse } from "./decompose";
import type { WorkUnit } from "./types";

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

describe("extractJsonPayload", () => {
  test("extracts fenced json payload", () => {
    const raw = "```json\n{\"units\":[]}\n```";
    expect(extractJsonPayload(raw)).toBe("{\"units\":[]}");
  });

  test("returns trimmed raw payload when not fenced", () => {
    expect(extractJsonPayload("  {\"units\":[]}  ")).toBe("{\"units\":[]}");
  });

  test("extracts first balanced json block from prose response", () => {
    const raw =
      "Here is the plan:\n{\"units\":[{\"id\":\"u1\",\"note\":\"contains } in text\"}]}\nThank you.";
    expect(extractJsonPayload(raw)).toBe(
      "{\"units\":[{\"id\":\"u1\",\"note\":\"contains } in text\"}]}",
    );
  });
});

describe("parseDecomposeResponse", () => {
  test("parses top-level units object", () => {
    const raw = JSON.stringify({ units: [mkUnit({ id: "u1" })] });
    const parsed = parseDecomposeResponse(raw);
    expect(parsed.units).toHaveLength(1);
    expect(parsed.units[0].id).toBe("u1");
  });

  test("parses direct units array payload", () => {
    const raw = JSON.stringify([mkUnit({ id: "u-array" })]);
    const parsed = parseDecomposeResponse(raw);
    expect(parsed.units[0].id).toBe("u-array");
  });

  test("parses nested payload under known wrapper keys", () => {
    const raw = JSON.stringify({
      result: {
        units: [mkUnit({ id: "u-nested" })],
      },
    });
    const parsed = parseDecomposeResponse(raw);
    expect(parsed.units[0].id).toBe("u-nested");
  });

  test("throws on malformed json", () => {
    expect(() => parseDecomposeResponse("{bad")).toThrow(
      /Failed to parse AI response as JSON/,
    );
  });

  test("throws when units are missing", () => {
    expect(() =>
      parseDecomposeResponse(JSON.stringify({ nope: [] })),
    ).toThrow(/AI returned no work units/);
  });

  test("throws on schema-invalid units", () => {
    const badUnit = { id: "u1", name: "Missing required fields" };
    expect(() =>
      parseDecomposeResponse(JSON.stringify({ units: [badUnit] })),
    ).toThrow();
  });
});
