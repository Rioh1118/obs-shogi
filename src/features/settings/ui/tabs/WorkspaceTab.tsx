import "./WorkspaceTab.scss";

import IndexStatusSection from "../workspace-tab/IndexStatusSection";
import WorkspaceRootSection from "../workspace-tab/WorkspaceRootSection";
import AppUpdateSection from "../workspace-tab/AppUpdateSection";

export default function WorkspaceTab() {
  return (
    <div className="wsTab">
      <IndexStatusSection />
      <WorkspaceRootSection />
      <AppUpdateSection />
    </div>
  );
}
