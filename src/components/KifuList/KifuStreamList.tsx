import { useGame } from "@/contexts/GameContext";
import type { ForkPointer, KifuCursor, TesuuPointer } from "@/types";
import { JKFPlayer } from "json-kifu-format";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./KifuStreamList.scss";
import KifuMoveCard, { type RowModel } from "./KifuMoveCard";
import type { DeleteQuery, SwapQuery } from "@/types/branch";
import KifuMoveActions from "./KifuMoveActions";

type OpenMoveMenu = { te: number; anchorRect: DOMRect };

function cloneJKF<T>(kifu: T): T {
  const sc = (globalThis as any).structuredClone as ((x: T) => T) | undefined;
  if (typeof sc === "function") return sc(kifu);
  return JSON.parse(JSON.stringify(kifu)) as T;
}
const branchIndexFromRow = (r: RowModel): number => {
  return r.selectedForkIndex == null ? 0 : r.selectedForkIndex + 1;
};

function buildStreamRowsFromCursor(
  jkf: JKFPlayer,
  cursor: KifuCursor | null,
): RowModel[] {
  const planned = new Map<number, number>();
  for (const p of cursor?.forkPointers ?? []) planned.set(p.te, p.forkIndex);

  const rows: RowModel[] = [];
  const currentTesuu = cursor?.tesuu ?? 0;

  const mf0 = jkf.currentStream[0];
  rows.push({
    te: 0,
    side: "none",
    text: "開始局面",
    commentCount: (mf0?.comments ?? []).length,
    mainText: "開始局面",
    forkTexts: [],
    forkCount: 0,
    selectedForkIndex: null,
    isActive: currentTesuu === 0,
    branchForkPointers: [],
  });

  let safety = 100000;
  while (safety-- > 0) {
    const te = jkf.tesuu + 1;
    if (!jkf.currentStream[te]) break;

    const forkTexts = jkf.getReadableForkKifu?.() ?? [];
    const mainText = (() => {
      const ok = jkf.forward();
      if (!ok) return "";
      const s = jkf.getReadableKifu?.() ?? "";
      jkf.backward();
      return s;
    })();

    const plannedForkIndex = planned.get(te) ?? null;

    let ok = false;
    if (plannedForkIndex != null) {
      ok = jkf.forkAndForward(plannedForkIndex);
      if (!ok) ok = jkf.forward();
    } else {
      ok = jkf.forward();
    }
    if (!ok) break;

    const mf = jkf.currentStream[te];
    const mv = mf?.move;

    const side =
      mv?.color === 0
        ? "sente"
        : mv?.color === 1
          ? "gote"
          : te % 2 === 1
            ? "sente"
            : "gote";

    const text = jkf.getReadableKifu?.() ?? "";

    const branchForkPointers = (cursor?.forkPointers ?? []).filter(
      (p) => p.te < te,
    );
    rows.push({
      te,
      side,
      text,
      commentCount: (mf?.comments ?? []).length,
      mainText,
      forkTexts,
      forkCount: forkTexts.length,
      selectedForkIndex: plannedForkIndex,
      isActive: te === currentTesuu,
      branchForkPointers,
    });
  }

  return rows;
}

function buildCursorWithForkSelection(
  base: KifuCursor | null,
  te: number,
  forkIndex: number | null,
): KifuCursor {
  const prev: KifuCursor = base ?? {
    tesuu: 0,
    forkPointers: [],
    tesuuPointer: "0,[]" as TesuuPointer,
  };

  const prefix = (prev.forkPointers ?? []).filter((p) => p.te < te);
  const forkPointers: ForkPointer[] =
    forkIndex == null ? prefix : [...prefix, { te, forkIndex }];

  const tesuu = te;
  const tesuuPointer =
    `${tesuu},${JSON.stringify(forkPointers)}` as TesuuPointer;

  return { tesuu, forkPointers, tesuuPointer };
}

function scrollToRowSafeZone(
  scroller: HTMLElement,
  rowEl: HTMLElement,
  behavior: ScrollBehavior,
) {
  const viewH = scroller.clientHeight;
  const rowTop = rowEl.offsetTop;
  const rowH = rowEl.offsetHeight;

  const scrollTop = scroller.scrollTop;
  const viewTop = scrollTop;
  const viewBottom = scrollTop + viewH;

  const safeMargin = Math.round(viewH * 0.25);

  const lookAhead = Math.min(24, Math.round(rowH * 0.4)); // 0〜24px 程度

  const safeTop = viewTop + safeMargin;
  const safeBottom = viewBottom - safeMargin;

  const rowBottom = rowTop + rowH;

  let target: number | null = null;

  if (rowTop < safeTop) {
    target = rowTop - safeMargin + lookAhead;
  } else if (rowBottom > safeBottom) {
    target = rowBottom - (viewH - safeMargin) - lookAhead;
  }

  if (target == null) return;

  const max = scroller.scrollHeight - viewH;
  const clamped = Math.max(0, Math.min(max, target));
  scroller.scrollTo({ top: clamped, behavior });
}

type OpenForkMenu = { te: number; anchorEl: HTMLButtonElement };

