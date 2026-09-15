export type { DockViewMeta } from "./model/views";
export { DOCK_VIEWS, dockViewLabel } from "./model/views";

export {
  moveDockTab,
  knownDockViews,
  resolveDockTabs,
  resolveDockView,
  resolveStartupTab,
  toggleDockTab,
} from "./lib/tabs";
