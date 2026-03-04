import { describe, expect, test } from "bun:test";

import { deriveDashboardLayoutState } from "./shell-state";

describe("dashboard shell state selector", () => {
  test("returns desktop page-scroll state for wide viewports", () => {
    expect(deriveDashboardLayoutState(1440)).toEqual({
      mode: "desktop",
      sidebarSticky: true,
      contentScrollMode: "page",
    });
  });

  test("returns mobile stacked state below breakpoint", () => {
    expect(deriveDashboardLayoutState(900)).toEqual({
      mode: "mobile",
      sidebarSticky: false,
      contentScrollMode: "stacked",
    });
  });
});
