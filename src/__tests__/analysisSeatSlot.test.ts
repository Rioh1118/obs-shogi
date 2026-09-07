import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./walk";
import { codeOf } from "./sourceText";

/**
 * 解析の席を返す「枠」を書き換えてよいのは、`useEngineSeat` の `occupy` の中だけ。
 *
 * `useEngineSeat` は飛んでいる返却を1枠（`releasingRef`）で持ち、後から来た口は
 * その後ろに並ぶ。**空けてよいのは自分がまだその枠に居るときだけ**で、無条件に
 * 空けると、並んだ側が枠から消え、次に来た返却が「誰も居ない」と読んで
 * 同じ席へ2本目を並列で撃つ。
 *
 * **この規約は振る舞いのテストが持てない。** 枠を口ごとに手書きしていた頃、
 * 6箇所を1つずつ無条件の代入へ変異させて `provider.test.tsx` を回すと、
 * 落ちるのは1箇所だけだった（残り5箇所は、3本が重なる筋を組まないと差が出ない）。
 * 差が出ないものを人の目で守り続けることになるので、綴りで止める。
 *
 * **見るのは書き込みの箇所数だけ。** `occupy` の中身が正しいかは見ない。
 */
const SEAT = "src/entities/analysis/model/useEngineSeat.ts";

/** 枠への書き込み。読み出し（`=== ` / `if (releasingRef.current)`）は数えない */
const WRITE = /releasingRef\.current\s*=[^=]/g;

describe("解析の席を返す枠", () => {
  test("枠に書くのは occupy の中だけ", () => {
    const code = codeOf(readFileSync(join(REPO_ROOT, SEAT), "utf8"));

    const occupy = /const occupy = \(run[\s\S]*?\n {2}\};/.exec(code);
    expect(
      occupy,
      `${SEAT}: \`occupy\` が見つからない（この検査の前提が崩れている）`,
    ).not.toBeNull();

    const inside = occupy![0].match(WRITE)?.length ?? 0;
    const total = code.match(WRITE)?.length ?? 0;

    expect(inside, `${SEAT}: \`occupy\` が枠に書いていない`).toBe(2);
    expect(total, `${SEAT}: \`occupy\` の外から枠に書いている`).toBe(inside);
  });
});
