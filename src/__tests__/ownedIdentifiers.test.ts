import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { docsPath, markdownFiles } from "./stateTransitionIndex";
import { commentsOf } from "./sourceText";
import { indexOf, missingRefs, ownedRefsIn } from "./ownedIdentifiers";
import { REPO_ROOT, SRC, sourceFiles } from "./walk";

/**
 * **「`X` の `y`」で指した綴りが実在するか。**
 *
 * 改名すると、定義は消えているのにこの形の参照だけが残る。同じ綴りが別の意味で
 * 他所に在ると grep でも気づけないので、読み手は「所有者を間違えた」のか
 * 「名前が古い」のかを判断できない。
 *
 * **`docsIdentifiers` はこの形を1つも見ていない。** あちらは表の記号を除くために
 * 下線を要求するので、camelCase の改名跡は候補にすら入らない（あちらの doc の「限界」2番）。
 *
 * 見るのは `docs/**` と `src/**` のコメントの両方。所有者付きの参照はどちらにも在る。
 */
describe("「`X` の `y`」で指した綴り", () => {
  const docFiles = () => markdownFiles();
  /**
   * **この検査自身は走査しない。** 本体とこのファイルは「`X` の `y`」という
   * 形そのものと、改名跡の例（`FileNode` の `isActive`）を doc に書くので、
   * 自分を読むと**書式の説明を参照として拾う**。
   */
  const srcFiles = () =>
    sourceFiles(SRC, { includeTests: true }).filter((p) => !/ownedIdentifiers\.(ts|test\.tsx?)$/.test(p));

  /** 0件を見て緑になる形を止める（走査が壊れても落ちない、を防ぐ） */
  test("参照を拾えている", () => {
    const fromDocs = docFiles().flatMap((rel) => ownedRefsIn(readFileSync(docsPath(rel), "utf8")));
    const fromSrc = srcFiles().flatMap((path) =>
      ownedRefsIn(commentsOf(readFileSync(path, "utf8"))),
    );

    expect(fromDocs.length + fromSrc.length).toBeGreaterThan(5);
  });

  test("所有者の側に無い綴りを指していない", () => {
    const broken = [
      ...docFiles().flatMap((rel) =>
        missingRefs(ownedRefsIn(readFileSync(docsPath(rel), "utf8"))).map(
          ({ owner, member }) => `docs/${rel}: \`${owner}\` の \`${member}\``,
        ),
      ),
      ...srcFiles().flatMap((path) =>
        missingRefs(ownedRefsIn(commentsOf(readFileSync(path, "utf8")))).map(
          ({ owner, member }) => `${relative(REPO_ROOT, path)}: \`${owner}\` の \`${member}\``,
        ),
      ),
    ];

    expect(broken, "改名したら、所有者を添えて指している側も直すこと").toEqual([]);
  });
});

/** 走査器そのものを固定する。合成した入力を食わせて、判定だけを見る */
describe("ownedRefsIn", () => {
  test("「の」で繋がった対を拾う", () => {
    expect(ownedRefsIn("関門（`FileNode` の `isActive`）を通る")).toEqual([
      { owner: "FileNode", member: "isActive" },
    ]);
  });

  test("括弧付きの呼び出しも拾う", () => {
    expect(ownedRefsIn("`GameProvider` の `resetGame()` が撃たれる")).toEqual([
      { owner: "GameProvider", member: "resetGame" },
    ]);
  });

  test("「の」で繋がっていないバッククォートは拾わない", () => {
    expect(ownedRefsIn("`state` と `error` を見る")).toEqual([]);
  });

  test("識別子の形でないものは拾わない", () => {
    expect(ownedRefsIn("`docs/spec` の `画面ごと`")).toEqual([]);
  });

  test("同じ対は1度だけ返す", () => {
    expect(ownedRefsIn("`A` の `b`。もう一度 `A` の `b`")).toHaveLength(1);
  });
});

describe("missingRefs", () => {
  const index = indexOf({ FileNode: "const canSkipReopen = true;" });

  test("所有者の側に在る綴りは返さない", () => {
    expect(missingRefs([{ owner: "FileNode", member: "canSkipReopen" }], index)).toEqual([]);
  });

  /**
   * **これがこの検査の本体。** `isActive` は他の部品が別の意味で持っているので、
   * repo 全体を1つの文字列として見ると素通りする（`docsIdentifiers` の「限界」1番）。
   * 所有者に絞ると捕まる。
   */
  test("他所に同じ綴りが在っても、所有者の側に無ければ返す", () => {
    const withOther = indexOf({
      FileNode: "const canSkipReopen = true;",
      KifuMoveCard: "const isActive = true;",
    });

    expect(missingRefs([{ owner: "FileNode", member: "isActive" }], withOther)).toEqual([
      { owner: "FileNode", member: "isActive" },
    ]);
  });

  /** 所有者を引けない対は見ない。外部の名前を指す書き方が実在する */
  test("所有者が索引に無ければ返さない", () => {
    expect(missingRefs([{ owner: "SButton", member: "subtle" }], index)).toEqual([]);
  });

  /** 部分一致で見ると、消えた名前が別の綴りの一部として「実在する」に戻る */
  test("接尾辞を足した綴りでは実在と見なさない", () => {
    const other = indexOf({ X: "function loadGame() {}" });
    expect(missingRefs([{ owner: "X", member: "load" }], other)).toEqual([
      { owner: "X", member: "load" },
    ]);
  });
});
