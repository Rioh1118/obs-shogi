import { forwardRef, memo, useCallback, useId, useMemo } from "react";
import { GitBranch, MessageSquare } from "lucide-react";
import "./KifuMoveCard.scss";
import KifuForkMenu from "./KifuForkMenu";
import "./KifuForkMenu.scss";
import type { ForkPointer } from "@/entities/kifu/model/cursor";

export type RowModel = {
  te: number;
  side: "sente" | "gote" | "none";
  text: string;
  commentCount: number;

  mainText: string;
  forkTexts: string[];
  forkCount: number;
  selectedForkIndex: number | null;

  isActive: boolean;
  branchForkPointers: ForkPointer[];
};

type Props = {
  row: RowModel;
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
  onOpenComment: (row: RowModel, anchorEl: HTMLButtonElement) => void;

  onSwapBranch: (
    te: number,
    branchForkPointers: ForkPointer[],
    branchIndex: number,
    dir: "up" | "down",
  ) => void;

  onDeleteBranch: (
    te: number,
    branchForkPointers: ForkPointer[],
    branchIndex: number,
  ) => void;
};

function sideLabel(side: RowModel["side"]) {
  if (side === "sente") return "先手";
  if (side === "gote") return "後手";
  return "";
}

const KifuMoveCard = memo(
  forwardRef<HTMLDivElement, Props>(function KifuMoveCard(
    {
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
    },
    ref,
  ) {
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
      row.te === 0
        ? "開始局面"
        : `${row.te}手目、${sideLabel(row.side)}、${row.text}`;

    const commentTitle =
      row.commentCount > 0 ? "コメントを開く" : "コメントを追加";

    return (
      <div
        id={`kifu-row-${row.te}`}
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
        ref={ref}
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
              className={[
                "kifu-badge",
                "kifu-badge--btn",
                isForkMenuOpen ? "kifu-badge--active" : "",
              ]
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
                <span className="kifu-badge__sub">
                  {row.selectedForkIndex + 1}
                </span>
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
            branchForkPointers={row.branchForkPointers}
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
  }),
);

export default KifuMoveCard;
