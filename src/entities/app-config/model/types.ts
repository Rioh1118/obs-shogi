import type { PresetId } from "@/entities/engine-presets/model/types";
import type { AsyncResult } from "@/shared/lib/result";

export type AppConfig = {
  root_dir: string | null;
  ai_root: string | null;
  last_preset_id?: PresetId | null;

  /**
   * ドックに出すタブの綴りを、出す順に並べたもの。まだ選んでいなければ欠ける。
   *
   * `DockViewType[]` にしない。設定ファイルは前の版も利用者も書くので、名簿に無い綴りが
   * 混ざる。型で名乗ると、濾さずに画面へ渡した経路が tsc を通る。
   * 濾すのは `resolveDockTabs`（`entities/dock`）。
   */
  dock_tabs?: string[] | null;
  /**
   * `dock_tabs` を選んだときに名簿にあった綴り。欠けていれば「何も知らなかった」と読む。
   *
   * `dock_tabs` に無いことが「外した」を意味するのは、選ぶ機会があったときだけ。
   * これが無いと、後から名簿に足したビューと、利用者が外したビューを見分けられない
   * （`resolveDockTabs`）。
   */
  dock_tabs_known?: string[] | null;
  /** 起動時に開くタブ。欠けていれば `dock_last_tab` を使う */
  dock_startup_tab?: string | null;
  /** 前回開いていたタブ */
  dock_last_tab?: string | null;
  /** 解析の評価値バーを出すか。欠けていれば出さない（ADR-0010 決定4） */
  show_evaluation_bar?: boolean | null;
  /**
   * 解析ビューの候補手の見せ方。欠けていれば既定（`resolveAnalysisDisplayMode`）。
   *
   * 操作列で切り替えた結果がここに残る（ADR-0010 決定4）。
   */
  analysis_display_mode?: string | null;
  /**
   * 最近開いた定跡のパス。新しいものが先頭。
   *
   * 手で書かれた値も混ざるので、画面に出す前に `readRecentBooks` を通す。
   * 消えたファイルのパスは残す。外付けを繋ぎ忘れただけで一覧から消さないため。
   *
   * 起動時にこれを開き直さない。定跡は GB 級になりうるので、開くのは押されてから
   * （`widgets/book-view/ui/BookEmpty.tsx`）
   */
  book_recent_paths?: string[] | null;
};

/** `AppConfig` のうち、設定「表示」タブとドックのビューが書き換える欄 */
export type DisplayConfigPatch = Pick<
  AppConfig,
  | "dock_tabs"
  | "dock_tabs_known"
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
  /**
   * 失敗を積まずに `isLoading` だけ降ろす。
   *
   * `loading` を立てた関数が失敗を戻り値で返すなら、これを送る。何も送らないと
   * `isLoading` が `true` のまま固定され、それを見て無効化されている操作
   * （`WorkspaceTab` のボタン、`AppLoading` の分岐）がその後ずっと押せなくなる
   */
  | { type: "settled" }
  /**
   * ランタイムから追い出す。設定の読み込みそのものが成立しないときに使う。
   *
   * `RequireRootDir` はこれを見て `/` へ飛ばすので、盤も棋譜も unmount される。
   * 更新の失敗をここへ載せると、呼び手が出そうとした失敗が画面に出る前に消える。
   * 更新の失敗は戻り値で返し、`isLoading` は `settled` で降ろす。
   *
   * TODO(#249): `chooseRootDir` と `setLastPresetId` はまだここへ載せている
   */
  | { type: "error"; payload: string };

export type AppConfigContextType = ConfigState & {
  chooseRootDir: (opts?: ChooseOpts) => Promise<string | null>;
  /**
   * AI ライブラリを選ばせて、選んだ場所を返す。
   *
   * `Ok(null)` は取り消しで、設定は動いていない。失敗は `Err` で返し、`error` に積まない
   */
  chooseAiRoot: (opts?: ChooseOpts) => AsyncResult<string | null, string>;
  /**
   * ワークスペースを差し替える。
   *
   * ルート改名の経路はディスク上の改名を済ませてからここへ来る。`Err` を見落とすと
   * 「ディスクは新しい名前、設定は古い名前」で固定される
   */
  setRootDir: (rootDir: string) => AsyncResult<void, string>;
  setLastPresetId: (presetId: PresetId | null) => Promise<void>;
  /**
   * 表示の設定のうち、渡した欄だけを差し替える。
   *
   * 呼び手に `AppConfig` を組ませない。`save_config` はファイルごと置き換えるので、
   * 呼び手が知らない欄を `undefined` で書き潰す。
   */
  setDisplayConfig: (patch: DisplayConfigPatch) => AsyncResult<void, string>;
};
