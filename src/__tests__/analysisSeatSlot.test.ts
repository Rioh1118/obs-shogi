import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./walk";
import { codeOf } from "./sourceText";

/**
 * 解析の席を返す「枠」を書き換えてよいのは、`useEngineSeat` の `holdSlot` の中だけ。
 *
 * `useEngineSeat` は飛んでいる返却を1枠（`releasingRef`）で持ち、後から来た口は
 * その後ろに並ぶ。**空けてよいのは自分がまだその枠に居るときだけ**で、無条件に
 * 空けると、並んだ側が枠から消え、次に来た返却が「誰も居ない」と読んで
 * 同じ席へ2本目を並列で撃つ。
 *
 * **この規約は振る舞いのテストが持てない。** 枠への書き込みを1箇所ずつ無条件の
 * 代入へ変異させても、落ちるテストは1本しかない（3本の返却が重なる筋を組まないと
 * 差が出ない）。差が出ないものを人の目で守り続けることになるので、綴りで止める。
 *
 * **同じ理由でもう1つ見る**——`useEngineSeat` は返す口を初回の描画で凍らせる
 * （`apiRef`）。早期 return より上に `useRef` 以外の宣言を置くと、そこで読んだ値が
 * 初回のまま凍り、描画ごとに変わる値を読んだ人はそれに気づけない。
 *
 * **見るのは形だけ。** `holdSlot` の中身が正しいかは見ない。
 */
const SEAT = "src/entities/analysis/model/useEngineSeat.ts";

/** 枠への書き込み。読み出し（`=== ` / `if (releasingRef.current)`）は数えない */
const WRITE = /releasingRef\.current\s*=[^=]/g;

describe("解析の席を返す枠", () => {
  test("枠に書くのは holdSlot の中だけ", () => {
    const code = codeOf(readFileSync(join(REPO_ROOT, SEAT), "utf8"));

    const holdSlot = /const holdSlot = \(run[\s\S]*?\n {2}\};/.exec(code);
    expect(
      holdSlot,
      `${SEAT}: \`holdSlot\` が見つからない（この検査の前提が崩れている）`,
    ).not.toBeNull();

    const inside = holdSlot![0].match(WRITE)?.length ?? 0;
    const total = code.match(WRITE)?.length ?? 0;

    expect(inside, `${SEAT}: \`holdSlot\` が枠に書いていない`).toBe(2);
    expect(total, `${SEAT}: \`holdSlot\` の外から枠に書いている`).toBe(inside);
  });

  test("凍る前に置くのは useRef だけ", () => {
    const code = codeOf(readFileSync(join(REPO_ROOT, SEAT), "utf8"));

    const head = code.slice(
      code.indexOf("export function useEngineSeat"),
      code.indexOf("if (apiRef.current) return apiRef.current;"),
    );

    expect(head, `${SEAT}: 早期 return が見つからない（この検査の前提が崩れている）`).not.toBe("");

    // **`useRef(` を含まない宣言を数える。** 名前だけを見ると、この検査が
    // いちばん止めたい形——`const { isReady } = useEngine();` のような
    // 分割代入——が素通りする。
    const offenders = (head.match(/^ {2}(?:const|let|var)\b[^\n]*/gm) ?? []).filter(
      (line) => !/\buseRef\s*[<(]/.test(line),
    );

    expect(offenders, `${SEAT}: 早期 return より上に useRef 以外の宣言がある`).toEqual([]);
  });
});
