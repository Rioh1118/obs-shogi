import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, rustRoots, sourceFiles, tsFiles } from "./walk";

/**
 * **画面の文字列に、`docs/spec/design-language.md` の「使わない語」を書かない**（ADR-0012）。
 *
 * **語の一覧は表から引く**（写しにしない）。表は辞書形で書いてあるので、活用と別の意味の除外は
 * `SPELLINGS` が持ち、表と `SPELLINGS` の語の過不足はこの検査が赤にする。表に語を足した人は
 * 綴りも足すことになるので、表だけが増えて走査が黙る形にならない。
 *
 * 見るのは TS の文字列リテラル・テンプレート・JSX の文字と、Rust の文字列。コメントは見ない。
 * `console.*` と Rust のログ・`expect` の文字列は画面に出ないので外す（AC-65 の「ログへ出す文」）。
 */

/**
 * 表の語 → 画面で探す綴り。
 *
 * 語より狭い綴りには理由を添える。**広げると、同じ字の別の語を巻き込む。**
 */
const SPELLINGS: Record<string, RegExp> = {
  解析: /解析/,
  // 「索引に入れる」「入れ替える」「最新版を入れ直す」は欄に打つ意味ではない
  入れる: /(名前|数値?|AI名|文字)(を|で)入れ/,
  // 「駒を打つ」は将棋の語
  打つ: /(文字|名前|数値?)を打/,
  記入する: /記入/,
  // 「選んでいるプリセット」は状態で、表が止めるのは文の依頼だけ
  選ぶ: /選(んでください|び直してください|ぶこと|び直すこと)/,
  確かめる: /確かめ/,
  登録: /登録/,
  クリックする: /クリック/,
  起動し直す: /起動し直/,
  起こし直す: /起こし直/,
  再試行: /再試行/,
  リトライ: /リトライ/,
  ロード: /(?<!ダウン|アップ)ロード/,
  読込: /読込/,
  探す: /探(す|し|せ)/,
  スキャン: /スキャン/,
  再スキャン: /再スキャン/,
  探し直す: /探し直/,
  破棄: /破棄/,
  やめる: /やめ(る|た|ま)/,
  // 「行き止まり」は定跡の語
  止める: /(?<!行き)止(め|ま)/,
  停止する: /停止/,
  // 「取り消す」は使う語の方
  消す: /(?<!取り)消(す|し|え)/,
  // 「除外する」は別の語
  外す: /(?<!除)外(す|し)/,
  元に戻す: /元に戻して/,
  作る: /(?<![操動])作(る|っ|り|れ|ら)/,
  新規作成: /新規作成/,
  既定: /既定/,
  デフォルト: /デフォルト/,
  // 文字そのものを指す文は `EXCEPTIONS` に並べる
  パス: /パス(?!ワード)/,
  "AI ルート": /AI ?ルート/,
  "AI のフォルダ": /AI ?のフォルダ/,
  "AI の置き場": /AI ?の置き場/,
  オプション: /オプション/,
  プリファレンス: /プリファレンス/,
  ディレクトリ: /ディレクトリ/,
  フォルダー: /フォルダー/,
  ルート: /ルート/,
  ルートディレクトリ: /ルートディレクトリ/,
  // 「候補手の数」「手数」は使う語の方。表が止めるのは欄の値を指す「数」だけ
  数: /数(を|で)入力/,
  数字: /数字/,
  プロセス: /プロセス/,
  止める条件: /止める条件/,
  ベストムーブ: /ベストムーブ/,
  MultiPV: /MultiPV/,
  PV: /\bPV\b/,
  スコア: /スコア/,
  深度: /深度/,
  探索局面: /探索局面/,
  局面数: /局面数/,
  解析モード: /解析モード/,
  // 機能の名前としての「詰み」。終局の理由の「詰み」と字が同じなので、機能の語の形だけを見る
  詰み: /詰み(検索|機能)/,
  エンジンの設定: /エンジンの設定/,
  詳細設定: /詳細設定/,
  // `eval/` `<AI名>/eval` はフォルダの綴りで、画面に出す名前ではない
  eval: /(?<![/\w])eval\b(?!\/)/,
  // 英語の綴りも同じ語。`BookFile` のような名前は語の境界で外れる
  ブック: /ブック|\bBook\b/,
  初期局面: /初期局面/,
  黒: /黒(番|の手番)/,
  白: /白(番|の手番)/,
};

