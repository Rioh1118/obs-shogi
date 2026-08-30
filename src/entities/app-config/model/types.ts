import type { PresetId } from "@/entities/engine-presets/model/types";
import type { AsyncResult } from "@/shared/lib/result";

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
  /**
   * 失敗を積まずに `isLoading` だけ降ろす。
   *
   * `loading` を立てた関数が失敗を戻り値で返すなら、この出口を使う。
   * `error` を使うと `RequireRootDir` がランタイムごと畳んでしまうし、
   * かといって何も送らないと `isLoading` が `true` のまま固定され、
   * `isLoading` を見て無効化されている操作（`WorkspaceTab` のボタン、
   * `AppLoading` の分岐）がその後ずっと押せなくなる
   */
  | { type: "settled" }
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
  setRootDir: (rootDir: string) => AsyncResult<void, string>;
  setLastPresetId: (presetId: PresetId | null) => Promise<void>;
};
