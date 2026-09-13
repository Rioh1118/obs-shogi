import type { PresetId } from "@/entities/engine-presets/model/types";
import type { AsyncResult } from "@/shared/lib/result";

export type AppConfig = {
  root_dir: string | null;
  ai_root: string | null;
  last_preset_id?: PresetId | null;

  /**
   * ドックに出すタブの綴りを、出す順に並べたもの。**まだ選んでいなければ欠ける。**
   *
   * **`DockViewType[]` にしない。** 設定ファイルは前の版も利用者も書くので、
   * 名簿に無い綴りが混ざる。型で名乗ると、濾さずに画面へ渡した経路が
   * tsc を通ってしまう。濾すのは `resolveDockTabs`（`entities/dock`）。
   */
  dock_tabs?: string[] | null;
  /** 起動時に開くタブ。**欠けていれば「前回のもの」**（`dock_last_tab` を使う） */
  dock_startup_tab?: string | null;
  /** 前回開いていたタブ */
  dock_last_tab?: string | null;
  /** 解析の評価値バーを出すか。**欠けていれば出さない**（ADR-0010 決定4） */
  show_evaluation_bar?: boolean | null;
  /**
   * 解析ビューの候補手の見せ方。**欠けていれば既定**（`resolveAnalysisDisplayMode`）。
   *
   * その場（操作列）で切り替えられて、選んだ結果がここに残る（ADR-0010 決定4）。
   */
  analysis_display_mode?: string | null;
  /**
   * 最近開いた定跡のパス。**新しいものが先頭。**
   * 上限を持つのは `rememberBook`（`src/entities/book/lib/recents.ts`）。
   *
   * **`string[]` として使う前に濾すこと**（`readRecentBooks`）。設定ファイルは
   * 利用者も前の版も書くので、文字列でないものが混ざる。
   *
   * **起動時にこれを開き直さない。** 定跡は GB 級になりうるので、開くのは
   * 必ず押されてから（`widgets/book-view/ui/BookEmpty.tsx`）
   */
  book_recent_paths?: string[] | null;
};

/**
 * 表示の設定。**`AppConfig` のうち、設定「表示」タブとドックのビューが書き換える欄だけ。**
 */
export type DisplayConfigPatch = Pick<
  AppConfig,
  | "dock_tabs"
  | "dock_startup_tab"
  | "dock_last_tab"
  | "show_evaluation_bar"
  | "analysis_display_mode"
  | "book_recent_paths"
>;

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
  /**
   * **ランタイムから追い出す。** 設定の読み込みそのものが成立しないときだけ使う。
   *
   * `RequireRootDir` はこれを見て `/` へ飛ばすので、盤も棋譜も unmount される。
   * 更新の失敗（保存できなかった、選び直せなかった）をここへ載せると、
   * 呼び出し元が出そうとした失敗が画面に出る前に消える。更新の失敗は
   * 戻り値で返し、`isLoading` は `settled` で降ろすこと → TODO(#249)
   */
  | { type: "error"; payload: string };

export type AppConfigContextType = ConfigState & {
  updateConfig: (config: AppConfig) => Promise<void>;
  chooseRootDir: (opts?: ChooseOpts) => Promise<string | null>;
  /**
   * AI フォルダを選ばせる。**成否を返す。**
   *
   * `null` は取り消し（設定は動いていない）。失敗は `Err` で返し、`error` には
   * 積まない。積むと `RequireRootDir` が `/` へ飛ばして、選び損ねただけで
   * ランタイムが畳まれる
   */
  chooseAiRoot: (opts?: ChooseOpts) => AsyncResult<string | null, string>;
  /**
   * ワークスペースを差し替える。**成否を返す。**
   *
   * `void` にすると、呼び出し元は設定が更新されたかどうかを見られない。
   * ルート改名の経路はディスク上の改名を済ませてからここへ来るので、
   * 失敗を見落とすと「ディスクは新しい名前・設定は古い名前」で固定される
   */
  setRootDir: (rootDir: string) => AsyncResult<void, string>;
  setLastPresetId: (presetId: PresetId | null) => Promise<void>;
  /**
   * 表示の設定を書き換える。**渡した欄だけを差し替える。**
   *
   * 呼び手に `AppConfig` を組ませない —— 組ませると、`updateConfig` は
   * ファイルごと置き換えるので、呼び手が知らない欄（あとから足された欄）を
   * `undefined` で書き潰す。
   */
  setDisplayConfig: (patch: DisplayConfigPatch) => AsyncResult<void, string>;
};
