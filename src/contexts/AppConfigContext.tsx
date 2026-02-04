import { createContext, useContext, useReducer, useEffect } from "react";
import type { ReactNode } from "react";
import type { AppConfig } from "@/types/config";
import {
  loadConfig,
  saveConfig,
  type ChooseOpts,
  chooseRootDir as chooseRootDirCommand,
  chooseAiRoot as chooseAiRootCommand,
  setRootDir as setRootDirCommand,
} from "../commands/config_dir";

type ConfigState = {
  config: AppConfig | null;
  isLoading: boolean;
  error: string | null;
};

type ConfigAction =
  | { type: "loading" }
  | { type: "loaded"; payload: AppConfig }
  | { type: "updated"; payload: AppConfig }
  | { type: "error"; payload: string };

const initialState: ConfigState = {
  config: null,
  isLoading: false,
  error: null,
};

function configReducer(state: ConfigState, action: ConfigAction): ConfigState {
  switch (action.type) {
    case "loading":
      return { ...state, isLoading: true, error: null };
    case "loaded":
    case "updated":
      return { config: action.payload, isLoading: false, error: null };
    case "error":
      return { ...state, isLoading: false, error: action.payload };
    default:
      throw new Error("Unknown action type");
  }
}

type AppConfigContextType = ConfigState & {
  updateConfig: (config: AppConfig) => Promise<void>;
  chooseRootDir: (opts?: ChooseOpts) => Promise<string | null>;
  chooseAiRoot: (opts?: ChooseOpts) => Promise<string | null>;
  setRootDir: (root_dir: string) => Promise<void>;
};

const AppConfigContext = createContext<AppConfigContextType | undefined>(
  undefined,
);

function AppConfigProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(configReducer, initialState);

  useEffect(() => {
    async function load() {
      dispatch({ type: "loading" });
      try {
        const config = await loadConfig();
        dispatch({ type: "loaded", payload: config });
      } catch (err) {
        dispatch({
          type: "error",
          payload: `設定の読み込みに失敗しました:${err}`,
        });
      }
    }
    load();
  }, []);

  async function updateConfig(config: AppConfig) {
    dispatch({ type: "loading" });
    try {
      await saveConfig(config);
      dispatch({ type: "updated", payload: config });
    } catch (err) {
      dispatch({
        type: "error",
        payload: `設定の保存に失敗しました: ${err}`,
      });
    }
  }

  async function chooseRootDir(opts: ChooseOpts = {}) {
    dispatch({ type: "loading" });
    try {
      const rootDir = await chooseRootDirCommand(opts);
      const updated = await loadConfig();
      dispatch({ type: "updated", payload: updated });
      return rootDir;
    } catch (err) {
      dispatch({
        type: "error",
        payload: `ルートディレクトリの初期化に失敗しました: ${err}`,
      });
      return null;
    }
  }

  async function chooseAiRoot(opts: ChooseOpts = {}) {
    dispatch({ type: "loading" });
    try {
      const aiRoot = await chooseAiRootCommand(opts);
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
      await setRootDirCommand(rootDir);
      const updated = await loadConfig();
      dispatch({ type: "updated", payload: updated });
    } catch (err) {
      dispatch({
        type: "error",
        payload: `ルートディレクトリの更新に失敗しました: ${String(err)}`,
      });
    }
  }

  return (
    <AppConfigContext.Provider
      value={{
        ...state,
        updateConfig,
        chooseRootDir,
        chooseAiRoot,
        setRootDir,
      }}
    >
      {children}
    </AppConfigContext.Provider>
  );
}

function useAppConfig() {
  const context = useContext(AppConfigContext);
  if (!context) {
    throw new Error("useAppConfig must be used within AppConfigProvider");
  }
  return context;
}

export { useAppConfig, AppConfigProvider };
