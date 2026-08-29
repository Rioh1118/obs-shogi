import type { PresetId } from "@/entities/engine-presets/model/types";

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
  /**
   * ワークスペースを差し替える。**成否を返す。**
   *
   * `void` にすると、呼び出し元は設定が更新されたかどうかを見られない。
   * ルート改名の経路はディスク上の改名を済ませてからここへ来るので、
   * 失敗を見落とすと「ディスクは新しい名前・設定は古い名前」で固定される
   */
  setRootDir: (root_dir: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  setLastPresetId: (presetId: PresetId | null) => Promise<void>;
};
