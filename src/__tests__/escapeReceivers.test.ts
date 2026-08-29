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
 *
 * **見るのは `"Escape"` を含む関数本体。** JSX の属性の字面で切ると
 * `onKeyDown={handleKeyDown}` のように本体を外へ出した形が丸ごと外れる。
 * `window.addEventListener("keydown", ...)` の形も同じ理由で入れる。
 */

/** モーダルの外にいて、上位の受け口を持たないもの */
const ALLOWED = new Map([
  [
    "src/widgets/file-tree/ui/InlineNameEditor.tsx",
    "ツリーの行の上の入力欄。モーダルの中には入らず、Escape は自分で閉じる",
  ],
]);

/** コメントの中の言及を呼び出しと数えない */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * 文字列・テンプレートリテラルの中身を空白に潰す。
 *
 * 潰さないと、`const brace = "}"` の1行で波括弧の対応がずれ、
 * その先の `stopPropagation()` が本体から外れて**違反が緑で通る**
 */
function blankStrings(code: string): string {
  const out = code.split("");
  let quote: string | null = null;
  for (let i = 0; i < out.length; i += 1) {
    const c = out[i];
    if (quote) {
      if (c === "\\") {
        out[i] = " ";
        if (i + 1 < out.length) out[i + 1] = " ";
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      else if (c !== "\n") out[i] = " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
  }
  return out.join("");
}

/**
 * `at` を含む、最も内側の `{ ... }` の中身。
 *
 * 前へ向かって対応の取れていない `{` を探し、そこから対応する `}` まで取る。
 * 数える対象は `blankStrings` を通した文字列なので、リテラルの中の括弧は数えない
 */
function enclosingBlock(code: string, at: number): string | null {
  const scan = blankStrings(code);
  let depth = 0;
  let open = -1;
  for (let i = at; i >= 0; i -= 1) {
    const c = scan[i];
    if (c === "}") depth += 1;
    else if (c === "{") {
      if (depth === 0) {
        open = i;
        break;
      }
      depth -= 1;
    }
  }
  if (open < 0) return null;

  depth = 0;
  for (let i = open; i < scan.length; i += 1) {
    const c = scan[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  return null;
}

describe("Escape の受け口", () => {
  it("stopPropagation で握り潰していない", () => {
    const files = tsFiles(SRC, { includeTests: false });
    expect(files.length, "走査できていない").toBeGreaterThan(100);

    const offenders: string[] = [];
    let receivers = 0;

    for (const file of files) {
      const name = relative(REPO_ROOT, file);
      const source = stripComments(readFileSync(file, "utf8"));

      for (const match of source.matchAll(/"Escape"/g)) {
        const body = enclosingBlock(source, match.index);
        if (body === null) continue;
        receivers += 1;
        if (ALLOWED.has(name) || !body.includes("stopPropagation")) continue;
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${name}:${line}`);
      }
    }

    // 切り出しが壊れると0件で緑になる。実測に近い下限を置く
    expect(receivers, `Escape の受け口を ${receivers} 件しか拾えていない`).toBeGreaterThanOrEqual(
      8,
    );

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

  // 切り出しが壊れると、件数は増えたまま違反だけが消える。
  // 既知の違反の形を渡して、拾えることを直に見る
  it("文字列の中の波括弧で切り口がずれない", () => {
    const source = [
      "const handleKeyDown = (e) => {",
      '  if (e.key !== "Escape") return;',
      '  const brace = "}";',
      "  e.stopPropagation();",
      "};",
    ].join("\n");

    const at = source.indexOf('"Escape"');
    const body = enclosingBlock(source, at);

    expect(body, "本体を切り出せていない").not.toBeNull();
    expect(body).toContain("stopPropagation");
  });

  it("ALLOWED に並ぶファイルが実在する", () => {
    const files = new Set(tsFiles(SRC).map((file) => relative(REPO_ROOT, file)));
    for (const name of ALLOWED.keys()) {
      expect(files.has(name), `ALLOWED: ${name} が無い`).toBe(true);
    }
  });
});
