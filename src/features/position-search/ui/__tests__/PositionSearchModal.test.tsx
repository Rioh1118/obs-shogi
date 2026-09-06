// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { PositionHit } from "@/entities/search";

/**
 * 索引に在る棋譜がツリーに無いのは正常運転で起こる。**閉じてしまうと、盤は
 * 前の棋譜のままなのに「開いた」と読める**——復帰の案内も再試行も無いまま、
 * 利用者は違う棋譜を読み続けることになる。
 */

const closeModal = vi.fn();
const startNavigationToHit = vi.fn();
const resolveHitAbsPath = vi.fn();

vi.mock("@/shared/lib/router/useURLParams", () => ({
  useURLParams: () => ({
    params: {
      modal: "position-search",
      sfen: "lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/9/LNSGKGSNL b - 1",
    },
    closeModal,
    openModal: vi.fn(),
    updateParams: vi.fn(),
  }),
}));

vi.mock("@/entities/game", () => ({
  useGame: () => ({
    state: { loadedAbsPath: "/root/a.kif" },
    view: { player: null, currentSfen: null },
  }),
}));

vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({ config: { root_dir: "/root" } }),
}));

const REQUEST_ID = 1;
const searchPosition = vi.fn();
const cancelSearch = vi.fn();
const clearSearch = vi.fn();

// 差し替えるのは実体の側。barrel は再 export なので cursorFromLite は本物が通る
//
// **`requestId` を無視しない。** 本物は要求が立つまで `null` と空配列を返す
// （`entities/search/model/provider.tsx`）。無視すると最初のレンダから一覧が立ち、
// `searchPosition` が投げても `setRequestId` が落ちても緑のままになる
vi.mock("@/entities/search/model/usePositionSearch", () => ({
  usePositionSearch: () => ({
    state: { index: { state: "Ready" } },
    searchPosition,
    cancelSearch,
    getSessionByRequestId: (rid: number | null) =>
      rid == null ? null : { isDone: true, error: null, stale: false },
    getHitsByRequestId: (rid: number | null) => (rid == null ? [] : hitsState.current),
    isSearchingRequest: () => false,
    resolveHitAbsPath,
    clearSearch,
  }),
}));

vi.mock("@/features/position-search/lib/usePositionHitNavigation", () => ({
  usePositionHitNavigation: () => ({ startNavigationToHit }),
}));

/**
 * `hitKey` が何回組まれたかを数える。**人の目では追えない**——鍵は1件 0.5〜2.7µs で、
 * 件数に比例して増えても画面には「重い」としか出ない。
 */
const hitKeyCalls = vi.fn();
vi.mock("@/features/position-search/lib/hitKey", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/position-search/lib/hitKey")>();
  return {
    ...actual,
    hitKey: (hit: PositionHit) => {
      hitKeyCalls();
      return actual.hitKey(hit);
    },
  };
});

