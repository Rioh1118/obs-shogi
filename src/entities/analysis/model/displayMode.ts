/**
 * 候補手の見せ方
 *
 * ビューではなく表示モードにする（ADR-0010 決定2）。出すデータは同じで並べ方だけが違うので、
 * ビューにすると列を1本足すたびに3回設計し、タブ一覧が似た名前で埋まる。
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
 * 表示モードごとの見出しと説明
 *
 * `Record` にして、`AnalysisDisplayMode` に足した綴りの書き忘れを tsc に落とさせる。配列の
 * `satisfies` は並んだ行が型に在るかしか見ない。書き忘れた綴りは `resolveAnalysisDisplayMode` が
 * 既定へ変えるので、設定にも出ないまま黙る。
 */
const SPECS = {
  table: { label: "表", hint: "評価値と読み筋が列で揃う" },
  rows: { label: "行", hint: "1手1行で詰める" },
} as const satisfies Record<AnalysisDisplayMode, Omit<DisplayModeMeta, "key">>;

/** 設定の選択肢。並びは `SPECS` の宣言順 */
export const ANALYSIS_DISPLAY_MODES: readonly DisplayModeMeta[] = Object.keys(SPECS).map((key) => {
  // `Object.keys` は `string[]` を返す。鍵の集合は `SPECS` の型が閉じている
  const modeKey = key as AnalysisDisplayMode;
  return { key: modeKey, ...SPECS[modeKey] };
});

/** 既定の表示モード。列が意味を持ち、評価値と読み筋を目で揃えられる */
const DEFAULT_MODE: AnalysisDisplayMode = "table";

/**
 * 設定に残っている綴りを表示モードに直す。知らない綴りは既定にする。
 *
 * 設定ファイルは利用者も前の版も書くので、`AppConfig` の欄をそのまま信用しない。
 */
export function resolveAnalysisDisplayMode(saved: string | null | undefined): AnalysisDisplayMode {
  const found = ANALYSIS_DISPLAY_MODES.find((m) => m.key === saved);
  return found ? found.key : DEFAULT_MODE;
}
