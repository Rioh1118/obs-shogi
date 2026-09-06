// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { PositionHit } from "@/entities/search";

/**
 * 「この先の手」を取りに行った回数を数える。
 *
 * 1回はファイル全文の IPC 越しの転送と全文パースだが、画面には「取得中…」と
 * しか出ない。**増えても人の目では追えない。** 一覧は矢印で降りられて、
 * 押しっぱなしは 25〜30 回/秒 になる。
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

/** 選択が止まってから読みに行くまでの時間より長く進める */
const PAST_DEBOUNCE_MS = 200;

function hitAt(fileId: number): PositionHit {
  return { occ: { fileId, gen: 1, nodeId: fileId }, cursor: { tesuu: 1, forkPointers: [] } };
}

const HIT = hitAt(1);
const OTHER = hitAt(2);

const absOf = (hit: PositionHit) => `/root/${hit.occ.fileId}.kif`;

/**
 * 呼ばれるたびに新しい関数を返す。索引のパス表（`filePathById`）は
 * チャンクが新しい fileId を運ぶたびに作り直されるので、これが現物の形
 */
const freshResolver = () => absOf;

function view(
  activeHit: PositionHit | null,
  resolveAbsPath: (h: PositionHit) => string | null,
  prefetchHit: PositionHit | null = null,
) {
  return (
    <PositionSearchContinuation
      activeHit={activeHit}
      prefetchHit={prefetchHit}
      resolveAbsPath={resolveAbsPath}
      ply={5}
    />
  );
}

/** 先読みが動き出すより手前まで進める */
const BEFORE_PREFETCH_MS = 200;
/** 先読みも動き終わるまで進める */
const PAST_PREFETCH_MS = 400;

/** 待ち時間を越えさせ、読みの解決まで流す（先読みには届かない） */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PAST_DEBOUNCE_MS);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const readPaths = () => readText.mock.calls.map(([abs]) => abs as string);

beforeEach(() => {
  vi.useFakeTimers();
  readText.mockReset();
  readText.mockResolvedValue({ success: true, data: "kif text" });
  buildPlayer.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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
    await settle();
    expect(buildPlayer).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        v.rerender(view(HIT, freshResolver()));
      });
      await settle();
    }

    expect(buildPlayer).toHaveBeenCalledTimes(1);
    expect(readPaths()).toEqual(["/root/1.kif"]);
  });

  test("行が変われば取り直す", async () => {
    let v!: ReturnType<typeof render>;
    await act(async () => {
      v = render(view(HIT, freshResolver()));
    });
    await settle();

    await act(async () => {
      v.rerender(view(OTHER, freshResolver()));
    });
    await settle();

    expect(readPaths()).toEqual(["/root/1.kif", "/root/2.kif"]);
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
    await settle();
    expect(readText).not.toHaveBeenCalled();

    await act(async () => {
      v.rerender(view(HIT, freshResolver()));
    });
    await settle();

    expect(readText).toHaveBeenCalledTimes(1);
  });
});

describe("矢印で駆け抜けたとき", () => {
  /**
   * 通り過ぎた行の中身は誰も見ない。**止まったときだけ読む。**
   * 打鍵ごとに読むと、1本 100KB の棋譜で 2.5〜3MB/秒 を IPC 越しに運び続ける
   */
  test("10行ぶん動いても、読むのは止まった1行だけ", async () => {
    let v!: ReturnType<typeof render>;
    await act(async () => {
      v = render(view(hitAt(0), freshResolver()));
    });

    for (let i = 1; i <= 10; i++) {
      await act(async () => {
        v.rerender(view(hitAt(i), freshResolver()));
      });
      // 打鍵の間隔（30/秒）。待ち時間には届かない
      await act(async () => {
        await vi.advanceTimersByTimeAsync(33);
      });
    }

    await settle();

    expect(readPaths()).toEqual(["/root/10.kif"]);
  });
});

describe("選択が外れたとき", () => {
  /**
   * 検索をやり直して0件になる、索引がパスを返さない行へ移る——どちらも
   * 行き先が消える。**そのとき飛んでいる読みが解決しても、画面へ書き戻して
   * はいけない。** 書き戻すと、前に選んでいた行の続きが「取得中」ですらない
   * 顔で残る
   */
  test("読みの解決前に行き先が消えたら、その結果は画面へ出さない", async () => {
    let settleRead!: (v: unknown) => void;
    readText.mockImplementation(() => new Promise((resolve) => (settleRead = resolve)));

    let v!: ReturnType<typeof render>;
    await act(async () => {
      v = render(view(HIT, freshResolver()));
    });
    await settle();
    expect(readPaths()).toEqual(["/root/1.kif"]);

    // 行き先が消える（検索し直して0件、など）
    await act(async () => {
      v.rerender(view(null, freshResolver()));
    });

    // その後で前の読みが解決する
    await act(async () => {
      settleRead({ success: true, data: "kif text" });
    });

    expect(buildPlayer).not.toHaveBeenCalled();
    expect(v.container.textContent).toContain("（続きなし）");
  });
});

