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
const navigateToHit = vi.fn();
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

// 差し替えるのは実体の側。barrel は再 export なので cursorFromLite は本物が通る
vi.mock("@/entities/search/model/usePositionSearch", () => ({
  usePositionSearch: () => ({
    state: { index: { state: "Ready" } },
    searchPosition: vi.fn().mockResolvedValue({ requestId: 1 }),
    cancelSearch: vi.fn(),
    getSessionByRequestId: () => ({ isDone: true, error: null, stale: false }),
    getHitsByRequestId: () => HITS,
    isSearchingRequest: () => false,
    resolveHitAbsPath,
  }),
}));

vi.mock("@/features/position-search/lib/usePositionHitNavigation", () => ({
  usePositionHitNavigation: () => ({ navigateToHit }),
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

const NOTICE = "この棋譜を開けません";

function pressEnter() {
  fireEvent.keyDown(screen.getByLabelText("局面検索"), { key: "Enter" });
}

beforeEach(() => {
  closeModal.mockReset();
  navigateToHit.mockReset();
  resolveHitAbsPath.mockReset();
  resolveHitAbsPath.mockImplementation((hit: PositionHit) => `/root/${hit.occ.fileId}.kif`);
});

afterEach(() => cleanup());

describe("PositionSearchModal のヒットを開く", () => {
  test("移動できたら閉じる", () => {
    navigateToHit.mockReturnValue(true);
    render(<PositionSearchModal />);

    pressEnter();

    expect(navigateToHit).toHaveBeenCalledWith("/root/1.kif", HITS[0].cursor);
    expect(closeModal).toHaveBeenCalledWith({ skipReturn: true });
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  test("ツリーに無くて移動できなければ、閉じずにその場で断る", () => {
    navigateToHit.mockReturnValue(false);
    render(<PositionSearchModal />);

    pressEnter();

    expect(closeModal).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(NOTICE);
  });

  test("索引にパスが無いヒットも同じ扱い（移動を試みない）", () => {
    resolveHitAbsPath.mockReturnValue(null);
    render(<PositionSearchModal />);

    pressEnter();

    expect(navigateToHit).not.toHaveBeenCalled();
    expect(closeModal).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(NOTICE);
  });

  test("別のヒットを選び直したら断りは引っ込む", () => {
    navigateToHit.mockReturnValue(false);
    render(<PositionSearchModal />);

    pressEnter();
    expect(screen.getByRole("alert").textContent).toContain(NOTICE);

    fireEvent.keyDown(screen.getByLabelText("局面検索"), { key: "ArrowDown" });

    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});
