import { useURLParams } from "@/shared/lib/router/useURLParams";

import EngineTab from "./tabs/EngineTab";

import "./SettingsPanel.scss";
import SettingsTabButton from "./SettingsTabButton";
import { TABS, type TabKey } from "@/features/settings/model/tabs";
import WorkspaceTab from "./tabs/WorkspaceTab";
import AiLibraryTab from "./tabs/AiLibraryTab";
import DisplayTab from "./tabs/DisplayTab";
import { useMemo } from "react";

function isTabKey(v: unknown, keys: readonly TabKey[]): v is TabKey {
  return typeof v === "string" && (keys as readonly string[]).includes(v);
}

function SettingsPanel() {
  const { params, updateParams } = useURLParams();
  const tabKeys = useMemo(() => TABS.map((t) => t.key), []);

  const tab: TabKey = isTabKey(params.tab, tabKeys) ? params.tab : "workspace";

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

              // 外のもの（AI ライブラリの置き場、エンジン）を指すタブだけ。
              // **中身は見ていない**ので、設定が済んでいても消えない
              const needsSetup = t.key === "aiLibrary" || t.key === "engine";

              const showLock = needsSetup;

              const showDangerBadge = needsSetup;

              const badges = [
                ...(showLock ? [{ tone: "muted" as const, children: "要設定" }] : []),
                ...(showDangerBadge ? [{ tone: "danger" as const, children: "注意" }] : []),
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
            {tab === "display" && <DisplayTab />}
          </section>
        </main>
      </div>
    </div>
  );
}

export default SettingsPanel;
