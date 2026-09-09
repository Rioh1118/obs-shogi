import { describe, expect, test } from "vitest";
import { namedExports, unconsumed } from "./barrelConsumers";

/**
 * **barrel が名前で公開したものに、スライスの外から呼び出し元が在るか。**
 *
 * `sliceBarrels` は逆向き（公開したものを外から直に読まない）を見る。
 * 両方が緑でも、**公開面だけが広がった状態**は残る——そして公開面が広がると
 * `sliceBarrels` の制約がその分だけ内側へ掛かるので、
 * 公開する必要が無い物を載せると内側で動かせる範囲だけが狭まる。
 *
 * `entities/file-tree` の barrel は自分で「ここに並ぶのはスライスの外に
 * 呼び出し元があるものだけ」と決めている。この検査はその決めを機械にしたもの。
 *
 * **`export *` は見ない。** 名前を持たないので、何が公開されたかを数えられない。
 */
describe("barrel の公開名", () => {
  /** 0件を見て緑になる形を止める */
  test("公開名を拾えている", () => {
    expect(namedExports().length).toBeGreaterThan(20);
  });

  /**
   * **件数ラチェット。増える方向にだけ落とす。**
   *
   * 零を要求しない。呼び出し元がまだ無い公開面が既に在り（`game-session` は
   * 画面がまだ無い機能なので、その大半がここに来る）、片付けを待つと今日から張れない。
   * 増分だけを止めれば、**新しく公開面を広げた人がその場で気づく**。
   *
   * 減らしたらこの数も下げること。上げるのは、外から使う場所と一緒に足すときだけ。
   */
  const BASELINE = 67;

  test("barrel の公開面が、呼び出し元の無いまま増えていない", () => {
    const dead = unconsumed(namedExports()).map(({ slice, name }) => `${slice}: ${name}`);

    expect(
      dead.length,
      [
        `呼び出し元の無い公開名が ${dead.length} 件（基準 ${BASELINE}）。`,
        "公開面が広がるほど、内側で自由に動かせる範囲が狭まる。",
        "外から使う日に、使う場所と一緒に足すこと。減らしたときは基準も下げること。",
        ...dead,
      ].join("\n"),
    ).toBeLessThanOrEqual(BASELINE);
  });
});

/** 走査器そのものを固定する。合成した入力を食わせて、判定だけを見る */
describe("unconsumed", () => {
  const EXPORTS = [{ slice: "src/entities/game", name: "useGame" }];

  test("外から使われていれば返さない", () => {
    const sources = [{ name: "src/widgets/board/ui/Board.tsx", body: "useGame();" }];
    expect(unconsumed(EXPORTS, sources)).toEqual([]);
  });

  /** 中からだけ使うなら公開する理由が無い */
  test("スライスの中だけで使われているなら返す", () => {
    const sources = [{ name: "src/entities/game/model/provider.tsx", body: "useGame();" }];
    expect(unconsumed(EXPORTS, sources)).toEqual(EXPORTS);
  });

  test("どこにも無ければ返す", () => {
    expect(unconsumed(EXPORTS, [{ name: "src/app/App.tsx", body: "nothing();" }])).toEqual(EXPORTS);
  });

  /** 部分一致で数えると、`FsError` が `FsErrorView` を根拠に生き残る */
  test("接尾辞を足した綴りでは使用と見なさない", () => {
    const exports = [{ slice: "src/entities/file-tree", name: "FsError" }];
    const sources = [{ name: "src/app/App.tsx", body: "<FsErrorView />" }];
    expect(unconsumed(exports, sources)).toEqual(exports);
  });
});
