import { JKFPlayer } from "json-kifu-format";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./KifuStreamList.scss";
import KifuMoveActions from "./KifuMoveActions";
import { useGame } from "@/entities/game";
import { plannedCursorOf, type ForkPointer, type KifuCursor } from "@/entities/kifu/model/cursor";
import {
  neighborBranchIndex,
  MAIN_LINE,
  type BranchIndex,
  type DeleteQuery,
  type SwapQuery,
} from "@/entities/kifu/model/branch";
import KifuMoveCard, { type RowModel } from "./KifuMoveCard";
import { buildStreamRowsFromCursor } from "../lib/buildStreamRows";
import {
  branchIndexFromRow,
  buildCursorWithForkSelection,
  resolveForkSelection,
} from "../lib/cursorSelection";
import { scrollToRowSafeZone } from "../lib/scrollToRowSafeZone";
import KifuCommentNote from "@/features/kifu-comment-note/ui/KifuCommentNote";

type OpenMoveMenu = { te: number; anchorRect: DOMRect };
type OpenForkMenu = { te: number; anchorEl: HTMLButtonElement };
type OpenCommentNote = {
  cursor: KifuCursor;
  anchorEl: HTMLButtonElement;
};

export default function KifuStreamList() {
  const { state, view, goToIndex, getTotalMoves, applyCursor, deleteBranch, swapBranches } =
    useGame();

  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  const lastScrollAtRef = useRef<number>(0);

  const [openFork, setOpenFork] = useState<OpenForkMenu | null>(null);
  const [openComment, setOpenComment] = useState<OpenCommentNote | null>(null);

  const forkMenuRef = useRef<HTMLDivElement | null>(null);
  const lastAnchorRef = useRef<HTMLButtonElement | null>(null);

  const [openMoveMenu, setOpenMoveMenu] = useState<OpenMoveMenu | null>(null);
  const moveMenuRef = useRef<HTMLDivElement | null>(null);

  const plannedCursor = useMemo(
    () => plannedCursorOf(state.cursor, state.branchPlan),
    [state.cursor, state.branchPlan],
  );

  const rows = useMemo(() => {
    if (!view.player) return [];
    // 一覧を組むための再生用に、盤の player とは別の player を立てる。
    // buildStreamRowsFromCursor は棋譜を書き換えない契約なので、棋譜は共有してよい。
    const viewer = new JKFPlayer(view.player.kifu);
    return buildStreamRowsFromCursor(viewer, plannedCursor);
  }, [view.player, plannedCursor]);

  const totalMoves = view.player ? getTotalMoves() : 0;
  const currentTesuu = state.cursor?.tesuu ?? 0;

  const closeCommentNote = useCallback(() => {
    setOpenComment(null);
  }, []);

  const closeForkMenu = useCallback((focusAnchor: boolean) => {
    const anchor = lastAnchorRef.current;
    setOpenFork(null);
    if (!focusAnchor) return;

    requestAnimationFrame(() => {
      // 行の位置を決めるのは scrollToRowSafeZone だけにする。focus 既定のスクロールは
      // 「見えるところまで」なので、25% のセーフゾーンに寄せる位置合わせを上書きする。
      anchor?.focus({ preventScroll: true });

      // 局面が変わらない経路（Escape、選択済みの項目を押す）ではカーソル変化の effect が
      // 走らない。メニューは portal でアンカーに追従するので、開いたままリストを流すと
      // アンカーは画面外に出ている。ここで戻さないとフォーカスだけが見えない場所に残る。
      const scroller = listRef.current;
      const rowEl = anchor?.closest<HTMLElement>(".kifu-row") ?? null;
      if (scroller && rowEl) scrollToRowSafeZone(scroller, rowEl, "auto");
    });
  }, []);

  // KifuMoveCard は memo なので、行に渡すハンドラは安定した参照でなければならない。
  // インラインのアロー関数を挟むと全行の memo が外れる。
  const closeForkMenuAndFocus = useCallback(() => closeForkMenu(true), [closeForkMenu]);

  const toggleMoveMenu = useCallback((te: number, anchorRect: DOMRect) => {
    setOpenFork(null);
    setOpenComment(null);
    setOpenMoveMenu((prev) => (prev?.te === te ? null : { te, anchorRect }));
  }, []);

  const onSwapBranch = useCallback(
    async (
      te: number,
      branchForkPointers: ForkPointer[],
      branchIndex: BranchIndex,
      dir: "up" | "down",
    ) => {
      const a = branchIndex;
      const b = neighborBranchIndex(branchIndex, dir);
      if (b < MAIN_LINE) return;

      const q: SwapQuery = {
        te,
        forkPointers: branchForkPointers,
        a,
        b,
      };
      await swapBranches(q);
    },
    [swapBranches],
  );

  const onDeleteBranch = useCallback(
    async (te: number, branchForkPointers: ForkPointer[], branchIndex: BranchIndex) => {
      const q: DeleteQuery = {
        te,
        forkPointers: branchForkPointers,
        target: branchIndex,
      };
      await deleteBranch(q);
    },
    [deleteBranch],
  );

  const onOpenComment = useCallback(
    (row: RowModel, anchorEl: HTMLButtonElement) => {
      if (!plannedCursor) return;

      const cursor = buildCursorWithForkSelection(plannedCursor, row.te, row.selectedForkIndex);

      setOpenFork(null);
      setOpenMoveMenu(null);
      setOpenComment({ cursor, anchorEl });
    },
    [plannedCursor],
  );

  useEffect(() => {
    if (!openMoveMenu) return;

    const onDocPointerDown = (e: PointerEvent) => {
      const path = e.composedPath();
      const menuEl = moveMenuRef.current;
      if (menuEl && path.includes(menuEl)) return;
      setOpenMoveMenu(null);
    };

    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [openMoveMenu]);

  useEffect(() => {
    if (!openFork) return;

    const onDocPointerDown = (e: PointerEvent) => {
      const path = e.composedPath();
      const menuEl = forkMenuRef.current;
      const anchorEl = openFork.anchorEl;

      if (menuEl && path.includes(menuEl)) return;
      if (anchorEl && path.includes(anchorEl)) return;

      closeForkMenu(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeForkMenu(true);
      }
    };

    document.addEventListener("pointerdown", onDocPointerDown);
    window.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openFork, closeForkMenu]);

  useEffect(() => {
    const scroller = listRef.current;
    const rowEl = activeRowRef.current;
    if (!scroller || !rowEl) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    const now = performance.now();
    const dt = now - lastScrollAtRef.current;
    lastScrollAtRef.current = now;

    const behavior: ScrollBehavior = reduced ? "auto" : dt < 120 ? "auto" : "smooth";

    scrollToRowSafeZone(scroller, rowEl, behavior);
  }, [state.cursor?.tesuuPointer]);

  const onClickRow = useCallback(
    (te: number) => {
      closeForkMenu(false);
      setOpenMoveMenu(null);
      goToIndex(te);
    },
    [goToIndex, closeForkMenu],
  );

  const onToggleForkMenu = useCallback((te: number, anchorEl: HTMLButtonElement) => {
    lastAnchorRef.current = anchorEl;
    setOpenComment(null);
    setOpenMoveMenu(null);
    setOpenFork((prev) => {
      if (prev?.te === te) return null;
      return { te, anchorEl };
    });
  }, []);

  const onSelectFork = useCallback(
    (te: number, forkIndex: number | null) => {
      if (!plannedCursor) return;

      const next = resolveForkSelection(plannedCursor, te, forkIndex);
      closeForkMenu(true);

      if (next.kind === "goToIndex") goToIndex(next.te);
      else applyCursor(next.cursor);
    },
    [plannedCursor, applyCursor, goToIndex, closeForkMenu],
  );

  if (!view.player) {
    return (
      <div className="kifu">
        <div className="kifu__empty">棋譜ファイルを選択してください</div>
      </div>
    );
  }

  return (
    <div className="kifu">
      <div className="kifu__status">
        <span className="kifu__statusText">
          手数 {currentTesuu}/{totalMoves}
        </span>
      </div>

      <KifuMoveActions
        open={!!openMoveMenu}
        busy={state.isLoading}
        te={openMoveMenu?.te ?? 0}
        anchorRect={openMoveMenu?.anchorRect ?? null}
        onClose={() => setOpenMoveMenu(null)}
        onDeleteFromHere={(te) => {
          if (te <= 0) return;

          const r = rows.find((x) => x.te === te);
          if (!r) return;

          const branchIndex = branchIndexFromRow(r);
          void onDeleteBranch(te, r.branchForkPointers, branchIndex);
          setOpenMoveMenu(null);
        }}
      />

      <KifuCommentNote
        open={!!openComment}
        cursor={openComment?.cursor ?? null}
        anchorEl={openComment?.anchorEl ?? null}
        onClose={closeCommentNote}
      />

      <div className="kifu__list" ref={listRef}>
        {rows.map((r) => {
          const isForkOpen = openFork?.te === r.te;
          // 先に openComment を見て短絡させる。閉じている間は行ごとの
          // カーソル組み立て（JSON.stringify を含む）を走らせない。
          const isCommentOpen =
            openComment != null &&
            openComment.cursor.tesuuPointer ===
              buildCursorWithForkSelection(plannedCursor, r.te, r.selectedForkIndex).tesuuPointer;

          return (
            <KifuMoveCard
              key={r.te}
              ref={r.isActive ? activeRowRef : undefined}
              row={r}
              busy={state.isLoading}
              isForkMenuOpen={isForkOpen}
              isCommentOpen={isCommentOpen}
              openForkAnchorEl={isForkOpen ? openFork?.anchorEl : null}
              forkMenuRef={forkMenuRef}
              onClickRow={onClickRow}
              onToggleForkMenu={onToggleForkMenu}
              onSelectFork={onSelectFork}
              onRequestOpenMoveMenu={toggleMoveMenu}
              onRequestCloseForkMenu={closeForkMenuAndFocus}
              onOpenComment={onOpenComment}
              onSwapBranch={onSwapBranch}
              onDeleteBranch={onDeleteBranch}
            />
          );
        })}
      </div>
    </div>
  );
}
