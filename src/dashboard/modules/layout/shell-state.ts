export type DashboardLayoutState = {
  mode: "desktop" | "mobile";
  sidebarSticky: boolean;
  contentScrollMode: "page" | "stacked";
};

const MOBILE_BREAKPOINT_PX = 980;

export function deriveDashboardLayoutState(viewportWidthPx: number): DashboardLayoutState {
  const width = Number.isFinite(viewportWidthPx) ? Number(viewportWidthPx) : 0;
  const mobile = width > 0 && width < MOBILE_BREAKPOINT_PX;
  return {
    mode: mobile ? "mobile" : "desktop",
    sidebarSticky: !mobile,
    contentScrollMode: mobile ? "stacked" : "page",
  };
}
