import { useAppConfig } from "@/contexts/AppConfigContext";
import { useEngine } from "@/contexts/EngineContext";
import { useURLParams } from "@/hooks/useURLParams";

import GeneralTab from "./GeneralTab";
import EngineTab from "./EngineTab";
import ProfileTab from "./ProfileTab";
import OptionsTab from "./OptionsTab";
import EngineValidationBanner from "./EngineValidationBanner";

import "./SettingsPanel.scss";
import { useMemo } from "react";
import SettingsTabButton from "./SettingsTabButton";
import SettingsButton from "./SettingsButton";

const TABS = [
  { key: "general", label: "環境", desc: "ai_root/vaultなど" },
  { key: "engine", label: "エンジン", desc: "起動エンジンを選択" },
  { key: "profile", label: "AIプロファイル", desc: "定跡/評価関数ファイル" },
  { key: "options", label: "解析", desc: "推奨/詳細オプション" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function SettingsPanel() {
  const { params, updateParams } = useURLParams();
  const tab = (params.tab as TabKey) ?? "general";

  const {
    config,
    chooseAiRoot,
    updateConfig,
    isLoading: configLoading,
  } = useAppConfig();

  const {
    state: engineState,
    validation,
    aiRootIndex,
    refreshAiRootIndex,
    setSelectedAiName,
    setSelectedEngineRel,
    setBookDirName,
    setBookFileName,
  } = useEngine();

  const aiLibraryDir = config?.ai_root ?? null;

  const indexLoading = engineState.index.status === "loading";
  const indexError =
    engineState.index.status === "error" ? engineState.index.error : null;

  const goTab = (t: TabKey) => updateParams({ tab: t }, { replace: true });

  const handleChooseAiRoot = async () => {
    const selected = await chooseAiRoot();
    return selected;
  };

  const handleClearAiRoot = async () => {
    if (!config) return;
    await updateConfig({ ...config, ai_root: null });
  };

  const showNeedAiRoot = tab !== "general" && !aiLibraryDir;

  const tabMeta = useMemo(() => {
    const needsAiRoot = !aiLibraryDir;
    const hasValidationNg = validation.status !== "ok";
    return {
      needsAiRoot,
      hasValidationNg,
      // ここは将来: dirty / unsaved / needsRestart なども集約してOK
      needsRestart: engineState.needsRestart,
    };
  }, [aiLibraryDir, validation.status, engineState.needsRestart]);

  const activeTabInfo = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className="settings">
      <header className="settings__header">
        <div className="settings__title">
          <div className="settings__titleMain">設定</div>
          <div className="settings__titleSub">{activeTabInfo.desc}</div>
        </div>
        <div className="settings__headerRight">
          {engineState.needsRestart && (
            <span className="settings__pill settings__pill--warn">
              再起動が必要
            </span>
          )}
        </div>
      </header>

      <div className="settings__body">
        {/* left nav */}
        <nav className="settings__nav" aria-label="Settings tabs">
          <div className="settings__navGroup">
            {TABS.map((t) => {
              const isActive = tab === t.key;

              const showLock = t.key !== "general" && tabMeta.needsAiRoot;

              const showDangerBadge =
                t.key !== "general" && tabMeta.hasValidationNg && aiLibraryDir;

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

          <div className="settings__navFooter">
            <div className="settings__small">
              状態: <code>{engineState.phase}</code>
            </div>
            {engineState.needsRestart && (
              <div className="settings__small settings__small--warn">
                ⚠️ 反映に再起動が必要
              </div>
            )}
          </div>
        </nav>

        <main className="settings__main">
          <div className="settings__banner">
            <EngineValidationBanner
              aiLibraryDir={aiLibraryDir}
              validation={validation}
              onGoGeneral={() => goTab("general")}
              onGoEngine={() => goTab("engine")}
              onGoProfile={() => goTab("profile")}
            />
          </div>

          {showNeedAiRoot && (
            <div className="settings__callout settings__callout--danger">
              <div className="settings__calloutTitle">
                まず ai_root（AIライブラリ）を設定してください
              </div>
              <div className="settings__calloutBody">
                エンジン/プロファイル/解析は ai_root の中身を参照します。
              </div>
              <div className="settings__calloutActions">
                <SettingsButton
                  variant="primary"
                  onClick={() => goTab("general")}
                >
                  環境へ
                </SettingsButton>
              </div>
            </div>
          )}

          <section className="settings__content">
            {tab === "general" && (
              <GeneralTab
                aiRoot={aiLibraryDir}
                loading={configLoading || indexLoading}
                error={indexError}
                onRefresh={refreshAiRootIndex}
                onChooseAiRoot={handleChooseAiRoot}
                onClearAiRoot={handleClearAiRoot}
              />
            )}

            {tab === "engine" && aiLibraryDir && (
              <EngineTab
                engines={aiRootIndex?.engines ?? []}
                selected={engineState.desiredConfig.selectedEngineRel}
                onSelect={(rel) => setSelectedEngineRel(rel)}
                enginesDir={aiRootIndex?.engines_dir?.path ?? null}
              />
            )}

            {tab === "profile" && aiLibraryDir && (
              <ProfileTab
                profiles={aiRootIndex?.profiles ?? []}
                selected={engineState.desiredConfig.selectedAiName}
                onSelect={(name) => setSelectedAiName(name)}
                onSetBookDir={setBookDirName}
                onSetBookFile={setBookFileName}
              />
            )}

            {tab === "options" && aiLibraryDir && <OptionsTab />}
          </section>
        </main>
      </div>
    </div>
  );
}

export default SettingsPanel;
