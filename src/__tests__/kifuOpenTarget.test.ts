import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, tsFiles } from "./walk";

/**
 * **選択を動かす口は1つ。**
 *
 * 「盤に載せるべき棋譜」は `requestedKifuPathRef` が唯一の出典で、飛行中の読み出しは
 * 返った時点でそこと違うパスなら捨てられる。その ref を動かすのは `selectNode` だけなので、
 * `node_selected` を別の場所から撃つと、**選択だけが動いて宛先が置き去りになる。**
 *
 * それが #223 で、症状は「ツリーは A を選んでいるのに盤には B が載る」。画面には何も出ない
 * （ヘッダも行の強調も選択を見ているので、両方とも A と名乗る）まま、保存だけが B へ行く。
 *
 * 過去に漏れた2箇所はどちらも「口を通らない呼び出し元」だった——`deleteNode` の
 * 選択解除と、`selectNodeByAbsPath` の選択。どちらも `dispatch` を直に書いていた。
 *
 * **振る舞いはこの検査では見ない。** 捨てる判断そのものは
 * `entities/file-tree/model/__tests__/openKifuRace.test.tsx` が固定している。
 */

/** 選択を動かす唯一の action */
const SELECT_ACTION = 'type: "node_selected"';

/** その action を組み立ててよい場所。ここ以外から撃つと選択と宛先がずれる */
const OWNER = "src/entities/file-tree/model/provider.tsx";

/**
 * action の型宣言と reducer の受け口。**綴りは出るが「撃って」いない。**
 *
 * 除外を名前で持つのは、増えたときに差分へ出すため
 */
const DECLARATIONS = [
  "src/entities/file-tree/model/types.ts",
  "src/entities/file-tree/model/reducer.ts",
];

/** 走査器自身。探している字面をそのまま持っているので、自分を数えると必ず赤になる */
const SELF = "src/__tests__/kifuOpenTarget.test.ts";

describe("選択を動かす口", () => {
  it("`node_selected` を撃つのは provider の selectNode だけ", () => {
    const files = tsFiles(SRC);
    // 「見つけた件数が0」と「見たセルが0」を分ける。走査の起点が壊れればここで落ちる
    expect(files.length, "src を1ファイルも歩けていない").toBeGreaterThan(100);

    const dispatchers: string[] = [];
    let ownerCount = 0;
    let sawDeclaration = false;

    for (const file of files) {
      const name = relative(REPO_ROOT, file);
      if (name === SELF) continue;
      if (DECLARATIONS.includes(name)) {
        // 綴りを変えたら宣言側も一緒に動く。動かないなら、この検査はもう別の字面を探している
        sawDeclaration ||= readFileSync(file, "utf8").includes("node_selected");
        continue;
      }

      const hits = readFileSync(file, "utf8").split(SELECT_ACTION).length - 1;
      if (hits === 0) continue;
      if (name === OWNER) {
        ownerCount = hits;
        continue;
      }
      dispatchers.push(`${name}（${hits}箇所）`);
    }

    expect(
      sawDeclaration,
      `${DECLARATIONS.join(" / ")} に node_selected が無い。綴りが変わった`,
    ).toBe(true);
    expect(
      ownerCount,
      ownerCount === 0
        ? `${OWNER} に ${SELECT_ACTION} が無い。selectNode の中身か綴りが変わった`
        : `${OWNER} が ${SELECT_ACTION} を ${ownerCount} 箇所で撃っている。selectNode 1箇所に寄せること`,
    ).toBe(1);
    expect(
      dispatchers,
      [
        `${SELECT_ACTION} を ${OWNER} の selectNode 以外から撃っている。`,
        "選択だけが動いて「盤が映すべき棋譜」が置き去りになり、飛行中の読み出しが",
        "そのまま盤に載る（#223）。selectNode を呼ぶこと。",
        ...dispatchers,
      ].join("\n"),
    ).toEqual([]);
  });
});