export default function KifuStreamList() {
  const {
    state,
    goToIndex,
    getTotalMoves,
    applyCursor,
    deleteBranch,
    swapBranches,
  } = useGame();

  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  const lastScrollAtRef = useRef<number>(0);

  const [openFork, setOpenFork] = useState<OpenForkMenu | null>(null);
  const forkMenuRef = useRef<HTMLDivElement | null>(null);
  const lastAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [openMoveMenu, setOpenMoveMenu] = useState<OpenMoveMenu | null>(null);
  const toggleMoveMenu = useCallback((te: number, anchorRect: DOMRect) => {
    setOpenMoveMenu((prev) => (prev?.te === te ? null : { te, anchorRect }));
  }, []);
  const moveMenuRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(() => {
    if (!state.jkfPlayer) return [];
    const viewer = new JKFPlayer(cloneJKF(state.jkfPlayer.kifu));
    return buildStreamRowsFromCursor(viewer, state.cursor);
  }, [state.jkfPlayer, state.cursor]);

  const totalMoves = state.jkfPlayer ? getTotalMoves() : 0;
  const currentTesuu = state.cursor?.tesuu ?? 0;

  const closeForkMenu = useCallback((focusAnchor: boolean) => {
    const anchor = lastAnchorRef.current;
    setOpenFork(null);
    if (focusAnchor) {
      requestAnimationFrame(() => anchor?.focus());
    }
  }, []);

  const onSwapBranch = useCallback(
    async (
      te: number,
      branchForkPointers: ForkPointer[],
      branchIndex: number,
      dir: "up" | "down",
    ) => {
      const a = branchIndex;
      const b = dir === "up" ? branchIndex - 1 : branchIndex + 1;

      // 念のためガード（UI側でも canUp/canDown してるが二重で）
      if (b < 0) return;

      const q: SwapQuery = {
        te,
        forkPointers: branchForkPointers, // 規約: p.te < te
        a,
        b,
      };
      await swapBranches(q);
    },
    [swapBranches],
  );

  const onDeleteBranch = useCallback(
    async (
      te: number,
      branchForkPointers: ForkPointer[],
      branchIndex: number,
    ) => {
      const q: DeleteQuery = {
        te,
        forkPointers: branchForkPointers,
        target: branchIndex,
      };
      await deleteBranch(q);
    },
    [deleteBranch],
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

  // outside click / ESC
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

  // active row scroll follow
  useEffect(() => {
    const scroller = listRef.current;
    const rowEl = activeRowRef.current;
    if (!scroller || !rowEl) return;

    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    const now = performance.now();
    const dt = now - lastScrollAtRef.current;
    lastScrollAtRef.current = now;

    const behavior: ScrollBehavior = reduced
      ? "auto"
      : dt < 120
        ? "auto"
        : "smooth";
    scrollToRowSafeZone(scroller, rowEl, behavior);
  }, [state.cursor?.tesuuPointer]);

  const onClickRow = useCallback(
    (te: number) => {
      closeForkMenu(false);
      goToIndex(te);
    },
    [goToIndex, closeForkMenu],
  );

  const onToggleForkMenu = useCallback(
    (te: number, anchorEl: HTMLButtonElement) => {
      lastAnchorRef.current = anchorEl;
      setOpenFork((prev) => {
        if (prev?.te === te) return null;
        return { te, anchorEl };
      });
    },
    [],
  );

  const onSelectFork = useCallback(
    (te: number, forkIndex: number | null) => {
      const currentIdx =
        state.cursor?.forkPointers?.find((p) => p.te === te)?.forkIndex ?? null;

      if (currentIdx === forkIndex) {
        closeForkMenu(true);
        goToIndex(te);
        return;
      }

      const nextCursor = buildCursorWithForkSelection(
        state.cursor,
        te,
        forkIndex,
      );
      closeForkMenu(true);
      applyCursor(nextCursor);
    },
    [state.cursor, applyCursor, goToIndex, closeForkMenu],
  );

  if (!state.jkfPlayer) {
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
          onDeleteBranch(te, r.branchForkPointers, branchIndex);

          setOpenMoveMenu(null);
        }}
      />

      <div className="kifu__list" ref={listRef}>
        {rows.map((r) => {
          const isOpen = openFork?.te === r.te;

          return (
            <KifuMoveCard
              key={r.te}
              ref={r.isActive ? activeRowRef : undefined}
              row={r}
              busy={state.isLoading}
              isForkMenuOpen={isOpen}
              openForkAnchorEl={isOpen ? openFork?.anchorEl : null}
              forkMenuRef={forkMenuRef}
              onClickRow={onClickRow}
              onToggleForkMenu={onToggleForkMenu}
              onSelectFork={onSelectFork}
              onRequestOpenMoveMenu={(te, rect) => toggleMoveMenu(te, rect)}
              onRequestCloseForkMenu={() => closeForkMenu(true)}
              onSwapBranch={onSwapBranch}
              onDeleteBranch={onDeleteBranch}
            />
          );
        })}
      </div>
    </div>
  );
}
