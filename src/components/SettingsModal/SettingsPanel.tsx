import { useAppConfig } from "@/contexts/AppConfigContext";
import { useEngine } from "@/contexts/EngineContext";
import { useURLParams } from "@/hooks/useURLParams";

import GeneralTab from "./GeneralTab";
import EngineTab from "./EngineTab";
import ProfileTab from "./ProfileTab";
import OptionsTab from "./OptionsTab";
import EngineValidationBanner from "./EngineValidationBanner";

const TABS = [
  { key: "general", label: "一般" },
  { key: "engine", label: "エンジン" },
  { key: "profile", label: "AIプロファイル" },
  { key: "options", label: "オプション" },
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
    // AppConfigが更新される想定（あなたの実装次第）
    // すぐ候補一覧も更新したいなら:
    // if (selected) await refreshAiRootIndex();
    return selected;
  };

  const handleClearAiRoot = async () => {
    if (!config) return;
    await updateConfig({ ...config, ai_root: null });
    // EngineContext側で scan_idle になる（aiRoot null）
  };

  const showNeedAiRoot = tab !== "general" && !aiLibraryDir;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Tabs */}
      <div
        style={{ display: "flex", gap: 8, marginBottom: 4, flexWrap: "wrap" }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => goTab(t.key)}
            style={{ fontWeight: tab === t.key ? 700 : 400 }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* validation banner */}
      <EngineValidationBanner
        aiLibraryDir={aiLibraryDir}
        validation={validation}
        onGoGeneral={() => goTab("general")}
        onGoEngine={() => goTab("engine")}
        onGoProfile={() => goTab("profile")}
      />

      {showNeedAiRoot && (
        <div style={{ border: "1px solid #333", borderRadius: 8, padding: 12 }}>
          <p style={{ margin: 0 }}>
            まず ai_root（AIライブラリ）を設定してください。
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => goTab("general")}>一般へ</button>
          </div>
        </div>
      )}

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
    </div>
  );
}

export default SettingsPanel;
