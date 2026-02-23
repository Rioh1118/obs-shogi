import { useEffect, useReducer } from "react";
import type { ReactNode } from "react";
import type { AppConfig, AppConfigContextType } from "./types";
import type { PresetId } from "@/types/enginePresets";

import { AppConfigContext } from "./context";
import { configReducer, initialState } from "./reducer";
import { loadConfig, saveConfig } from "../api/config";
import {
  chooseAiRoot as chooseAiRootApi,
  chooseRootDir as chooseRootDirApi,
  setRootDir as setRootDirApi,
} from "../api/directories";

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(configReducer, initialState);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      dispatch({ type: "loading" });
      try {
        const config = await loadConfig();
        if (!cancelled) dispatch({ type: "loaded", payload: config });
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: "error",
            payload: `設定の読み込みに失敗しました: ${String(err)}`,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function updateConfig(config: AppConfig) {
    dispatch({ type: "loading" });
    try {
      await saveConfig(config);
      dispatch({ type: "updated", payload: config });
    } catch (err) {
      dispatch({
        type: "error",
        payload: `設定の保存に失敗しました: ${String(err)}`,
      });
    }
  }

  async function chooseRootDir(opts = {}) {
    dispatch({ type: "loading" });
    try {
      const rootDir = await chooseRootDirApi(opts);
      const updated = await loadConfig();
      dispatch({ type: "updated", payload: updated });
      return rootDir;
    } catch (err) {
      dispatch({
        type: "error",
        payload: `ルートディレクトリの初期化に失敗しました: ${String(err)}`,
      });
      return null;
    }
  }

  async function chooseAiRoot(opts = {}) {
    dispatch({ type: "loading" });
    try {
      const aiRoot = await chooseAiRootApi(opts);
      const updated = await loadConfig();
      dispatch({ type: "updated", payload: updated });
      return aiRoot;
    } catch (err) {
      dispatch({
        type: "error",
        payload: `AI_ROOTの選択に失敗しました: ${String(err)}`,
      });
      return null;
    }
  }

  async function setRootDir(rootDir: string) {
    dispatch({ type: "loading" });
    try {
      await setRootDirApi(rootDir);
      const updated = await loadConfig();
      dispatch({ type: "updated", payload: updated });
    } catch (err) {
      dispatch({
        type: "error",
        payload: `ルートディレクトリの更新に失敗しました: ${String(err)}`,
      });
    }
  }

  async function setLastPresetId(presetId: PresetId | null) {
    dispatch({ type: "loading" });
    try {
      const base = state.config ?? (await loadConfig());

      const next: AppConfig = {
        ...base,
        last_preset_id: presetId,
      };

      await saveConfig(next);
      dispatch({ type: "updated", payload: next });
    } catch (err) {
      dispatch({
        type: "error",
        payload: `last_preset_id の保存に失敗しました: ${String(err)}`,
      });
    }
  }

  const value: AppConfigContextType = {
    ...state,
    updateConfig,
    chooseRootDir,
    chooseAiRoot,
    setRootDir,
    setLastPresetId,
  };

  return (
    <AppConfigContext.Provider value={value}>
      {children}
    </AppConfigContext.Provider>
  );
}