/** 綴りには当たるが、表の語の意味ではないもの。ファイルと文字列の一部で指す。`why` は読み手のため */
const EXCEPTIONS: ReadonlyArray<{ word: string; file: string; text: string; why: string }> = [
  ...["engineNotices.ts:のパスに", "EngineOptionInput.tsx:欄にパスを", "AiLibraryTab.tsx:パスをコピー"]
    .concat(["open.rs:定跡のパスが空", "open.rs:定跡のパスに", "open.rs:定跡のパスは"])
    .map((spot) => {
      const [file, text] = spot.split(":");
      return { word: "パス", file, text, why: "場所でなく文字そのものを指す。表が許す使い方" };
    }),
  {
    word: "MultiPV",
    file: "multiPv.ts",
    text: "MultiPV",
    why: "エンジンへ送る名前。画面の語でない",
  },
  {
    word: "MultiPV",
    file: "option_labels.rs",
    text: "MultiPV",
    why: "エンジンの名前を引く鍵。画面の語は隣の列",
  },
  { word: "eval", file: "fileChoices.ts", text: "eval", why: "コードの種類の綴り" },
  { word: "eval", file: "profile.rs", text: "eval", why: "フォルダの綴り" },
  {
    word: "局面数",
    file: "BookControls.tsx",
    text: "局面数は",
    why: "定跡に載っている局面の数で、探索の語ではない",
  },
];

