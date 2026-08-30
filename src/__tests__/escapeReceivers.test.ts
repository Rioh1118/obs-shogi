import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
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
 *
 * **本体の切り出しは TypeScript の parser に任せる。** 自前で字句を数えると、
 * 文字列・テンプレート・正規表現・JSX の `</` を1つずつ手当てすることになり、
 * 落とした1つが「その範囲の受け口が黙って走査から外れる」形で効く。
 * 偽陰性は件数が増えないだけなので、下限のガードでも拾えない。
 */

/** モーダルの外にいて、上位の受け口を持たないもの */
const ALLOWED = new Map([
  [
    "src/widgets/file-tree/ui/InlineNameEditor.tsx",
    "ツリーの行の上の入力欄。モーダルの中には入らず、Escape は自分で閉じる",
  ],
]);

function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** `"Escape"` そのもの。コメントや識別子の中の言及は parser が除く */
function escapeLiterals(root: ts.SourceFile): ts.Node[] {
  const found: ts.Node[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) && node.text === "Escape") found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);

  return found;
}

/**
 * `node` を含む、最も内側の関数の本体。
 *
 * 関数の外（モジュールの直下の表など）に書かれた `"Escape"` は受け口ではないので
 * `null` を返す。`const KEYS = { close: "Escape" }` がそれに当たる
 */
function enclosingFunctionBody(node: ts.Node): ts.Node | null {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (!ts.isFunctionLike(cur)) continue;
    // 本体を持つのは宣言の側だけ（`type F = () => void` のような
    // 署名だけの節点は `isFunctionLike` に入るが body を持たない）
    const body = (cur as ts.FunctionLikeDeclaration).body;
    if (body) return body;
  }
  return null;
}

/**
 * `x.stopPropagation()` を呼んでいるか。
 *
 * **字面で探さない。** 本体の字面にはコメントが含まれるので、
 * 「`stopPropagation()` にすると上位が死ぬので使わない」と**理由を書いた**
 * ハンドラが違反として挙がる。実際にこの検査を parser へ移した時点で、
 * 規約どおりに書かれた2件が偽陽性になった
 */
function callsStopPropagation(body: ts.Node): boolean {
  let found = false;

  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "stopPropagation"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);

  return found;
}

describe("Escape の受け口", () => {
  it("stopPropagation で握り潰していない", () => {
    const files = tsFiles(SRC, { includeTests: false });
    expect(files.length, "走査できていない").toBeGreaterThan(100);

    const offenders: string[] = [];
    let receivers = 0;

    for (const file of files) {
      const name = relative(REPO_ROOT, file);
      const root = parse(name, readFileSync(file, "utf8"));

      for (const literal of escapeLiterals(root)) {
        const body = enclosingFunctionBody(literal);
        if (body === null) continue;
        receivers += 1;
        if (ALLOWED.has(name) || !callsStopPropagation(body)) continue;

        const { line } = root.getLineAndCharacterOfPosition(literal.getStart());
        offenders.push(`${name}:${line + 1}`);
      }
    }

    // 切り出しが壊れると0件で緑になる。**下限は壊れ検出**なので現在値と
    // 一致させない。一致させると、受け口を正当に減らしたときにここが落ちる
    expect(receivers, `Escape の受け口を ${receivers} 件しか拾えていない`).toBeGreaterThanOrEqual(
      5,
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

  /**
   * 切り出しが壊れると、件数は増えたまま違反だけが消える。既知の違反の形を
   * 直に渡して拾えることを見る。
   *
   * 並べたのは、自前の字句解析で1つずつ落ちていった形。
   * 文字列の中の `}`、正規表現の中の引用符、JSX の `</`。
   */
  it("リテラルや JSX の字面で切り口がずれない", () => {
    const source = [
      "function Row() {",
      "  const handleKeyDown = (e) => {",
      '    const brace = "}";',
      '    const escaped = path.replace(/\\\\/g, "x").replace(/"/g, \'y\');',
      '    if (e.key !== "Escape") return;',
      "    e.stopPropagation();",
      "  };",
      "  return <div onKeyDown={handleKeyDown} />;",
      "}",
    ].join("\n");

    const root = parse("sample.tsx", source);
    const literals = escapeLiterals(root);

    expect(literals.length, "Escape を拾えていない").toBe(1);
    const body = enclosingFunctionBody(literals[0]);
    expect(body, "本体を切り出せていない").not.toBeNull();
    expect(callsStopPropagation(body!)).toBe(true);
  });

  /** コメントに書いた `stopPropagation()` を呼び出しと数えない */
  it("理由として書かれた stopPropagation を違反にしない", () => {
    const source = [
      "const handleKeyDown = (e) => {",
      "  // stopPropagation() にすると document まで届かないので使わない",
      '  if (e.key === "Escape") e.preventDefault();',
      "};",
    ].join("\n");

    const root = parse("sample.ts", source);
    const body = enclosingFunctionBody(escapeLiterals(root)[0]);

    expect(body).not.toBeNull();
    expect(callsStopPropagation(body!)).toBe(false);
  });

  /** 関数の外にある表の値は受け口ではない。数えると下限が意味を失う */
  it("関数の外の Escape は受け口と数えない", () => {
    const root = parse("sample.ts", 'const KEYS = { close: "Escape" };');
    const literals = escapeLiterals(root);

    expect(literals.length).toBe(1);
    expect(enclosingFunctionBody(literals[0])).toBeNull();
  });

  it("ALLOWED に並ぶファイルが実在する", () => {
    const files = new Set(tsFiles(SRC).map((file) => relative(REPO_ROOT, file)));
    for (const name of ALLOWED.keys()) {
      expect(files.has(name), `ALLOWED: ${name} が無い`).toBe(true);
    }
  });
});
