import type { PresetId } from "@/types/enginePresets";

export type AppConfig = {
  root_dir: string | null;
  ai_root: string | null;
  last_preset_id?: PresetId | null;
};

export type ChooseOpts = { force?: boolean };

export type ConfigState = {
  config: AppConfig | null;
  isLoading: boolean;
  error: string | null;
};

export type ConfigAction =
  | { type: "loading" }
  | { type: "loaded"; payload: AppConfig }
  | { type: "updated"; payload: AppConfig }
  | { type: "error"; payload: string };

export type AppConfigContextType = ConfigState & {
  updateConfig: (config: AppConfig) => Promise<void>;
  chooseRootDir: (opts?: ChooseOpts) => Promise<string | null>;
  chooseAiRoot: (opts?: ChooseOpts) => Promise<string | null>;
  setRootDir: (root_dir: string) => Promise<void>;
  setLastPresetId: (presetId: PresetId | null) => Promise<void>;
};
