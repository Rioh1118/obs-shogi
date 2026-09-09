import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { docsPath, markdownFiles } from "./stateTransitionIndex";
import { noteReport } from "./tableNotes";

/**
 * **状態遷移表の注（`※N`）が、指し先として使える形か。**
 *
 * 表は「本文が `※N` で指し、下の注が答える」形で書かれている。崩れると読み手は
 * 指し先へ飛べないか、別の話を読む。注を消しても、指している側は静かに残る。
 *
 * 内容の正しさは見ていない。**「指し先が在る」まで。**
 *
 * **昇順は見ない。** 走査すると5つの表が昇順でないので、規約として立っていない。
 */
describe("状態遷移表の注", () => {
  const tables = () => markdownFiles().filter((f) => f.startsWith("state-transitions/"));

  /** 0件を見て緑になる形を止める */
  test("注を拾えている", () => {
    const total = tables().reduce(
      (n, rel) => n + noteReport(readFileSync(docsPath(rel), "utf8")).defined.length,
      0,
    );

    expect(total).toBeGreaterThan(10);
  });

  test("存在しない注を指していない", () => {
    const broken = tables().flatMap((rel) => {
      const { danglingRefs } = noteReport(readFileSync(docsPath(rel), "utf8"));
      return danglingRefs.map((n) => `${rel}: ※${n} を指しているが、定義が無い`);
    });

    expect(broken, "注を消したら、指している側も直すこと").toEqual([]);
  });
});

/** 走査器そのものを固定する */
describe("noteReport", () => {
  test("行頭を定義、それ以外を参照として数える", () => {
    const r = noteReport("| セル ※1 |\n\n※1 説明\n");
    expect(r.defined).toEqual([1]);
    expect(r.danglingRefs).toEqual([]);
  });

  test("定義の無い参照を返す", () => {
    expect(noteReport("本文 ※6 を見る\n\n※1 説明\n").danglingRefs).toEqual([6]);
  });

  test("注の本文からの前方参照も参照に数える", () => {
    expect(noteReport("※1 くわしくは（※2）\n※2 説明\n").danglingRefs).toEqual([]);
    // 定義が無ければ前方参照でも落とす
    expect(noteReport("※1 くわしくは（※9）\n").danglingRefs).toEqual([9]);
  });
});
