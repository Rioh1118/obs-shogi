import { memo, useCallback, useId, useMemo } from "react";
import { GitBranch, MessageSquare } from "lucide-react";
import "./KifuMoveCard.scss";
import KifuForkMenu from "./KifuForkMenu";
import "./KifuForkMenu.scss";
import type { ForkPointer } from "@/entities/kifu/model/cursor";
import type { BranchIndex } from "@/entities/kifu/model/branch";
import { kifuRowId } from "../lib/rowId";

/** 棋譜ストリームの1行。`te` 手目に指した手と、同じ手数で選べる分岐 */
export type StreamRow = {
  te: number;
  /** 開始局面の行だけが `"none"` */
  side: "sente" | "gote" | "none";
  /** この行が降りた線の手。変化を選んでいれば変化の手 */
  text: string;
  commentCount: number;

  /** 同じ手数の本譜の手。分岐メニューの「本譜」に出す */
  mainText: string;
  /** 同じ手数の変化の手。添字が `forkIndex` */
  forkTexts: string[];
  forkCount: number;
  /** この行が実際に降りた変化。本譜なら null */
  selectedForkIndex: number | null;

  /** 盤のカーソルがこの行にある */
  isActive: boolean;
  /** この行より前に選んだ変化（`te` 未満）。入れ替えと削除のクエリに渡す */
  branchForkPointers: ForkPointer[];
};

type Props = {
  row: StreamRow;
  busy: boolean;

  isForkMenuOpen: boolean;
  isCommentOpen: boolean;
  openForkAnchorEl: HTMLButtonElement | null;
  forkMenuRef: React.RefObject<HTMLDivElement | null>;
  onRequestOpenMoveMenu: (te: number, anchorRect: DOMRect) => void;

  onClickRow: (te: number) => void;
  onToggleForkMenu: (te: number, anchorEl: HTMLButtonElement) => void;
  onSelectFork: (te: number, forkIndex: number | null) => void;
  onRequestCloseForkMenu: () => void;
  onOpenComment: (row: StreamRow, anchorEl: HTMLButtonElement) => void;

  onSwapBranch: (
    te: number,
    branchForkPointers: ForkPointer[],
    branchIndex: BranchIndex,
    dir: "up" | "down",
  ) => void;

  onDeleteBranch: (te: number, branchForkPointers: ForkPointer[], branchIndex: BranchIndex) => void;
};

function sideLabel(side: StreamRow["side"]) {
  if (side === "sente") return "先手";
  if (side === "gote") return "後手";
  return "";
}

const KifuMoveCard = memo(function KifuMoveCard({
  row,
  busy,
  isForkMenuOpen,
  isCommentOpen,
  openForkAnchorEl,
  forkMenuRef,
  onClickRow,
  onToggleForkMenu,
  onSelectFork,
  onRequestCloseForkMenu,
  onRequestOpenMoveMenu,
  onOpenComment,
  onSwapBranch,
  onDeleteBranch,
}: Props) {
  const hasFork = row.forkCount > 0 && row.te !== 0;

  const rowClass = useMemo(() => {
    return [
      "kifu-row",
      row.isActive ? "kifu-row--active" : "",
      busy ? "kifu-row--busy" : "",
      row.selectedForkIndex != null ? "kifu-row--forked" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }, [row.isActive, row.selectedForkIndex, busy]);

  const menuId = useId();
  const toggleId = useId();

  const onRowKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (busy) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClickRow(row.te);
      }
    },
    [busy, onClickRow, row.te],
  );

  const onClickForkToggle = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (busy) return;
      onToggleForkMenu(row.te, e.currentTarget);
    },
    [busy, onToggleForkMenu, row.te],
  );

  const onClickComment = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (busy) return;
      onOpenComment(row, e.currentTarget);
    },
    [busy, onOpenComment, row],
  );

  const onSelect = useCallback(
    (forkIndex: number | null) => {
      if (busy) return;
      onSelectFork(row.te, forkIndex);
    },
    [busy, onSelectFork, row.te],
  );

  const ariaLabel =
    row.te === 0 ? "開始局面" : `${row.te}手目、${sideLabel(row.side)}、${row.text}`;

  const commentTitle = row.commentCount > 0 ? "コメントを開く" : "コメントを追加";

  return (
    <div
      id={kifuRowId(row.te)}
      className={rowClass}
      onClick={() => !busy && onClickRow(row.te)}
      onKeyDown={onRowKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onRequestOpenMoveMenu(row.te, r);
      }}
      tabIndex={-1}
      title={row.te === 0 ? "開始局面へ" : `${row.te}手目へ`}
    >
      <div className="kifu-row__num">{row.te === 0 ? "" : row.te}</div>

      <div className="kifu-row__move" aria-label={ariaLabel}>
        {row.text}
      </div>

      <div className="kifu-row__badges" onClick={(e) => e.stopPropagation()}>
        {hasFork ? (
          <button
            id={toggleId}
            type="button"
            className={["kifu-badge", "kifu-badge--btn", isForkMenuOpen ? "kifu-badge--active" : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={onClickForkToggle}
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={isForkMenuOpen}
            aria-controls={isForkMenuOpen ? menuId : undefined}
            title="分岐を選択"
          >
            <GitBranch className="kifu-badge__icon" size={14} />
            <span className="kifu-badge__count">{row.forkCount}</span>
            {row.selectedForkIndex != null ? (
              <span className="kifu-badge__sub">{row.selectedForkIndex + 1}</span>
            ) : null}
          </button>
        ) : null}

        <button
          type="button"
          className={[
            "kifu-badge",
            "kifu-badge--btn",
            "kifu-badge--comment",
            isCommentOpen ? "kifu-badge--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={onClickComment}
          disabled={busy}
          aria-pressed={isCommentOpen}
          title={commentTitle}
        >
          <MessageSquare className="kifu-badge__icon" size={14} />
          {row.commentCount > 0 ? (
            <span className="kifu-badge__count">{row.commentCount}</span>
          ) : null}
        </button>
      </div>

      {hasFork && isForkMenuOpen && openForkAnchorEl ? (
        <KifuForkMenu
          te={row.te}
          mainText={row.mainText}
          forkTexts={row.forkTexts}
          selectedForkIndex={row.selectedForkIndex}
          busy={busy}
          anchorEl={openForkAnchorEl}
          onSelect={onSelect}
          onClose={onRequestCloseForkMenu}
          menuRef={forkMenuRef}
          onSwap={(branchIndex, dir) => {
            onSwapBranch(row.te, row.branchForkPointers, branchIndex, dir);
          }}
          onDelete={(branchIndex) => {
            onDeleteBranch(row.te, row.branchForkPointers, branchIndex);
          }}
        />
      ) : null}
    </div>
  );
});

export default KifuMoveCard;
