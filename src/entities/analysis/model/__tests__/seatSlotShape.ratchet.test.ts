import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "@/__tests__/walk";
import { codeOf } from "@/__tests__/sourceText";

/**
 * `releasingRef` に書くのは `useEngineSeat` の `holdSlot` の中だけ。
 *
 * 応答待ちの返却はこの ref が持ち、後から来た返却はその後ろに並ぶ。空けてよいのは自分がまだ
 * 載っているときだけで、無条件に空けると、次の返却が誰も居ないと読んで同じ席へ並列で送る。
 * 差が出るのは3本の返却が重なる筋だけで、振る舞いのテストでは守りきれないので綴りで止める。
 *
 * 返す値を初回の描画で固定するフックも見る。早期 return より上に置いてよいのは `useRef` と、
 * 依存が全部安定な `useCallback` だけ。それ以外は読んだ値が初回のまま残る。
 * 依存の安定は `exhaustive-deps` と読む人が見る。ここが見るのは形だけ。
 */
const SEAT = "src/entities/analysis/model/useEngineSeat.ts";

/**
 * 返す値を初回の描画で凍らせるフック。**同じ形を選んだものは全部ここに並べる。**
 *
 * 同一性を要求として持つ値（呼び手が effect の依存に載せる）は、スライスの中で
 * 1通りの答えに揃える。`useMemo` は React が値を捨てないことを約束しないので、
 * 片方だけ `useMemo` に寄せると、依存を1つ足した人が黙って壊す側と、
 * この検査が止める側に割れる。
 */
const FROZEN: { path: string; fn: string }[] = [
  { path: SEAT, fn: "useEngineSeat" },
  { path: "src/entities/analysis/model/useResultFlush.ts", fn: "useResultFlush" },
];

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

    expect(inside, `${SEAT}: \`holdSlot\` が枠に書いていない`).toBeGreaterThan(0);
    expect(total, `${SEAT}: \`holdSlot\` の外から枠に書いている`).toBe(inside);
  });

  test.each(FROZEN)("$fn は凍る前に useRef と useCallback だけを置く", ({ path, fn }) => {
    const code = codeOf(readFileSync(join(REPO_ROOT, path), "utf8"));

    const head = code.slice(
      code.indexOf(`export function ${fn}`),
      code.indexOf("if (apiRef.current) return apiRef.current;"),
    );

    expect(head, `${path}: 早期 return が見つからない（この検査の前提が崩れている）`).not.toBe("");

    // `useRef` と `useCallback` を含まない宣言を数える。名前だけを見ると、
    // `const { isReady } = useEngine();` のような分割代入が素通りする。
    const offenders = (head.match(/^ {2}(?:const|let|var)\b[^\n]*/gm) ?? []).filter(
      (line) => !/\buse(?:Ref|Callback)\s*[<(]/.test(line),
    );

    expect(
      offenders,
      `${path}: 早期 return より上に useRef / useCallback 以外の宣言がある`,
    ).toEqual([]);
  });
});
