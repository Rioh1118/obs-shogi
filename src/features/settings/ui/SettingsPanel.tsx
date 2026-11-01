import { useURLParams } from "@/shared/lib/router/useURLParams";

import EngineTab from "./tabs/EngineTab";

import "./SettingsPanel.scss";
import SettingsBadge from "./kit/SettingsBadge";
import SettingsTabButton from "./SettingsTabButton";
import { TABS, type TabKey } from "@/features/settings/model/tabs";
import WorkspaceTab from "./tabs/WorkspaceTab";
import AiLibraryTab from "./tabs/AiLibraryTab";
import DisplayTab from "./tabs/DisplayTab";

function isTabKey(value: unknown): value is TabKey {
  return TABS.some((t) => t.key === value);
}

function SettingsPanel() {
  const { params, updateParams } = useURLParams();

  const tab: TabKey = isTabKey(params.tab) ? params.tab : "workspace";

  return (
    <div className="settings">
      <header className="settings__header">
        <div className="settings__title">
          <div className="settings__titleMain">設定</div>
        </div>
      </header>

      <div className="settings__body">
        <nav className="settings__nav" aria-label="Settings tabs">
          <div className="settings__navGroup">
            {TABS.map((t) => {
              // 外のもの（AI ライブラリの置き場、エンジン）を指すタブだけ。
              // 中身は見ていないので、設定が済んでいても消えない
              const needsSetup = t.key === "aiLibrary" || t.key === "engine";

              return (
                <SettingsTabButton
                  key={t.key}
                  active={tab === t.key}
                  label={t.label}
                  onClick={() => updateParams({ tab: t.key }, { replace: true })}
                  badges={
                    needsSetup && (
                      <>
                        <SettingsBadge>要設定</SettingsBadge>
                        <SettingsBadge tone="danger">注意</SettingsBadge>
                      </>
                    )
                  }
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
            {tab === "display" && <DisplayTab />}
          </section>
        </main>
      </div>
    </div>
  );
}

export default SettingsPanel;