/** 表の「使わない語」の列 */
function bannedWords(): string[] {
  const doc = readFileSync(`${REPO_ROOT}/docs/spec/design-language.md`, "utf8");
  const lines = doc.split("\n");
  const words = lines.flatMap((line, i) => {
    if (!/^\|.*使わない語\s*\|$/.test(line)) return [];
    const rows = lines.slice(i + 2);
    const end = rows.findIndex((row) => !row.startsWith("|"));
    return rows.slice(0, end).flatMap((row) => {
      const cells = row.split("|").map((cell) => cell.trim());
      return cells[cells.length - 2].split("、");
    });
  });
  return [
    ...new Set(
      words.map((word) => word.replace(/（.*$/, "").replace(/`/g, "").trim()).filter(isWord),
    ),
  ];
}

function isWord(word: string): boolean {
  return word !== "" && word !== "—";
}

/** 本番の Rust。テスト専用の crate とテストのファイルは画面の文字列を持たない */
function rustFiles(): string[] {
  return rustRoots()
    .flatMap((root) => sourceFiles(root))
    .filter((f) => f.endsWith(".rs") && !/test-support|\/tests?\.rs$|\/tests\//.test(f));
}

/** TS の、画面に出る可能性のある文字列。`console.*` の引数は外す */
function tsScreenStrings(file: string): string[] {
  const body = readFileSync(file, "utf8");
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, body, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isCallExpression(node) && node.expression.getText(source).startsWith("console.")) return;
    const isText =
      ts.isStringLiteralLike(node) ||
      ts.isJsxText(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node);
    if (isText) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** ボタンの語。`<Button>` と `<button>` の文字、`*Label` の属性、語を持つ `Label` の欄 */
function tsButtonLabels(file: string): string[] {
  const body = readFileSync(file, "utf8");
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, body, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const texts = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) found.push(node.text.trim());
    ts.forEachChild(node, texts);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && /^(Button|button)$/.test(node.openingElement.tagName.getText(source))) {
      node.children.forEach(texts);
    }
    if (ts.isJsxAttribute(node) && node.initializer && /(^l|L)abel$/.test(node.name.getText(source))) {
      texts(node.initializer);
    }
    if (ts.isPropertyAssignment(node) && /(^l|L)abel$/.test(node.name.getText(source))) {
      texts(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Rust の字句を、コメントと文字列の順に読むだけの1本の式。文字列の中の `//` を切らないため */
const RUST_TOKEN = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'"'|r#*"[\s\S]*?"#*|"(?:[^"\\]|\\[\s\S])*"/g;

/** 文字列の直前がこの形なら、画面ではなくログか開発者への文 */
const RUST_NOT_SCREEN =
  /(?:expect|panic!|unreachable!|assert\w*!|debug_assert\w*!|\b(?:log::)?(?:trace|debug|info|warn|error)!|e?println!)\s*\(\s*$|must_use\s*=\s*$/;

/** Rust の文字列。`#[cfg(test)]` の `mod` から先は見ない（関数に付いた属性では切らない） */
function rustScreenStrings(body: string): string[] {
  const start = body.search(/#\[cfg\(test\)\]\s*(pub(\(\w+\))?\s+)?mod\b/);
  const code = start >= 0 ? body.slice(0, start) : body;
  return [...code.matchAll(RUST_TOKEN)]
    .filter((m) => m[0].startsWith('"'))
    .filter((m) => !RUST_NOT_SCREEN.test(code.slice(Math.max(0, m.index - 40), m.index)))
    .map((m) => m[0].slice(1, -1).replace(/\\\n\s*/g, ""))
    .filter((text) => !text.startsWith("["));
}

function offenses(texts: string[], rel: string): string[] {
  return texts.flatMap((text) =>
    Object.entries(SPELLINGS)
      .filter(([, spelling]) => spelling.test(text))
      .filter(
        ([word]) =>
          !EXCEPTIONS.some(
            (e) => e.word === word && rel.endsWith(e.file) && text.includes(e.text),
          ),
      )
      .map(([word]) => `${rel}: 「${word}」: ${text.replace(/\s+/g, " ")}`),
  );
}

describe("画面の文字列に使わない語を書かない", () => {
  it("表の語と綴りの一覧に過不足が無い", () => {
    const words = bannedWords();
    // 走査が空振りして「0件」になったことを「違反が無い」と読ませない
    expect(words.length, "表から語を拾えていない").toBeGreaterThan(40);
    expect(words).toContain("解析");
    expect(Object.keys(SPELLINGS).sort()).toEqual([...words].sort());
  });

  it("TS と Rust の文字列に残っていない", () => {
    const files = tsFiles(SRC, { includeTests: false }).filter((f) => !/\.test\.tsx?$/.test(f));
    const rust = rustFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(rust.length).toBeGreaterThan(50);
    const found = [
      ...files.flatMap((f) => offenses(tsScreenStrings(f), relative(REPO_ROOT, f))),
      ...rust.flatMap((f) =>
        offenses(rustScreenStrings(readFileSync(f, "utf8")), relative(REPO_ROOT, f)),
      ),
    ];
    expect(found, "`docs/spec/design-language.md` の用語表の左の語へ揃えること").toEqual([]);
  });

  it("ボタンの語に「〜する」を付けない", () => {
    const files = tsFiles(SRC, { includeTests: false }).filter((f) => !/\.test\.tsx?$/.test(f));
    const found = files.flatMap((f) =>
      tsButtonLabels(f)
        .filter((text) => text.endsWith("する"))
        .map((text) => `${relative(REPO_ROOT, f)}: ${text}`),
    );
    expect(found, "漢語のボタンは体言止めにすること（`design-language.md`「文の型」）").toEqual([]);
  });

  it("省略記号は `…` 1文字にする", () => {
    const files = tsFiles(SRC, { includeTests: false }).filter((f) => !/\.test\.tsx?$/.test(f));
    const found = files.flatMap((f) =>
      tsScreenStrings(f)
        .filter((text) => /[ぁ-んァ-ヶ一-龠]\.\.\./.test(text))
        .map((text) => `${relative(REPO_ROOT, f)}: ${text}`),
    );
    expect(found).toEqual([]);
  });

  it("例外はどれも現物に残っている", () => {
    const files = tsFiles(SRC, { includeTests: false });
    const texts = [
      ...files.flatMap(tsScreenStrings),
      ...rustFiles().flatMap((f) => rustScreenStrings(readFileSync(f, "utf8"))),
    ];
    const stale = EXCEPTIONS.filter((e) => !texts.some((text) => text.includes(e.text)));
    expect(stale, "消えた文の例外は外すこと").toEqual([]);
  });

  it("綴りの拾い方そのもの", () => {
    const hits = (text: string) =>
      Object.entries(SPELLINGS)
        .filter(([, s]) => s.test(text))
        .map(([w]) => w);
    expect(hits("行き止まり")).toEqual([]);
    expect(hits("待っている操作を取り消す")).toEqual([]);
    expect(hits("索引に入れられなかった棋譜")).toEqual([]);
    expect(hits("ダウンロード中…")).toEqual([]);
    expect(hits("選んでいるプリセット")).toEqual([]);
    expect(hits("<AI名>/eval に nn.bin")).toEqual([]);
    expect(hits("読み筋の候補手の数")).toEqual([]);
    expect(hits("解析")).toEqual(["解析"]);
    expect(hits("権限を確かめてください")).toEqual(["確かめる"]);
    expect(hits("eval が未検出です")).toEqual(["eval"]);
    expect(hits("Book")).toEqual(["ブック"]);
    expect(hits("BookFile")).toEqual([]);
  });

  it("Rust の文字列の拾い方そのもの", () => {
    const body = [
      'let a = "画面の文"; // "コメント"',
      'let b = "続く\\',
      '    文";',
      'x.expect("開発者の文");',
      'log::warn!("ログの文");',
      'let c = "[build] ログの札";',
      '#[cfg(test)]',
      'mod tests { const D: &str = "テストの文"; }',
    ].join("\n");
    expect(rustScreenStrings(body)).toEqual(["画面の文", "続く文"]);
  });
});
