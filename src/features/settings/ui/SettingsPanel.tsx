import { useURLParams } from "@/shared/lib/router/useURLParams";

import EngineTab from "./tabs/EngineTab";

import "./SettingsPanel.scss";
import SettingsTabButton from "./SettingsTabButton";
import { TABS, type TabKey } from "@/features/settings";
import WorkspaceTab from "./tabs/WorkspaceTab";
import AiLibraryTab from "./tabs/AiLibraryTab";

function SettingsPanel() {
  const { params, updateParams } = useURLParams();
  const tab = (params.tab as TabKey) ?? "general";

  const goTab = (t: TabKey) => updateParams({ tab: t }, { replace: true });

  const activeTabInfo = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className="settings">
      <header className="settings__header">
        <div className="settings__title">
          <div className="settings__titleMain">設定</div>
          <div className="settings__titleSub">{activeTabInfo.desc}</div>
        </div>
      </header>

      <div className="settings__body">
        <nav className="settings__nav" aria-label="Settings tabs">
          <div className="settings__navGroup">
            {TABS.map((t) => {
              const isActive = tab === t.key;

              const showLock = t.key !== "general";

              const showDangerBadge = t.key !== "general";

              const badges = [
                ...(showLock
                  ? [{ tone: "muted" as const, children: "要設定" }]
                  : []),
                ...(showDangerBadge
                  ? [{ tone: "danger" as const, children: "注意" }]
                  : []),
              ];
              return (
                <SettingsTabButton
                  key={t.key}
                  active={isActive}
                  label={t.label}
                  desc={t.desc}
                  onClick={() => goTab(t.key)}
                  badges={badges}
                />
              );
            })}
          </div>
        </nav>

        <main className="settings__main">
          <section className="settings__content">
            {tab === "workspace" && <WorkspaceTab />}
            {tab === "aiLibrary" && <AiLibraryTab />}
            {tab === "engine" && <EngineTab />}
          </section>
        </main>
      </div>
    </div>
  );
}

export default SettingsPanel;
