// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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
  }),
}));

vi.mock("@/features/position-search/lib/usePositionHitNavigation", () => ({
  usePositionHitNavigation: () => ({ startNavigationToHit }),
}));

// 見に来ているのは「閉じたか」だけ。盤・プレビュー・この先の手は他のテストが見る
vi.mock("@/shared/ui/Modal", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/entities/position/ui/PositionPreviewPane", () => ({ default: () => null }));
vi.mock("../PositionSearchContinuation", () => ({ default: () => null }));

const { default: PositionSearchModal } = await import("../PositionSearchModal");

function hitAt(fileId: number, tesuu: number): PositionHit {
  return { occ: { fileId, gen: 1, nodeId: tesuu }, cursor: { tesuu, forkPointers: [] } };
}

const HITS = [hitAt(1, 20), hitAt(2, 30)];

/** チャンクは後から届く。届くたびに一覧は並び替わる（`orderPositionHits`） */
const hitsState = { current: HITS };

const NOTICE = "この棋譜を開けません";
const NOTICE_NO_PATH = "この棋譜の場所が分かりません";

function pressEnter() {
  fireEvent.keyDown(screen.getByLabelText("局面検索"), { key: "Enter" });
}

/** 検索が解決してヒットが届くまで待つ。届く前は行が無いので Enter は何もしない */
async function renderWithHits() {
  render(<PositionSearchModal />);
  await screen.findByRole("listbox");
}

beforeEach(() => {
  closeModal.mockReset();
  startNavigationToHit.mockReset();
  searchPosition.mockReset();
  searchPosition.mockResolvedValue({ requestId: REQUEST_ID });
  cancelSearch.mockReset();
  resolveHitAbsPath.mockReset();
  resolveHitAbsPath.mockImplementation((hit: PositionHit) => `/root/${hit.occ.fileId}.kif`);
  hitsState.current = HITS;
});

afterEach(() => cleanup());

describe("PositionSearchModal のヒットを開く", () => {
  test("移動できたら閉じる", async () => {
    startNavigationToHit.mockReturnValue(true);
    await renderWithHits();

    pressEnter();

    expect(startNavigationToHit).toHaveBeenCalledWith("/root/1.kif", HITS[0].cursor);
    expect(closeModal).toHaveBeenCalledWith({ skipReturn: true });
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  test("ツリーに無くて移動できなければ、閉じずにその場で断る", async () => {
    startNavigationToHit.mockReturnValue(false);
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
    startNavigationToHit.mockReturnValue(false);
    const { rerender } = render(<PositionSearchModal />);
    await screen.findByRole("listbox");

    pressEnter();
    expect(screen.getByRole("alert").textContent).toContain(NOTICE);

    hitsState.current = [hitAt(9, 5), ...HITS];
    rerender(<PositionSearchModal />);

    expect(screen.getByRole("alert").textContent).toContain(NOTICE);
  });

  test("別のヒットを選び直したら断りは引っ込む", async () => {
    startNavigationToHit.mockReturnValue(false);
    await renderWithHits();

    pressEnter();
    expect(screen.getByRole("alert").textContent).toContain(NOTICE);

    fireEvent.keyDown(screen.getByLabelText("局面検索"), { key: "ArrowDown" });

    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});
