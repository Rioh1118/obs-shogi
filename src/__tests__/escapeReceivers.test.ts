import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, tsFiles } from "./walk";

/**
 * Escape を扱うキーハンドラで `stopPropagation()` を呼ばない。
 *
 * `Modal` は Escape を `document` のバブル段で聞き、内側が `preventDefault()` を
 * していれば降りる。`stopPropagation()` は `document` までイベントを届かせないので、
 * **`defaultPrevented` の判定にすら到達しない**。内側が「消すものが無いときは
 * 閉じる」と書いていても、そこへ行き着く前に握り潰される。
 *
 * `Modal` の側では守れない（キャプチャ段へ戻すと今度は内側が Escape を使えなくなる）
 * ので、書き方の規約として機械で止める。
 *
 * 消費したいときは `e.preventDefault()`。消費しないなら何もしない。
 */

/** モーダルの外にいて、上位の受け口を持たないもの */
const ALLOWED = new Map([
  [
    "src/widgets/file-tree/ui/InlineNameEditor.tsx",
    "ツリーの行の上の入力欄。モーダルの中には入らず、Escape は自分で閉じる。" +
      "止めないとツリー側のキー操作が同時に走る",
  ],
]);

/** `onKeyDown` などのハンドラの本体。`"Escape"` を見ているものだけを対象にする */
const HANDLER = /on(?:KeyDown|KeyUp|KeyPress)=\{([\s\S]*?)\n\s*\}\}/g;

/** コメントの中の言及を呼び出しと数えない */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("Escape の受け口", () => {
  it("stopPropagation で握り潰していない", () => {
    const files = tsFiles(SRC, { includeTests: false });
    expect(files.length, "走査できていない").toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of files) {
      const name = relative(REPO_ROOT, file);
      if (ALLOWED.has(name)) continue;

      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(HANDLER)) {
        const body = stripComments(match[1]);
        if (!body.includes("Escape") || !body.includes("stopPropagation")) continue;
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${name}:${line}`);
      }
    }

    expect(
      offenders,
      [
        "Escape を扱うハンドラで stopPropagation() を呼んでいる。",
        "document まで届かないので、上のモーダルは defaultPrevented を見られない。",
        "消費するなら preventDefault()、しないなら何もしないこと。",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });
});
