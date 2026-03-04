import { describe, expect, test } from "bun:test";

import { getDashboardModules, resolveModuleByShortcut } from "./app";

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
});
