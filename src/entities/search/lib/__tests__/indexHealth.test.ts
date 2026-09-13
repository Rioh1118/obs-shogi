import { describe, it, expect } from "vitest";

import { indexHealth } from "../indexHealth";

type Index = Parameters<typeof indexHealth>[0];

function idx(over: Partial<Index>): Index {
  return {
    state: "Ready",
    dirtyCount: 0,
    scanFailed: false,
    partiallyUnreadable: false,
    indexedFiles: 0,
    totalFiles: 0,
    doneFiles: 0,
    currentPath: null,
    ...over,
  };
}

describe("indexHealth", () => {
  /**
   * **重い側から見ること。**
   *
   * 走査そのものが失敗しているなら、一部を読めなかったかはもう問題ではない
   * ——利用者が次にすることは同じ一手（ワークスペースを繋ぎ直す）。
   */
  it("走査の失敗が、一部を読めないより優先される", () => {
    expect(indexHealth(idx({ scanFailed: true, partiallyUnreadable: true }))).toBe("notRefreshed");
    expect(indexHealth(idx({ partiallyUnreadable: true }))).toBe("partiallyUnreadable");
  });

  /**
   * **「更新できていない」と「そもそも無い」を分けること。**
   *
   * 前者は前回の索引が残っているので検索は当たり、失われているのは
   * 最近の追加だけ。後者は索引が空なので**必ず0件**。同じ語にすると、
   * 0件を「自分の棋譜に無い」と読ませる。
   */
  it("作れなかった索引を「更新できていない」と言わない", () => {
    expect(indexHealth(idx({ state: "Empty", scanFailed: true }))).toBe("buildFailed");
    expect(indexHealth(idx({ state: "Ready", scanFailed: true }))).toBe("notRefreshed");
  });

  /**
   * **走査の失敗が「入れられなかった棋譜」を飲み込まないこと。**
   *
   * あちらは走査由来、こちらは索引由来で、走査の成否と独立に生き残る。
   * 畳むと利用者は差を「更新できていないから」と読み、**繋ぎ直しても
   * 消えない差**の説明を失う。
   */
  it("走査の失敗が、入れられなかった棋譜を飲み込まない", () => {
    expect(
      indexHealth(idx({ state: "Ready", scanFailed: true, indexedFiles: 800, totalFiles: 1000 })),
    ).toBe("notRefreshedAndPartiallyIndexed");
    expect(
      indexHealth(idx({ state: "Ready", scanFailed: true, indexedFiles: 1000, totalFiles: 1000 })),
    ).toBe("notRefreshed");
  });

  /**
   * **索引が空の回を、旗の軽い文言で出さないこと。**
   *
   * `Empty` は「検索は必ず0件」。`partiallyUnreadable` を先に見ると
   * 「そこの棋譜だけ」と言うが、実際にはどの局面を検索しても0件になる。
   * いまの Rust はこの組み合わせを出さないが、腕の順は誰も見ていない。
   */
  it("索引が空なら、読めない場所より先にそう言う", () => {
    expect(indexHealth(idx({ state: "Empty", partiallyUnreadable: true }))).toBe("notStarted");
  });

  /**
   * **入れ終えた数が対象より少ない回を緑にしないこと。**
   *
   * `partiallyUnreadable` は走査＝**場所**の話なので、棋譜1件ごとの構築失敗
   * （壊れた KIF、読めない文字コード）は旗が1つも立たない。緑の「準備完了」を
   * 出すと、その棋譜の局面を検索した利用者は0件を「自分の棋譜に無い」と読む。
   */
  it("索引に入れられなかった棋譜がある回を「準備完了」と言わない", () => {
    expect(indexHealth(idx({ indexedFiles: 800, totalFiles: 1000 }))).toBe("partiallyIndexed");
    expect(indexHealth(idx({ indexedFiles: 1000, totalFiles: 1000 }))).toBe("ok");
  });

  /**
   * **両方成り立つ回に、片方を隠さないこと。**
   *
   * 権限を落としたフォルダが1つ + 壊れた KIF が200本、という普通の構成で
   * 両方真になる。畳むと利用者は差の全部をフォルダの権限のせいだと読み、
   * 権限を直しても200本は検索に出ないままになる。
   */
  it("読めない場所と入れられなかった棋譜を、片方に畳まない", () => {
    expect(
      indexHealth(idx({ partiallyUnreadable: true, indexedFiles: 800, totalFiles: 1000 })),
    ).toBe("partiallyUnreadableAndIndexed");
    expect(
      indexHealth(idx({ partiallyUnreadable: true, indexedFiles: 1000, totalFiles: 1000 })),
    ).toBe("partiallyUnreadable");
    expect(indexHealth(idx({ indexedFiles: 800, totalFiles: 1000 }))).toBe("partiallyIndexed");
  });

  /** 構築中は数が揃っていないのが当たり前なので、そちらを先に見る。 */
  it("構築中の数の差を「入れられなかった」と言わない", () => {
    expect(indexHealth(idx({ state: "Building", indexedFiles: 10, totalFiles: 1000 }))).toBe(
      "building",
    );
  });

  /**
   * **何も走っていない状態を「更新中」と言わないこと。**
   *
   * プロジェクトを開く前の既定は `Empty`。ここを `building` に落とすと、
   * 待っても増えないものに「増える場合があります」と断言することになる。
   */
  it("まだ作っていない索引を「更新中」と言わない", () => {
    expect(indexHealth(idx({ state: "Empty" }))).toBe("notStarted");
    expect(indexHealth(idx({ state: "Building" }))).toBe("building");
    expect(indexHealth(idx({ state: "Restoring" }))).toBe("building");
    expect(indexHealth(idx({}))).toBe("ok");
  });

  /**
   * **走っている最中は、読めない場所より先に「作成中」と言うこと。**
   *
   * 読めないフォルダが1つある大きなワークスペースを初めて開くと、構築が
   * 数分走る。その間ずっと「一部を読めていません」だと、待てば直るものを
   * 利用者は直しに行く（しかも構築の完了前後で文字列が変わらない）。
   */
  it("進行中は、読めない場所より先に見る", () => {
    for (const state of ["Restoring", "Building", "Updating"] as const) {
      expect(indexHealth(idx({ state, partiallyUnreadable: true }))).toBe("building");
      expect(indexHealth(idx({ state, scanFailed: true }))).toBe("building");
    }
  });
});
