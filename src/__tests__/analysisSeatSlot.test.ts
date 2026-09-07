import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./walk";
import { codeOf } from "./sourceText";

/**
 * 解析の席を返す「枠」を空けてよいのは、**自分がまだその枠に居るときだけ**。
 *
 * `useEngineSeat` は飛んでいる返却を1枠（`releasingRef`）で持ち、後から来た口は
 * その後ろに並ぶ。並んだ側は自分を枠に入れ直すので、**先に居た方が終わったときに
 * 無条件で枠を空けると、並んだ側が枠から消える**——次に来た返却が「誰も居ない」と
 * 読んで、同じ席へ2本目を並列で撃つ。
 *
 * **この規約は振る舞いのテストが持てない。** 枠を空ける6箇所を1つずつ
 * 無条件の代入へ変異させて `provider.test.tsx` を回すと、落ちるのは1箇所だけだった
 * （残り5箇所は、3本が重なる筋を組まないと差が出ない）。
 * 差が出ないものを人の目で守り続けることになるので、綴りで止める。
 *
 * **止めているのは形だけ。** 比較する相手の変数が正しいかまでは見ない。
 */
const SEAT = "src/entities/analysis/model/useEngineSeat.ts";

/** 枠を空ける綴り。`releasingRef.current = null` の全部 */
const CLEAR = /releasingRef\.current = null/g;

/** 許される唯一の形 */
const GUARDED = /if \(releasingRef\.current === \w+\) releasingRef\.current = null;/g;

describe("解析の席を返す枠", () => {
  test("枠を空けるのは、自分がまだ枠に居るときだけ", () => {
    const code = codeOf(readFileSync(join(REPO_ROOT, SEAT), "utf8"));

    const clears = code.match(CLEAR)?.length ?? 0;
    const guarded = code.match(GUARDED)?.length ?? 0;

    expect(clears, `${SEAT} が枠を空けていない（この検査の前提が崩れている）`).toBeGreaterThan(0);
    expect(guarded, `${SEAT}: 枠を無条件に空けている箇所がある`).toBe(clears);
  });
});
