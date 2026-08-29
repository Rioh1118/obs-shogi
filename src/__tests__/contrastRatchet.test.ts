import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { scssFiles } from "./walk";
import { collectVariables, scanContrast } from "./contrast";

/**
 * 基準を割っている文字と面の対。**増やさない。**
 *
 * 人の目では止まらない。文字と面は宣言する場所が離れるので、
 * 片方を測って直しても、同じコミットで作ったもう片方は測られないまま通る。
 *
 * ここに並ぶのは、まだ直していない既存の対 → issue #185。
 * 直したら**行ごと消す**。残したままにすると、直したことが検査から見えない。
 *
 * 鍵に行番号を入れないのは、無関係な行の増減でこの表が動かないようにするため。
 */
const BASELINE = [
  "features/position-navigation/ui/BranchCard.scss | &--selected | color: index.$color-text-light-1 | background: index.$color-secondary-dark",
  "features/position-navigation/ui/BranchCard.scss | .branch-selector__label | color: rgba(index.$color-text-light-1, 0.92) | background: rgba(index.$color-white, 0.1)",
  "features/position-navigation/ui/BranchCard.scss | .branch-selector__move-pill | color: index.$color-text-light-1 | background: rgba(index.$color-white, 0.14)",
  "features/study-positions-manager/ui/StudyPositionsManagerModal.scss | &__filterBadge | color: index.$color-white | background: index.$color-secondary-dark",
  "shared/ui/IconButton.scss | &--obs-primary | color: index.$color-text-light-1 | background-color: index.$color-secondary-dark",
  "shared/ui/IconButton.scss | &:hover:not(:disabled) | color: index.$color-white | background-color: index.$color-secondary-dark",
  "shared/ui/IconButton.scss | &:active:not(:disabled) | color: index.$color-secondary-dark | background-color: index.$color-secondary-dark-2",
  "widgets/analysis-pane/ui/AnalysisPaneHeader.scss | &--active | color: index.$color-secondary-dark | background-color: index.$color-primary-black",
  "widgets/file-tree/ui/ContextMenu.scss | &--danger | color: index.$color-secondary-dark | background: index.$color-primary-black",
  "widgets/file-tree/ui/ContextMenu.scss | &:hover:not(:disabled) | color: index.$color-secondary-dark | background-color: rgba(index.$color-secondary-dark, 0.22)",
  "widgets/file-tree/ui/ContextMenu.scss | &:active:not(:disabled) | color: index.$color-secondary-dark | background-color: rgba(index.$color-secondary-dark, 0.28)",
  "widgets/file-tree/ui/ContextMenu.scss | &:focus-visible:not(:disabled) | color: index.$color-secondary-dark | background-color: rgba(index.$color-secondary-dark, 0.22)",
];

const SRC = join(process.cwd(), "src");
const TOKEN_SOURCE = join(SRC, "index.scss");

type Row = { key: string; detail: string };

/**
 * 測れた対の下限。**下げない。**
 *
 * 割った対だけを見ていると、面を `rgba(..., 0.99)` にするだけで対が
 * 検査から静かに消え、テストは緑のまま通る。数えられていることそのものを
 * ここで固定する。増えたら上げる。
 *
 * **下げてよいのは、規則そのものを消したときだけ。** 面を半透明にして
 * 測れなくしたのなら、下げずに面の側を直すこと。
 */
const MEASURED_FLOOR = 52;

/**
 * `color` を宣言しているのに測れなかった宣言の上限。**上げない。**
 *
 * 測れないのは3つの場合。面が半透明のまま確定しない／色が解けない
 * （`currentColor` / `var()`）／`opacity` で薄める先の面が分からない。
 * **どれも「合格」ではない**ので、件数を目に見える形で置く。
 * 面を持たせるか `surface` を渡すかして測れるようにしたら下げる → issue #185。
 */
const UNMEASURED_CEILING = 406;

const rows: Row[] = [];
let measured = 0;
let unmeasured = 0;

beforeAll(() => {
  const vars = collectVariables(readFileSync(TOKEN_SOURCE, "utf8"));

  for (const file of scssFiles(SRC)) {
    const name = relative(SRC, file).split("\\").join("/");
    let scan;
    try {
      scan = scanContrast(readFileSync(file, "utf8"), { vars, from: file });
    } catch (error) {
      throw new Error(`${name} を解析できない: ${String(error)}`);
    }

    measured += scan.pairs.length;
    unmeasured += scan.unmeasured;

    for (const f of scan.pairs) {
      if (f.ratio >= f.threshold) continue;
      rows.push({
        key: `${name} | ${f.selector} | ${f.fg} | ${f.bg}`,
        detail: `${name}:${f.line} ${f.ratio.toFixed(2)}:1（基準 ${f.threshold}:1）`,
      });
    }
  }
});

describe("SCSS のコントラスト", () => {
  it("基準を割る対が増えていない", () => {
    const known = new Set(BASELINE);
    const added = rows.filter((r) => !known.has(r.key));

    expect(
      added.map((r) => r.detail),
      [
        "文字とその文字が載る面のコントラストが基準を割っている。",
        "面の色を動かすか、文字の色を動かすこと。ホバーや選択中の段も測ること",
        "（面だけを差し替えると、その段でだけ基準を割る）。",
        ...added.map((r) => `${r.detail}\n  ${r.key}`),
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * 何件測れているかを固定する。**この検査が無いと、割った対だけを見る限り
   * 「測るのをやめる」変更が緑で通る。** `Button.scss` の面を
   * `rgba(..., 0.99)` にするだけで主ボタンの4対が検査から消える。
   */
  it("測れた対が減っていない", () => {
    expect(
      measured,
      [
        `測れた対が ${MEASURED_FLOOR} 件から ${measured} 件に減った。`,
        "面を半透明にすると、その配下は「どの親に載るか」が決まらず測れなくなる。",
        "面を不透明にするか、scanContrast に surface を渡すこと。",
        `増えたなら MEASURED_FLOOR を ${measured} に上げること。`,
      ].join("\n"),
    ).toBe(MEASURED_FLOOR);
  });

  it("測れなかった宣言が増えていない", () => {
    expect(
      unmeasured,
      [
        `面が決まらず測れなかった color の宣言が ${UNMEASURED_CEILING} 件から ${unmeasured} 件になった。`,
        "「測れないから合格」を合格と数えないために置いてある枠。",
        `減らしたなら UNMEASURED_CEILING を ${unmeasured} に下げること。`,
      ].join("\n"),
    ).toBe(UNMEASURED_CEILING);
  });

  it("直した対が BASELINE に残っていない", () => {
    const found = new Set(rows.map((r) => r.key));
    const stale = BASELINE.filter((key) => !found.has(key));

    expect(
      stale,
      [
        "BASELINE に並んでいる対が、もう見つからない。",
        "直したなら、その行を BASELINE から消すこと。",
        "残したままにすると、直したことが検査から見えない。",
        ...stale,
      ].join("\n"),
    ).toEqual([]);
  });
});
