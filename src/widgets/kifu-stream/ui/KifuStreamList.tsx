import { useOverlayLayer } from "@/shared/lib/overlayStack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./KifuStreamList.scss";
import KifuMoveActions from "./KifuMoveActions";
import { useGame } from "@/entities/game";
import {
  cursorKey,
  descendTo,
  plannedCursorFrom,
  type CursorPath,
  type ForkPointer,
} from "@/entities/kifu/model/cursor";
import {
  branchLabel,
  forkIndexOrNull,
  neighborBranchIndex,
  MAIN_LINE,
  type BranchIndex,
  type DeleteQuery,
  type SwapQuery,
} from "@/entities/kifu/model/branch";
import { countMovesToDelete } from "@/entities/kifu/lib/branchEdit";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import KifuMoveCard from "./KifuMoveCard";
import { buildPlayer } from "@/entities/kifu/lib/buildPlayer";
import { buildStreamRowsFromCursor, type StreamRow } from "../lib/buildStreamRows";
import { branchIndexFromRow, resolveForkSelection } from "../lib/cursorSelection";
import { scrollToRowSafeZone } from "../lib/scrollToRowSafeZone";
import { kifuRowId } from "../lib/rowId";
import { useBranchDeleteConfirm, type PendingDelete } from "../model/useBranchDeleteConfirm";
import KifuCommentNote from "@/features/kifu-comment-note/ui/KifuCommentNote";

/**
 * 連続移動とみなす間隔（ミリ秒）。これ以内の再入なら、譲る側は撃たず、
 * 撃つ側も smooth をやめて追従を優先する。`revealRow` の2つの判断がこれを共有する。
 * 値の根拠は未測定の経験則。
 */
const RECENT_SCROLL_MS = 120;

/**
 * 行から開くサーフェス。同時に開くのは1つだけで、どれかを開くと他は閉じる。
 *
 * 削除の確認はこの外にある。確認はモーダルで、`useBranchDeleteConfirm` が持つ。
 */
type OpenFace =
  | { kind: "fork"; te: number; anchorEl: HTMLButtonElement }
  | { kind: "move"; te: number; anchorRect: DOMRect }
  | {
      kind: "comment";
      cursor: CursorPath;
      anchorEl: HTMLButtonElement;
      /**
       * 開いた時点で盤に載っていた棋譜（`boardSeq`）。ここが今と違うなら、
       * 書き込み先と中身が食い違っている。**パスでは代用できない**（`PendingDelete` と同じ理由）
       */
      boardSeq: number;
    };

/**
 * 確認に出す一文。
 *
 * 主語を空にしない。1手目も手数も欠けたときに `.filter(Boolean).join()` で組むと
 * 「が削除されます。」で始まる文になり、**何が消えるのか1つも書かれていない確認**を
 * 取り消せない操作に出すことになる。1手目が読めなければ「本譜」か「変化N」を主語にする。
 */
function describeDelete(pending: PendingDelete): string {
  const what = pending.firstMove ? `${pending.firstMove} から先` : pending.label;
  const size = pending.moveCount === null ? "手数は数えられませんでした" : `${pending.moveCount}手`;
  return `${what}（${size}）が削除されます。この操作は取り消せません。棋譜ファイルもすぐ書き換わります。`;
}

