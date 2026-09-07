import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * 置き場の狙いは2つ。**同じ棋譜を2度読まない**ことと、**抱える量に上限がある**こと。
 * どちらも画面には出ないので、ここで数える。
 */

const readText = vi.fn();

vi.mock("@/entities/file-tree", () => ({
  readText: (abs: string) => readText(abs),
  describeFsError: (code: string) => `fs error: ${code}`,
}));

vi.mock("@/entities/kifu/api/parse", () => ({
  parseKifuStringToJKF: (text: string) => ({ jkf: { text } }),
}));

const { KifuCache } = await import("../kifuCache");

/**
 * `n` byte ぶんを抱えることになる棋譜として解決する。
 * 置き場は原文の長さに係数を掛けて見積もるので、ここでも割ってから渡す
 */
const BYTES_PER_SOURCE_CHAR = 12;
const okOf = (bytes: number) => ({
  success: true,
  data: "x".repeat(Math.ceil(bytes / BYTES_PER_SOURCE_CHAR)),
});

/** 解決を試験の側から握る */
function pending() {
  let settle!: (v: unknown) => void;
  const promise = new Promise((resolve) => (settle = resolve));
  return { promise, settle };
}

const readPaths = () => readText.mock.calls.map(([abs]) => abs as string);

/** マイクロタスクを流し切る */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  readText.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KifuCache", () => {
  test("同じ棋譜は2度読まない", async () => {
    readText.mockResolvedValue(okOf(10));
    const cache = new KifuCache(1000);

    await cache.load("/a.kif");
    await cache.load("/a.kif");

    expect(readPaths()).toEqual(["/a.kif"]);
  });

  /** 読み終わってから抱えると、この経路で `read_file` が重なる */
  test("読んでいる最中に同じ棋譜を頼まれても、読みは1本", async () => {
    const a = pending();
    readText.mockImplementation(() => a.promise);
    const cache = new KifuCache(1000);

    const first = cache.load("/a.kif");
    const second = cache.load("/a.kif");

    expect(readPaths()).toEqual(["/a.kif"]);
    expect(first).toBe(second);

    a.settle(okOf(10));
    await first;
  });

  test("失敗した読みは抱えない", async () => {
    readText.mockResolvedValue({ success: false, error: { code: "permission_denied" } });
    const cache = new KifuCache(1000);

    await expect(cache.load("/a.kif")).rejects.toThrow();
    await flush();
    expect(cache.has("/a.kif")).toBe(false);

    readText.mockResolvedValue(okOf(10));
    await cache.load("/a.kif");

    expect(readPaths()).toEqual(["/a.kif", "/a.kif"]);
  });

  test("上限を超えたら古い順に落とす", async () => {
    readText.mockResolvedValue(okOf(60));
    const cache = new KifuCache(100);

    await cache.load("/a.kif");
    await cache.load("/b.kif");
    await flush();

    expect(cache.has("/a.kif")).toBe(false);
    expect(cache.has("/b.kif")).toBe(true);
  });

  /** 1本で上限を超える棋譜がある。そこで空にしてしまうと、抱える意味が消える */
  test("上限を1本で超えても、その1本は残す", async () => {
    readText.mockResolvedValue(okOf(500));
    const cache = new KifuCache(100);

    await cache.load("/a.kif");
    await flush();

    expect(cache.has("/a.kif")).toBe(true);
  });

  /**
   * **読んでいる最中のものを落とさない。** 量が 0 と数えられているので、落としても
   * 総量が減らない。落とす対象にすると、上限を1度超えるたびに置き場が1件まで削れ、
   * 削られた読みは解決時に中身を捨てる——その棋譜へ戻ると2本目の `read_file` が飛ぶ
   */
  test("読んでいる最中の棋譜は追い出さない", async () => {
    const slow = pending();
    // `/b.kif` は1本で上限を超える。**古い解決済みを全部落としてもまだ超える**ので、
    // 未解決を対象にしていると、そこまで削りに行ってしまう
    readText.mockImplementation((abs: string) => {
      if (abs === "/slow.kif") return slow.promise;
      return Promise.resolve(okOf(abs === "/b.kif" ? 200 : 30));
    });
    const cache = new KifuCache(100);

    await cache.load("/a.kif");
    void cache.load("/slow.kif");
    await cache.load("/b.kif");
    await flush();

    // 上限を超えたので古い `/a.kif` は落ちる。読んでいる最中の `/slow.kif` は残る
    expect(cache.has("/a.kif")).toBe(false);
    expect(cache.has("/slow.kif")).toBe(true);
    expect(cache.has("/b.kif")).toBe(true);

    // 落とされていないので、解決しても読みは1本のまま
    slow.settle(okOf(10));
    await flush();
    expect(readPaths().filter((p) => p === "/slow.kif")).toHaveLength(1);
  });
});