// 見に来ているのは「閉じたか」だけ。盤・プレビュー・この先の手は他のテストが見る
vi.mock("@/shared/ui/Modal", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/entities/position/ui/PositionPreviewPane", () => ({ default: () => null }));
/** 「いまどの行が選ばれているか」を、描かれた回ごとに記録する */
const seenActiveHits: (PositionHit | null)[] = [];
vi.mock("../PositionSearchContinuation", () => ({
  default: ({ activeHit }: { activeHit: PositionHit | null }) => {
    seenActiveHits.push(activeHit);
    return null;
  },
}));

const { default: PositionSearchModal } = await import("../PositionSearchModal");

function hitAt(fileId: number, tesuu: number): PositionHit {
  return { occ: { fileId, gen: 1, nodeId: tesuu }, cursor: { tesuu, forkPointers: [] } };
}

const HITS = [hitAt(1, 20), hitAt(2, 30)];

/** チャンクは後から届く。届くたびに一覧は並び替わる（`useOrderedPositionHits`） */
const hitsState = { current: HITS };

const NOTICE = "この棋譜を開けません";
const NOTICE_NO_PATH = "この棋譜の場所が分かりません";

function pressEnter() {
  fireEvent.keyDown(screen.getByLabelText("局面検索"), { key: "Enter" });
}

/** 検索が解決してヒットが届くまで待つ。届く前は行が無いので Enter は何もしない */
async function renderWithHits() {
  const view = render(<PositionSearchModal />);
  await screen.findByRole("listbox");
  return view;
}

beforeEach(() => {
  closeModal.mockReset();
  startNavigationToHit.mockReset();
  searchPosition.mockReset();
  searchPosition.mockResolvedValue({ requestId: REQUEST_ID });
  cancelSearch.mockReset();
  clearSearch.mockReset();
  resolveHitAbsPath.mockReset();
  resolveHitAbsPath.mockImplementation((hit: PositionHit) => `/root/${hit.occ.fileId}.kif`);
  hitsState.current = HITS;
  hitKeyCalls.mockReset();
  seenActiveHits.length = 0;
});

afterEach(() => cleanup());

describe("PositionSearchModal のヒットを開く", () => {
  test("移動できたら閉じる", async () => {
    startNavigationToHit.mockReturnValue("started");
    await renderWithHits();

    pressEnter();

    expect(startNavigationToHit).toHaveBeenCalledWith("/root/1.kif", HITS[0].cursor);
    expect(closeModal).toHaveBeenCalledWith({ skipReturn: true });
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  test("ツリーに無くて移動できなければ、閉じずにその場で断る", async () => {
    startNavigationToHit.mockReturnValue("not-in-tree");
    await renderWithHits();

    pressEnter();

    expect(closeModal).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(NOTICE);
  });

  /**
   * 行き先のパスを引けないのは索引の側の欠けで、ツリーは見ていない。
   * 「ワークスペースを探した」と言うと、動かしていない棋譜を探しに行かせる。
   */
  test("索引にパスが無いヒットは、閉じずに別の断りを出す（移動は試みない）", async () => {
    resolveHitAbsPath.mockReturnValue(null);
    await renderWithHits();

    pressEnter();

    expect(startNavigationToHit).not.toHaveBeenCalled();
    expect(closeModal).not.toHaveBeenCalled();
    const notice = screen.getByRole("alert");
    expect(notice.textContent).toContain(NOTICE_NO_PATH);
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  // 要求が立つ前に一覧が出ていると、以下のテストは「ヒットが届く経路」を通らずに
  // 緑になる。土台としてここで押さえる
  test("要求が立つまでヒットは1件も無く、Enter は何もしない", () => {
    render(<PositionSearchModal />);

    pressEnter();

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(startNavigationToHit).not.toHaveBeenCalled();
    expect(closeModal).not.toHaveBeenCalled();
  });

  /**
   * 断りは選んだ行に付く。並び替えで選択が滑ると、**利用者が何もしていないのに
   * 断りが消える**。選択は添字でなく鍵で追う。
   */
  test("チャンクが届いて並び替わっても、断りは押した行に付いたまま", async () => {
    startNavigationToHit.mockReturnValue("not-in-tree");
    const { rerender } = render(<PositionSearchModal />);
    await screen.findByRole("listbox");

    pressEnter();
    expect(screen.getByRole("alert").textContent).toContain(NOTICE);

    hitsState.current = [hitAt(9, 5), ...HITS];
    rerender(<PositionSearchModal />);

    expect(screen.getByRole("alert").textContent).toContain(NOTICE);
  });

  /**
   * 選択追従がヒット件数に比例した仕事をしないこと。
   *
   * 鍵の文字列で照合すると、選んだ行より前の全件ぶん `hitKey` を組み直す。
   * 実測では n=100,000 で 24 秒（`.claude/reviews/2026-09-06-420-unopenable-position-hit-r2.md` H-5）。
   * **チャンクが届くたびに起きる**ので、件数が増えるほど「何もしていないのに止まる」。
   *
   * 上限を定数で置くのが要点。ここが件数と一緒に増えてよいなら、
   * どんな実装でも通ってしまう。
   */
  test("選んだ行が末尾へ動いても、追従は件数ぶんの鍵を組まない", async () => {
    const { rerender } = await renderWithHits();

    // 2件目を選ぶ。この後この行を末尾へ押しやる
    fireEvent.keyDown(screen.getByLabelText("局面検索"), { key: "ArrowDown" });
    hitKeyCalls.mockReset();

    // チャンクが1つ届いて、選んだ行の前に500件割り込む
    hitsState.current = [...Array.from({ length: 500 }, (_, i) => hitAt(100 + i, i)), ...HITS];
    rerender(<PositionSearchModal />);

    // 参照で追えば追従そのものは鍵を組まない。残るのは描画の断り判定ぶんだけ
    expect(hitKeyCalls.mock.calls.length).toBeLessThanOrEqual(8);
  });

  /**
   * **取り下げるだけでは足りない。** 届いたヒットの実体はセッションに残り、
   * 開き直すたびに1検索ぶん積み上がる（10万件なら 17.6MB）。捨てる口
   * （`clearSearch`）を呼ぶのはこの画面だけなので、呼ばないと**誰も呼ばない**。
   */
  test("画面を畳むとき、進行中の検索を取り下げたうえで結果も捨てる", async () => {
    const { unmount } = await renderWithHits();

    unmount();

    expect(cancelSearch).toHaveBeenCalledWith(REQUEST_ID);
    expect(clearSearch).toHaveBeenCalledWith(REQUEST_ID);
  });

  /**
   * **rid が分かるのは invoke が解決してから。** それより先に畳まれると
   * `discardSearch` は rid を知らないので、取り下げも破棄も飛ばない。素通りさせると
   * Rust の検索は最後まで走り、閉じた画面が到着のたびに一覧を組み直し続ける
   * （実測で n=100,000 のとき 19.4MB を抱える。
   * `.claude/reviews/2026-09-07-447-position-search-perf-r2.md` R2-3）
   */
  test("rid が分かる前に畳まれても、解決した側が取り下げて捨てる", async () => {
    let settleLaunch!: (out: { requestId: number }) => void;
    searchPosition.mockImplementation(
      () => new Promise((resolve) => (settleLaunch = resolve as typeof settleLaunch)),
    );

    const { unmount } = render(<PositionSearchModal />);
    unmount();

    await act(async () => {
      settleLaunch({ requestId: REQUEST_ID });
    });

    expect(cancelSearch).toHaveBeenCalledWith(REQUEST_ID);
    expect(clearSearch).toHaveBeenCalledWith(REQUEST_ID);
  });

  /**
   * 一覧はチャンクが届くたびに並び替わる（開いている棋譜のヒットが先頭へ寄る）。
   * 選んだ行の**添字と実体の両方を state に持つ**と、突き合わせが済むまでの1レンダで
   * 利用者が選んでいない隣の行が選択として描かれる。その1フレームで行き先も
   * 先読みも「続き5手」も別の棋譜を指し、Enter を押せばそちらへ移動する。
   *
   * 50ms ごとの吐き出しに乗るので、検索が続くあいだ最大 20回/秒 繰り返す
   * （`.claude/reviews/2026-09-07-447-position-search-perf-r2.md` R2-6）。
   */
  test("並び替えで選択行の添字が動いても、途中で別の行が選ばれない", async () => {
    // fileId 99 だけが「いま開いている棋譜」。届くと先頭へ寄る
    resolveHitAbsPath.mockImplementation((hit: PositionHit) =>
      hit.occ.fileId === 99 ? "/root/a.kif" : `/root/${hit.occ.fileId}.kif`,
    );

    const { rerender } = await renderWithHits();

    // 2件目（HITS[1]）を選ぶ
    fireEvent.keyDown(screen.getByLabelText("局面検索"), { key: "ArrowDown" });
    seenActiveHits.length = 0;

    // チャンクが届き、開いている棋譜のヒットが先頭へ寄って添字が1つずれる
    const sameFileHit = hitAt(99, 7);
    hitsState.current = [...HITS, sameFileHit];
    rerender(<PositionSearchModal />);

    // 描かれた全レンダで、選ばれているのは利用者が選んだ行だけ
    expect(seenActiveHits.every((h) => h === HITS[1])).toBe(true);
    expect(seenActiveHits.length).toBeGreaterThan(0);
  });

  test("別のヒットを選び直したら断りは引っ込む", async () => {
    startNavigationToHit.mockReturnValue("not-in-tree");
    await renderWithHits();

    pressEnter();
    expect(screen.getByRole("alert").textContent).toContain(NOTICE);

    fireEvent.keyDown(screen.getByLabelText("局面検索"), { key: "ArrowDown" });

    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});
