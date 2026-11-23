import { useURLParams } from "@/shared/lib/router/useURLParams";

import EngineTab from "./tabs/EngineTab";

import "./SettingsPanel.scss";
import SettingsTabButton from "./SettingsTabButton";
import { TABS, type TabKey } from "@/features/settings/model/tabs";
import { useSetupNeeds } from "@/features/settings/model/useSetupNeeds";
import WorkspaceTab from "./tabs/WorkspaceTab";
import AiLibraryTab from "./tabs/AiLibraryTab";
import DisplayTab from "./tabs/DisplayTab";

function isTabKey(value: unknown): value is TabKey {
  return TABS.some((t) => t.key === value);
}

function SettingsPanel() {
  const { params, updateParams } = useURLParams();
  const needs = useSetupNeeds();

  const tab: TabKey = isTabKey(params.tab) ? params.tab : "workspace";

  return (
    <div className="settings">
      <header className="settings__header">
        <h2 className="settings__title">設定</h2>
      </header>

      <div className="settings__body">
        <nav className="settings__nav" aria-label="設定のタブ">
          {TABS.map((t) => (
            <SettingsTabButton
              key={t.key}
              active={tab === t.key}
              label={t.label}
              needsSetup={needs.has(t.key)}
              onClick={() => updateParams({ tab: t.key }, { replace: true })}
            />
          ))}
        </nav>

        <main className="settings__main" data-tab={tab}>
          <section className="settings__content">
            {tab === "workspace" && <WorkspaceTab />}
            {tab === "aiLibrary" && <AiLibraryTab />}
            {tab === "engine" && <EngineTab />}
            {tab === "display" && <DisplayTab />}
          </section>
        </main>
      </div>
    </div>
  );
}

export default SettingsPanel;
