import { describe, expect, test } from "vitest";
import { buildPreviewDataFromSfen } from "../buildPreviewDataFromSfen";

/**
 * プレビューを組む前に綴りを見る。
 *
 * **`initializeFromSFENString` は持ち駒の枚数に線形。** 桁数を制限する綴りが
 * ライブラリ側に無いので、投げるまで待つと画面がその間止まる。
 */

const HIRATE = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

describe("buildPreviewDataFromSfen", () => {
  test("読める SFEN は盤と持ち駒を返す", () => {
    const preview = buildPreviewDataFromSfen(HIRATE);
    expect(preview?.turn).toBe(0);
    expect(preview?.board).toHaveLength(9);
  });

  test("枚数の桁が大きい綴りで待たされない", () => {
    // 7桁で 604ms、1桁増えるごとに10倍。門が無いと、この1件が
    // 課題局面の一覧に混ざっているだけで面を開いた瞬間に固まる
    const started = performance.now();
    expect(buildPreviewDataFromSfen("9/9/9/9/9/9/9/9/9 b 4000000P 1")).toBeNull();
    expect(performance.now() - started).toBeLessThan(100);
  });

  test("駒の総数を超える持ち駒は断る", () => {
    expect(buildPreviewDataFromSfen("9/9/9/9/9/9/9/9/9 b 19P 1")).toBeNull();
  });

  test("段が9つ無ければ断る", () => {
    // `shogi.js` は足りない段を黙って埋めるので、投げさせて捕まえる形では拾えない
    expect(buildPreviewDataFromSfen("9/9/9 b - 1")).toBeNull();
  });
});