export default function KifuStreamList() {
  const { state, view, goToIndex, applyCursor, deleteBranch, swapBranches } = useGame();
  const { pendingDelete, isDeleting, requestDelete, confirmDelete, cancelDelete } =
    useBranchDeleteConfirm(deleteBranch, state.boardSeq);

  const listRef = useRef<HTMLDivElement | null>(null);
  const lastScrollAtRef = useRef<number>(0);

  const [openFace, setOpenFace] = useState<OpenFace | null>(null);
  const openFork = openFace?.kind === "fork" ? openFace : null;
  const openMoveMenu = openFace?.kind === "move" ? openFace : null;
  const openComment = openFace?.kind === "comment" ? openFace : null;
  // Escape は重なったサーフェスのうち最上位の1枚だけが受ける。最上位かは `useOverlayLayer` の返す関数に問う
  const isTop = useOverlayLayer(openFork !== null);

  const forkMenuRef = useRef<HTMLDivElement | null>(null);
  const lastAnchorRef = useRef<HTMLButtonElement | null>(null);
  const lastForkTeRef = useRef<number | null>(null);

  const plannedCursor = useMemo(
    () => plannedCursorFrom(state.cursor, state.branchPlan),
    [state.cursor, state.branchPlan],
  );

  // TODO(#277): buildStreamRowsFromCursor は盤上で再生できない手で投げる。正規化に失敗して
  // 未正規化のまま開いた棋譜で起きる。ここはレンダ中なので、棋譜ペインを包む AppErrorBoundary が
  // 受けて一覧ごと unmount される。try で包むだけだと読める手まで消えるので、復帰導線と一緒に直す。
  const rows = useMemo(() => {
    if (!view.player) return [];
    // 一覧を組むための再生用に、盤の player とは別の player を立てる。
    // buildStreamRowsFromCursor は棋譜を書き換えない契約なので、棋譜は共有してよい。
    return buildStreamRowsFromCursor(buildPlayer(view.player.kifu, null), plannedCursor);
  }, [view.player, plannedCursor]);

  const totalMoves = view.player ? view.totalMoves : 0;
  const currentTesuu = state.cursor?.tesuu ?? 0;

  /**
   * `kind` のサーフェスが開いていれば閉じる。別のサーフェスが開いていたら触らない。
   *
   * 閉じる経路はそれぞれ自分のサーフェスだけを知っている。`onClickRow` は `closeFace("fork")` と
   * `closeFace("move")` を呼ぶので、無条件に空にすると、行を押したときに開いているノートまで閉じる。
   */
  const closeFace = useCallback((kind: OpenFace["kind"]) => {
    setOpenFace((prev) => (prev?.kind === kind ? null : prev));
  }, []);

  const closeCommentNote = useCallback(() => closeFace("comment"), [closeFace]);

  const closeMoveMenu = useCallback(() => closeFace("move"), [closeFace]);

  /**
   * 行を見える位置へ戻す。位置合わせの入口はここ1つで、幾何の計算は
   * `scrollToRowSafeZone` が持つ。
   *
   * 行は scroller の中を id で引く。`closest` で親を辿ると unmount 済みの行を掴み、
   * 切り離された要素の `offsetTop` は 0 なのでリストが先頭まで飛ぶ。
   *
   * `yieldToRecent` は「直前に誰かが位置を決めていたら譲る」。局面が変わる経路では
   * カーソル変化の effect が先に走っており、同じ行へ撃ち直すと effect が選んだ
   * smooth を開始直後に打ち切ってしまう。
   */
  const revealRow = useCallback((te: number, yieldToRecent: boolean) => {
    const scroller = listRef.current;
    const rowEl = scroller?.querySelector<HTMLElement>(`#${kifuRowId(te)}`);
    if (!scroller || !rowEl) return;

    const now = performance.now();
    const dt = now - lastScrollAtRef.current;
    if (yieldToRecent && dt < RECENT_SCROLL_MS) return;
    lastScrollAtRef.current = now;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    scrollToRowSafeZone(scroller, rowEl, reduced || dt < RECENT_SCROLL_MS ? "auto" : "smooth");
  }, []);

  const closeForkMenu = useCallback(
    (focusAnchor: boolean) => {
      const anchor = lastAnchorRef.current;
      const te = lastForkTeRef.current;
      closeFace("fork");
      if (!focusAnchor) return;

      requestAnimationFrame(() => {
        // focus 既定のスクロールは「見えるところまで」で、セーフゾーン寄せを上書きするので切る。
        anchor?.focus({ preventScroll: true });

        // 局面が変わらない経路（Escape、選択済みの項目を押す）ではカーソル変化の effect が
        // 走らない。メニューは portal でアンカーに追従するので、開いたままリストを流すと
        // アンカーは画面外に出ている。ここで戻さないとフォーカスだけが見えない場所に残る。
        if (te != null) revealRow(te, true);
      });
    },
    [closeFace, revealRow],
  );

  // KifuMoveCard は memo なので、行に渡すハンドラは安定した参照でなければならない。
  // インラインのアロー関数を挟むと全行の memo が外れる。
  const closeForkMenuAndFocus = useCallback(() => closeForkMenu(true), [closeForkMenu]);

  const toggleMoveMenu = useCallback((te: number, anchorRect: DOMRect) => {
    setOpenFace((prev) =>
      prev?.kind === "move" && prev.te === te ? null : { kind: "move", te, anchorRect },
    );
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

      const query: SwapQuery = {
        te,
        forkPointers: branchForkPointers,
        a,
        b,
      };
      // TODO(#277): 失敗を画面に出す場所がまだ無い。失敗したときは `swapBranches` が
      // メモリの棋譜を戻すので、並びが元のまま残るだけになる。
      await swapBranches(query); // async-result-ignored: 失敗を出す場所が無い
    },
    [swapBranches],
  );

  // 押した瞬間には消さない。**確認を挟む。**
  //
  // 分岐メニューの「削除」は「上へ」「下へ」と同じポップオーバーの中にあり、
  // 区切り線1本しか隔てていない。取り消しは無く（ADR-0004 決定8 は undo を採らない）、
  // `deleteBranch` は消したうえで元のファイルへ即書き込む。誤クリックでも同じ結果になる。
  const onDeleteBranch = useCallback(
    (te: number, branchForkPointers: ForkPointer[], branchIndex: BranchIndex) => {
      const query: DeleteQuery = {
        te,
        forkPointers: branchForkPointers,
        target: branchIndex,
      };

      const row = rows.find((r) => r.te === te);
      const forkIndex = forkIndexOrNull(branchIndex) ?? undefined;

      // 数えるのは実際に消す関数と同じ経路で、指す変化を解決できないクエリはここで投げる。
      // そのときは数を伏せて確認だけ出す。**数が出ないことを理由に確認を飛ばさない。**
      // 投げなかったことは削除が通る保証にならない。数えるときはカーソルを渡さないので、
      // `deleteBranchInKifu` がカーソルの検査で投げる経路はここでは起きない。
      let moveCount: number | null = null;
      if (state.jkf) {
        try {
          moveCount = countMovesToDelete(state.jkf, query);
        } catch {
          moveCount = null;
        }
      }

      closeFace("fork");
      closeFace("move");
      requestDelete({
        query,
        label: branchLabel(forkIndex),
        firstMove: (forkIndex === undefined ? row?.mainText : row?.forkTexts[forkIndex]) ?? "",
        moveCount,
      });
    },
    [rows, state.jkf, closeFace, requestDelete],
  );

  const onOpenComment = useCallback(
    (row: StreamRow, anchorEl: HTMLButtonElement) => {
      if (!plannedCursor) return;

      const cursor = descendTo(plannedCursor, row.te, row.selectedForkIndex);

      setOpenFace({ kind: "comment", cursor, anchorEl, boardSeq: state.boardSeq });
    },
    [plannedCursor, state.boardSeq],
  );

  const onClickRow = useCallback(
    (te: number) => {
      closeForkMenu(false);
      closeFace("move");
      goToIndex(te);
    },
    [goToIndex, closeForkMenu, closeFace],
  );

  const onToggleForkMenu = useCallback((te: number, anchorEl: HTMLButtonElement) => {
    lastAnchorRef.current = anchorEl;
    lastForkTeRef.current = te;
    setOpenFace((prev) =>
      prev?.kind === "fork" && prev.te === te ? null : { kind: "fork", te, anchorEl },
    );
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

  const handleDeleteFromHere = (te: number) => {
    if (te <= 0) return;

    const r = rows.find((x) => x.te === te);
    if (!r) return;

    const branchIndex = branchIndexFromRow(r);
    onDeleteBranch(te, r.branchForkPointers, branchIndex);
  };

  // 盤の中身が入れ替わったら、開いているサーフェスを全部閉じる。削除の確認は
  // `useBranchDeleteConfirm` が同じ合図で閉じる。
  //
  // 行は `key={r.te}` なので DOM のボタンは再利用され、`anchorEl` も生き残る。
  // 棋譜の差し替えでは `view.player` が null になる瞬間も無い（`kifu_loading` は
  // `jkfData` を保持する）ので、**ノートは同じ位置に開いたまま前の棋譜の本文を出し続ける。**
  // 見出しは手数しか出さないので、どのファイルのものかは画面から読めない。
  //
  // `loadedAbsPath` では閉じない。あちらは改名・移動でも動くので、名前を直しただけで
  // 書きかけのノートが閉じる。閉じると `KifuCommentNote` の離脱時の保存が走り、
  // 対象の手がもう外れているぶん失敗の断りも出ないまま本文が消える。
  useEffect(() => {
    setOpenFace(null);
  }, [state.boardSeq]);

  // 行の操作のサーフェスは自分の押下を止める（`KifuMoveActions` の `stopPropagation`）ので、
  // document まで届いた押下は全部、サーフェスの外側の押下
  useEffect(() => {
    if (!openMoveMenu) return;

    document.addEventListener("pointerdown", closeMoveMenu);
    return () => document.removeEventListener("pointerdown", closeMoveMenu);
  }, [openMoveMenu, closeMoveMenu]);

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
      if (e.key === "Escape" && isTop()) {
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
  }, [openFork, closeForkMenu, isTop]);

  // tesuu は本文が読む値なので dep に要る。tesuuPointer は "<tesuu>,[...]" 形式で
  // tesuu を含むため、足しても発火は増えない。
  //
  // 逆は成り立たない。同じ手数のまま分岐だけを選び直すと tesuuPointer だけが変わるので、
  // tesuuPointer を「冗長だから」と落とすとその経路で追従が止まる。
  //
  // どの棋譜を読み込んだかも見る。tesuuPointer が一意なのは1つの棋譜の中だけで、
  // どの棋譜でも開始局面は "0,[]" になる。棋譜を切り替えても一覧は unmount されないので、
  // カーソルを動かさずに切り替えると scrollTop だけが前の棋譜の位置に残る。
  //
  // ここで見るのは**盤の中身が入れ替わったか**（`boardSeq`）で、パスでも棋譜そのものでもない。
  // `state.jkf` はコメントの保存でも別オブジェクトになるので、それを見ると入力中に
  // 一覧がカーソル行へ飛ぶ。パスを見ると、改名で並んでいる行も scrollTop も
  // 変わらないのに戻る。同じパスの載り直し（`game.md` の E16 のあとの復帰）では
  // 中身が入れ替わっているので、そこは戻して正しい。
  useEffect(() => {
    revealRow(state.cursor?.tesuu ?? 0, false);
  }, [state.boardSeq, state.cursor?.tesuuPointer, state.cursor?.tesuu, revealRow]);

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
        onClose={closeMoveMenu}
        onDeleteFromHere={handleDeleteFromHere}
      />

      <KifuCommentNote
        open={!!openComment}
        cursor={openComment?.cursor ?? null}
        boardSeq={openComment?.boardSeq ?? null}
        anchorEl={openComment?.anchorEl ?? null}
        onClose={closeCommentNote}
      />

      {pendingDelete && (
        <ConfirmDialog
          title={`${pendingDelete.query.te}手目の${pendingDelete.label}を削除しますか？`}
          subtitle={describeDelete(pendingDelete)}
          error={pendingDelete.error}
          isLoading={isDeleting}
          onConfirm={() => void confirmDelete()}
          onCancel={cancelDelete}
        />
      )}

      <div className="kifu__list" ref={listRef}>
        {rows.map((r) => {
          const isForkOpen = openFork?.te === r.te;
          // 先に openComment を見て短絡させる。閉じている間は行ごとの
          // カーソル組み立て（JSON.stringify を含む）を走らせない。
          const isCommentOpen =
            openComment != null &&
            cursorKey(openComment.cursor) ===
              cursorKey(descendTo(plannedCursor, r.te, r.selectedForkIndex));
          const forkAnchorEl = isForkOpen ? openFork?.anchorEl : null;

          return (
            <KifuMoveCard
              key={r.te}
              row={r}
              busy={state.isLoading}
              isForkMenuOpen={isForkOpen}
              isCommentOpen={isCommentOpen}
              openForkAnchorEl={forkAnchorEl}
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
