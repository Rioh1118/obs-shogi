/**
 * 候補手の見せ方。**ビューではなく表示モード**（ADR-0010 決定2）。
 *
 * 出すデータはどれも同じで、違うのは並べ方だけ。ビューにすると列を1本足すたびに
 * 3回設計することになり、タブ一覧がほとんど同じ名前で埋まる。
 */
export type AnalysisDisplayMode = "rows" | "table";

type DisplayModeMeta = {
  key: AnalysisDisplayMode;
  /** 選択肢の見出し */
  label: string;
  /** 何が読めるようになるか。見本の下に1行で添える */
  hint: string;
};

/**
 * 綴りごとの素性。**`Record` にしてあるので、`AnalysisDisplayMode` を1つ足して
 * ここへ足さないと tsc が落ちる。**
 *
 * 配列で持つと網羅が閉じない —— `satisfies readonly DisplayModeMeta[]` が見るのは
 * 「並んでいる行の綴りが型に在るか」だけで、逆向きは見ない。落とした綴りは
 * `resolveAnalysisDisplayMode` が既定へ落とすので、**設定にも出ないまま黙る。**
 */
const SPECS = {
  table: { label: "表", hint: "評価値と読み筋が列で揃う" },
  rows: { label: "行", hint: "1手1行で詰める" },
} as const satisfies Record<AnalysisDisplayMode, Omit<DisplayModeMeta, "key">>;

/** 並びが設定の選択肢の並び（`SPECS` の宣言順） */
export const ANALYSIS_DISPLAY_MODES: readonly DisplayModeMeta[] = Object.keys(SPECS).map((key) => {
  // `Object.keys` は `string[]` を返す。鍵の集合は `SPECS` の型が閉じているので、
  // ここで名乗り直しても綴りが増えることはない
  const modeKey = key as AnalysisDisplayMode;
  return { key: modeKey, ...SPECS[modeKey] };
});

/** 既定。**表** —— 列が意味を持つので、評価値と読み筋を目で揃えられる */
const DEFAULT_MODE: AnalysisDisplayMode = "table";

/**
 * 設定に残っている綴りを表示モードに直す。**知らない綴りは既定へ落とす。**
 *
 * 設定ファイルは利用者も前の版も書くので、`AppConfig` の欄をそのまま
 * `AnalysisDisplayMode` として名乗らせない。
 */
export function resolveAnalysisDisplayMode(saved: string | null | undefined): AnalysisDisplayMode {
  const found = ANALYSIS_DISPLAY_MODES.find((m) => m.key === saved);
  return found ? found.key : DEFAULT_MODE;
}
