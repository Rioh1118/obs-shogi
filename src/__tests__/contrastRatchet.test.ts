import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { collectVariables, scanContrast } from "./contrast";

/**
 * 基準を割っている文字と面の対。**増やさない。**
 *
 * 人の目では止まらない。#169 のレビューでは、同じ穴が2ラウンド続けて別の場所から
 * 出た（主ボタンのホバー 4.02:1、確認の実行ボタン 4.47:1）。どちらも
 * 「片方を測って直したが、同じコミットで作ったもう片方は測っていない」だった。
 *
 * ここに並ぶのは #169 の差分の外にあるもの → issue #185。
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

function scssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return scssFiles(path);
    return entry.name.endsWith(".scss") ? [path] : [];
  });
}

type Row = { key: string; detail: string };

const rows: Row[] = [];

beforeAll(() => {
  const vars = collectVariables(readFileSync(TOKEN_SOURCE, "utf8"));

  for (const file of scssFiles(SRC)) {
    const name = relative(SRC, file).split("\\").join("/");
    let findings;
    try {
      findings = scanContrast(readFileSync(file, "utf8"), { vars, from: file });
    } catch (error) {
      throw new Error(`${name} を解析できない: ${String(error)}`);
    }

    for (const f of findings) {
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
