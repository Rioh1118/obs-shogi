import { memo, useCallback, useId, useMemo, type MouseEvent, type RefObject } from "react";
import { GitBranch, MessageSquare } from "lucide-react";
import "./KifuMoveCard.scss";
import KifuForkMenu from "./KifuForkMenu";
import "./KifuForkMenu.scss";
import type { ForkPointer } from "@/entities/kifu/model/cursor";
import type { BranchIndex } from "@/entities/kifu/model/branch";
import type { StreamRow } from "../lib/buildStreamRows";
import { kifuRowId } from "../lib/rowId";

type Props = {
  row: StreamRow;
  busy: boolean;

  isForkMenuOpen: boolean;
  isCommentOpen: boolean;
  openForkAnchorEl: HTMLButtonElement | null;
  forkMenuRef: RefObject<HTMLDivElement | null>;
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

/** 同じ手数で選べる、いま降りていない手。行の余りに出す */
function otherMoves(row: StreamRow): string[] {
  if (row.selectedForkIndex === null) return row.forkTexts;
  return [row.mainText, ...row.forkTexts.filter((_, i) => i !== row.selectedForkIndex)];
}

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
  const others = hasFork ? otherMoves(row) : [];
  const hasComment = row.commentCount > 0;
  const firstLine = row.comment.split("\n")[0];

  const rowClass = useMemo(() => {
    return ["kifu-row", row.isActive ? "kifu-row--active" : "", busy ? "kifu-row--busy" : ""]
      .filter(Boolean)
      .join(" ");
  }, [row.isActive, busy]);

  const menuId = useId();

  // Tab で辿るボタンは、いまの手の行のものだけ
  const tabIndex = row.isActive ? 0 : -1;

  const onClickForkToggle = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (busy) return;
      onToggleForkMenu(row.te, e.currentTarget);
    },
    [busy, onToggleForkMenu, row.te],
  );

  const onClickComment = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
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

  const commentTitle = hasComment ? "コメントを開く" : "コメントを追加";

  const handleContextMenu = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    onRequestOpenMoveMenu(row.te, e.currentTarget.getBoundingClientRect());
  };

  return (
    <div
      id={kifuRowId(row.te)}
      className={rowClass}
      role="row"
      aria-selected={row.isActive}
      onClick={() => !busy && onClickRow(row.te)}
      onContextMenu={handleContextMenu}
      title={row.te === 0 ? "開始局面へ" : `${row.te}手目へ`}
    >
      <div className="kifu-row__num" role="gridcell">
        {row.te === 0 ? "" : row.te}
      </div>

      <div className="kifu-row__move" role="gridcell" aria-label={ariaLabel}>
        {row.text}
      </div>

      <div className="kifu-row__extra" role="gridcell">
        {hasFork && (
          <button
            type="button"
            className={`kifu-row__fork ${isForkMenuOpen ? "kifu-row__fork--open" : ""}`}
            onClick={onClickForkToggle}
            disabled={busy}
            tabIndex={tabIndex}
            aria-haspopup="menu"
            aria-expanded={isForkMenuOpen}
            aria-controls={isForkMenuOpen ? menuId : undefined}
            aria-label={`分岐を選択（${row.forkCount}）`}
            title="分岐を選択"
          >
            <GitBranch className="kifu-row__icon" size={12} aria-hidden="true" />
            <span className="kifu-row__count">
              {row.selectedForkIndex === null
                ? row.forkCount
                : `${row.selectedForkIndex + 1}/${row.forkCount}`}
            </span>
            <span className="kifu-row__others" title={others.join(" ")}>
              {others.map((move, i) => (
                <span key={i}>{move} </span>
              ))}
            </span>
          </button>
        )}

        {/* 書いてあることを、押さなくても1行目で示す。いまの手は下に全部出る */}
        {hasComment && !row.isActive && (
          <span className="kifu-row__firstLine" title={row.comment}>
            {firstLine}
          </span>
        )}

        <button
          type="button"
          className={[
            "kifu-row__comment",
            hasComment ? "kifu-row__comment--written" : "",
            isCommentOpen ? "kifu-row__comment--open" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={onClickComment}
          disabled={busy}
          tabIndex={tabIndex}
          aria-pressed={isCommentOpen}
          aria-label={hasComment ? `${commentTitle}（${row.commentCount}）` : commentTitle}
          title={commentTitle}
        >
          <MessageSquare className="kifu-row__icon" size={13} aria-hidden="true" />
          {hasComment && <span className="kifu-row__count">{row.commentCount}</span>}
        </button>
      </div>

      {/* いまの手のコメントは、押さなくても読める */}
      {row.isActive && hasComment && (
        <div className="kifu-row__memo" role="gridcell">
          {row.comment}
        </div>
      )}

      {hasFork && isForkMenuOpen && openForkAnchorEl && (
        <KifuForkMenu
          id={menuId}
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
      )}
    </div>
  );
});

export default KifuMoveCard;