describe("次の1行の先読み", () => {
  /**
   * デバウンスを入れると、矢印を1つ押すたびに 150ms 待たされる。
   * **降りる先を先に読んでおけば、その待ちは消える**（読み込み済みなら待たない）
   */
  test("落ち着いたら、次に選ばれそうな1行を読んでおく", async () => {
    await act(async () => {
      render(view(HIT, freshResolver(), OTHER));
    });

    await settle();
    expect(readPaths()).toEqual(["/root/1.kif"]);

    await advance(PAST_PREFETCH_MS);

    expect(readPaths()).toEqual(["/root/1.kif", "/root/2.kif"]);
  });

  test("先読みしてあった行へ移ると、待たずに出る", async () => {
    let v!: ReturnType<typeof render>;
    await act(async () => {
      v = render(view(HIT, freshResolver(), OTHER));
    });
    await settle();
    await advance(PAST_PREFETCH_MS);
    buildPlayer.mockReset();

    // 待ち時間には届かない間隔で移る
    await act(async () => {
      v.rerender(view(OTHER, freshResolver(), hitAt(3)));
    });
    await advance(1);

    expect(buildPlayer).toHaveBeenCalledTimes(1);
  });

  /** 駆け抜けている最中は、選んでいる行の読みすら投げていない。先読みも同じ */
  test("矢印で駆け抜けている間は先読みしない", async () => {
    let v!: ReturnType<typeof render>;
    await act(async () => {
      v = render(view(hitAt(0), freshResolver(), hitAt(1)));
    });

    for (let i = 1; i <= 10; i++) {
      await act(async () => {
        v.rerender(view(hitAt(i), freshResolver(), hitAt(i + 1)));
      });
      await advance(33);
    }

    expect(readPaths()).toEqual([]);

    await advance(PAST_PREFETCH_MS);
    expect(readPaths()).toEqual(["/root/10.kif", "/root/11.kif"]);
  });

  /** 先読みは、選んでいる行の読みの後ろに置く。同じ IPC を取り合わせない */
  test("選んでいる行より先に先読みが走らない", async () => {
    await act(async () => {
      render(view(HIT, freshResolver(), OTHER));
    });

    await advance(BEFORE_PREFETCH_MS);

    expect(readPaths()).toEqual(["/root/1.kif"]);
  });
});

describe("同じ棋譜への読み", () => {
  /**
   * 読み終わる前に戻ってきた場合。抱えるのが解決後の値だと、この経路で
   * `read_file` が重なる
   */
  test("読んでいる最中に戻ってきても、2度は読まない", async () => {
    const pending = new Map<string, (v: unknown) => void>();
    readText.mockImplementation(
      (abs: string) => new Promise((resolve) => pending.set(abs, resolve)),
    );

    let v!: ReturnType<typeof render>;
    await act(async () => {
      v = render(view(HIT, freshResolver()));
    });
    await settle();
    expect(readPaths()).toEqual(["/root/1.kif"]);

    // 1.kif の読みは解決していない。別の行へ移って、戻る
    await act(async () => {
      v.rerender(view(OTHER, freshResolver()));
    });
    await settle();

    await act(async () => {
      v.rerender(view(HIT, freshResolver()));
    });
    await settle();

    expect(readPaths()).toEqual(["/root/1.kif", "/root/2.kif"]);
  });

  /** 抱えた棋譜は残る。1行ずつ降りて戻ってくる操作で読み直しになってはいけない */
  test("読み終わった棋譜へ戻っても、読み直さない", async () => {
    let v!: ReturnType<typeof render>;
    await act(async () => {
      v = render(view(HIT, freshResolver()));
    });
    await settle();

    await act(async () => {
      v.rerender(view(OTHER, freshResolver()));
    });
    await settle();

    await act(async () => {
      v.rerender(view(HIT, freshResolver()));
    });
    await settle();

    expect(readPaths()).toEqual(["/root/1.kif", "/root/2.kif"]);
  });

  /**
   * 上限は件数でなく量。**大きい棋譜は少ししか抱えられない**という形になって
   * いること（件数で切ると、大きい棋譜ばかりのときに際限なく抱える）
   */
  test("上限を超えたら古いものから落とす", async () => {
    // 2本で上限（`MAX_CACHED_BYTES`）を超える大きさ
    const huge = "x".repeat(1_100_000);
    readText.mockResolvedValue({ success: true, data: huge });

    let v!: ReturnType<typeof render>;
    await act(async () => {
      v = render(view(HIT, freshResolver()));
    });
    await settle();

    await act(async () => {
      v.rerender(view(OTHER, freshResolver()));
    });
    await settle();

    await act(async () => {
      v.rerender(view(HIT, freshResolver()));
    });
    await settle();

    expect(readPaths()).toEqual(["/root/1.kif", "/root/2.kif", "/root/1.kif"]);
  });

  /**
   * 失敗を抱えると、権限が戻ってもファイルが直っても同じ断りを返し続ける。
   * 利用者から見ると「一度失敗した棋譜は、アプリを開き直すまで直らない」
   */
  test("読みに失敗した棋譜は抱えない（選び直せばもう一度読む）", async () => {
    readText.mockImplementation((abs: string) =>
      abs === "/root/1.kif"
        ? Promise.resolve({ success: false, error: { code: "permission_denied" } })
        : Promise.resolve({ success: true, data: "kif text" }),
    );

    let v!: ReturnType<typeof render>;
    await act(async () => {
      v = render(view(HIT, freshResolver()));
    });
    await settle();

    await act(async () => {
      v.rerender(view(OTHER, freshResolver()));
    });
    await settle();

    await act(async () => {
      v.rerender(view(HIT, freshResolver()));
    });
    await settle();

    expect(readPaths()).toEqual(["/root/1.kif", "/root/2.kif", "/root/1.kif"]);
  });
});
