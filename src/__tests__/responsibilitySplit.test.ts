import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./walk";

/**
 * 「責任の切れ目」は**同じ節が2箇所にある**。状態遷移表
 * （`docs/state-transitions/game-session.md`）と、その対象である Rust の
 * module doc（`src-tauri/src/engine/game/session.rs`）。
 *
 * **片方だけ直る。** #354 のレビューでは、同じ PR の中で2度それが起きた——
 * 1巡目で TS 側と表を直し、Rust の写しが古い列挙のまま残り、
 * 2巡目でそれを直したときに表の1文がまた別方向へずれた。
 * 節が「フロントが何を持つか」を列挙するものなので、ずれると
 * **Rust を読む人と表を読む人が別の設計を前提にする**。
 *
 * ここが見るのは列挙されたファイル名の集合だけ。文章の言い回しは見ない
 * ——そこまで縛ると、同じことを2通りに書けなくなって節が育たない。
 */

/** 節の中で名指しされる TypeScript のファイル名（パスの深さは問わない） */
function namedSourceFiles(section: string): string[] {
  const names = [...section.matchAll(/[\w-]+\.ts\b/g)].map((m) => m[0]);
  return [...new Set(names)].sort();
}

/**
 * `heading` の行から、次の同じ高さの見出しまで。
 *
 * **見つからなければ投げる。** 見出しを改名したときに空文字を返すと、
 * 集合が両方とも空になって**緑のまま何も見ていない**状態になる。
 */
function sectionOf(text: string, heading: string, nextHeadingPattern: RegExp): string {
  const start = text.indexOf(heading);
  if (start < 0) throw new Error(`見出しが見つからない: ${heading}`);
  const rest = text.slice(start + heading.length);
  const end = rest.search(nextHeadingPattern);
  return end < 0 ? rest : rest.slice(0, end);
}

describe("責任の切れ目（表と Rust の module doc）", () => {
  test("同じファイルを名指ししている", () => {
    const table = readFileSync(
      join(REPO_ROOT, "docs", "state-transitions", "game-session.md"),
      "utf8",
    );
    const rust = readFileSync(
      join(REPO_ROOT, "src-tauri", "src", "engine", "game", "session.rs"),
      "utf8",
    );

    const inTable = namedSourceFiles(sectionOf(table, "\n## 責任の切れ目\n", /\n## /));
    const inRust = namedSourceFiles(sectionOf(rust, "\n//! # 責任の切れ目\n", /\n(?!\/\/!)/));

    expect(inTable.length).toBeGreaterThan(0);
    expect(
      inRust,
      ["表と Rust の module doc が名指すファイルが違う", `表: ${inTable}`, `Rust: ${inRust}`].join(
        "\n",
      ),
    ).toEqual(inTable);
  });
});
