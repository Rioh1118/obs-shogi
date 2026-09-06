// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { PositionHit } from "@/entities/search";

/**
 * 「この先の手」を取り直した回数を数える。
 *
 * 取り直しは画面には「取得中…」としか出ないので、**増えても人の目では追えない**。
 * 一方で1回ぶんの中身はファイル全文の読みか、少なくとも `buildPlayer`
 * （60手 0.13ms / 300手 2.54ms）で、チャンクの数だけ繰り返せば右ペインは
 * 検索が終わるまで点滅し続ける。
 */

const readText = vi.fn();
const buildPlayer = vi.fn();

vi.mock("@/entities/file-tree", () => ({
  readText: (abs: string) => readText(abs),
  describeFsError: (code: string) => `fs error: ${code}`,
}));

vi.mock("@/entities/kifu/api/parse", () => ({
  parseKifuStringToJKF: (text: string) => ({ jkf: { text } }),
}));

vi.mock("@/entities/kifu/lib/buildPlayer", () => ({
  buildPlayer: (...args: unknown[]) => {
    buildPlayer(...args);
    return { getReadableKifu: () => "☗７六歩" };
  },
}));

vi.mock("@/entities/kifu/lib/advanceWithPlan", () => ({
  advanceCurrentLine: () => ({ moved: true }),
}));

const { default: PositionSearchContinuation } = await import("../PositionSearchContinuation");

function hitAt(fileId: number, tesuu: number): PositionHit {
  return { occ: { fileId, gen: 1, nodeId: tesuu }, cursor: { tesuu, forkPointers: [] } };
}

const HIT = hitAt(1, 20);
const OTHER = hitAt(2, 30);

/**
 * 呼ばれるたびに新しい関数を返す。索引のパス表（`filePathById`）は
 * チャンクが新しい fileId を運ぶたびに作り直されるので、これが現物の形
 */
const freshResolver = () => (hit: PositionHit) => `/root/${hit.occ.fileId}.kif`;

function view(activeHit: PositionHit | null, resolveAbsPath: (h: PositionHit) => string | null) {
  return (
    <PositionSearchContinuation activeHit={activeHit} resolveAbsPath={resolveAbsPath} ply={5} />
  );
}

beforeEach(() => {
  readText.mockReset();
  readText.mockResolvedValue({ success: true, data: "kif text" });
  buildPlayer.mockReset();
});

afterEach(() => cleanup());

describe("この先の手を取り直す回数", () => {
  /**
   * `resolveAbsPath` は `filePathById` を閉じ込めているので、Rust が
   * チャンクごとに付けてくる `files` で同一性が壊れる。n=100,000 なら 334 回。
   * **選択は1度も動いていない。**
   */
  test("引き方だけが作り直されても、同じ行なら取り直さない", async () => {
    let v!: ReturnType<typeof render>;
    await act(async () => {
      v = render(view(HIT, freshResolver()));
    });
    expect(buildPlayer).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        v.rerender(view(HIT, freshResolver()));
      });
    }

    expect(buildPlayer).toHaveBeenCalledTimes(1);
    expect(readText).toHaveBeenCalledTimes(1);
  });

  test("行が変われば取り直す", async () => {
    let v!: ReturnType<typeof render>;
    await act(async () => {
      v = render(view(HIT, freshResolver()));
    });

    await act(async () => {
      v.rerender(view(OTHER, freshResolver()));
    });

    expect(readText.mock.calls.map(([abs]) => abs)).toEqual(["/root/1.kif", "/root/2.kif"]);
  });

  /**
   * 索引に無かったパスが後から入る経路。鍵が `null` から実体へ変わるので、
   * 「同じ行だから取り直さない」に飲み込まれてはいけない
   */
  test("引けなかったパスが後から引けるようになったら読む", async () => {
    let v!: ReturnType<typeof render>;
    await act(async () => {
      v = render(view(HIT, () => null));
    });
    expect(readText).not.toHaveBeenCalled();

    await act(async () => {
      v.rerender(view(HIT, freshResolver()));
    });

    expect(readText).toHaveBeenCalledTimes(1);
  });
});
