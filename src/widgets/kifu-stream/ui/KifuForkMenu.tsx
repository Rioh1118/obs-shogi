import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  branchIndexFromSelection,
  branchLabel,
  type BranchIndex,
} from "@/entities/kifu/model/branch";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { placeBelowOrAbove } from "../lib/popoverPlacement";
import KifuForkActions from "./KifuForkActions";
import "./KifuForkMenu.scss";

type Props = {
  /** 開いたバッジの `aria-controls` が指す id */
  id: string;
  te: number;
  mainText: string;
  forkTexts: string[];
  selectedForkIndex: number | null;
  busy: boolean;

  anchorEl: HTMLButtonElement;
  onSelect: (forkIndex: number | null) => void;
  onClose: () => void;

  onSwap: (branchIndex: BranchIndex, dir: "up" | "down") => void;
  onDelete: (branchIndex: BranchIndex) => void;

  menuRef?: RefObject<HTMLDivElement | null>;
};

type ForkOption = {
  forkIndex: number | null;
  tag: string;
  move: string;
  selected: boolean;
};

function normalizeSelected(selected: number | null, n: number): number | null {
  if (selected == null) return null;
  return selected >= 0 && selected < n ? selected : null;
}

type ActionsState = {
  branchIndex: BranchIndex;
  canUp: boolean;
  canDown: boolean;
  anchorRect: DOMRect;
};

const KifuForkMenu = memo(function KifuForkMenu({
  id,
  te,
  mainText,
  forkTexts,
  selectedForkIndex,
  busy,
  anchorEl,
  onSelect,
  onClose,
  onSwap,
  onDelete,
  menuRef,
}: Props) {
  const normalized = useMemo(
    () => normalizeSelected(selectedForkIndex, forkTexts.length),
    [selectedForkIndex, forkTexts.length],
  );

  const options: ForkOption[] = useMemo(() => {
    return [
      {
        forkIndex: null,
        tag: branchLabel(),
        move: mainText || "(手がありません)",
        selected: normalized == null,
      },
      ...forkTexts.map((t, i) => ({
        forkIndex: i,
        tag: branchLabel(i),
        move: t || "(手がありません)",
        selected: normalized === i,
      })),
    ];
  }, [forkTexts, mainText, normalized]);

  const selfRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const [actions, setActions] = useState<ActionsState | null>(null);

  const setBothRef = useCallback(
    (el: HTMLDivElement | null) => {
      selfRef.current = el;
      if (menuRef) menuRef.current = el;
    },
    [menuRef],
  );

  const updatePosition = () => {
    const menu = selfRef.current;
    if (!menu) return;

    setPos(
      placeBelowOrAbove(
        anchorEl.getBoundingClientRect(),
        { width: menu.offsetWidth, height: menu.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  };

  useLayoutEffect(() => {
    updatePosition();
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorEl, options.length]);

  useLayoutEffect(() => {
    if (!pos) return;

    const onResize = () => updatePosition();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  const style: CSSProperties = pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 };

  const openActionsForRow = (
    rowEl: HTMLElement,
    canUp: boolean,
    canDown: boolean,
    forkIndex: number | null,
  ) => {
    const branchIndex = branchIndexFromSelection(forkIndex);
    const r = rowEl.getBoundingClientRect();

    setActions((prev) => {
      if (prev && prev.branchIndex === branchIndex) return null;

      return { branchIndex, canUp, canDown, anchorRect: r };
    });
  };

  const handleRowContextMenu = (
    e: MouseEvent<HTMLElement>,
    canUp: boolean,
    canDown: boolean,
    forkIndex: number | null,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    openActionsForRow(e.currentTarget, canUp, canDown, forkIndex);
  };

  const handleItemPointerDown = (e: PointerEvent<HTMLElement>, forkIndex: number | null) => {
    // 選ぶのは左ボタンだけ。右ボタンは行の contextmenu で操作のサーフェスを開く
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;

    setActions(null);
    onSelect(forkIndex);
    onClose();
  };

  const handleMorePointerDown = (
    e: PointerEvent<HTMLElement>,
    canUp: boolean,
    canDown: boolean,
    forkIndex: number | null,
  ) => {
    // 右ボタンは行の contextmenu が受けるので、ここでは左ボタンだけを見る
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;

    const rowEl = e.currentTarget.closest(".kifu-forkmenu__row") as HTMLElement | null;
    if (!rowEl) return;
    openActionsForRow(rowEl, canUp, canDown, forkIndex);
  };

  const handleSwapUp = () => {
    if (actions) onSwap(actions.branchIndex, "up");
  };

  const handleSwapDown = () => {
    if (actions) onSwap(actions.branchIndex, "down");
  };

  const handleDelete = () => {
    if (actions) onDelete(actions.branchIndex);
  };

  return createPortal(
    <div
      ref={setBothRef}
      id={id}
      className="kifu-forkmenu"
      style={style}
      role="menu"
      aria-label={`${te}手目の分岐`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onScroll={() => {
        // 操作のサーフェスは開いたときの行の矩形に置く。メニューの中を流すと行だけが動き、
        // サーフェスが別の行の横に残るので閉じる
        if (actions) setActions(null);
      }}
    >
      {options.map((opt, idx) => {
        const canUp = idx > 0;
        const canDown = idx < options.length - 1;

        return (
          <div
            key={opt.forkIndex == null ? "main" : `fork-${opt.forkIndex}`}
            className="kifu-forkmenu__row"
            role="none"
            onContextMenu={(e) => handleRowContextMenu(e, canUp, canDown, opt.forkIndex)}
          >
            <button
              type="button"
              className="kifu-forkmenu__item"
              role="menuitemradio"
              aria-checked={opt.selected}
              aria-disabled={busy}
              data-selected={opt.selected ? "1" : "0"}
              onPointerDown={(e) => handleItemPointerDown(e, opt.forkIndex)}
            >
              <span className="kifu-forkmenu__tag">{opt.tag}</span>
              <span className="kifu-forkmenu__move" title={opt.move}>
                {opt.move}
              </span>
              <span className="kifu-forkmenu__check">{opt.selected ? "✓" : ""}</span>
            </button>

            <button
              type="button"
              className="kifu-forkmenu__more"
              aria-label="分岐の操作"
              disabled={busy}
              onPointerDown={(e) => handleMorePointerDown(e, canUp, canDown, opt.forkIndex)}
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
        );
      })}

      <KifuForkActions
        open={!!actions}
        busy={busy}
        canUp={!!actions?.canUp}
        canDown={!!actions?.canDown}
        anchorRect={actions?.anchorRect ?? null}
        onClose={() => setActions(null)}
        onUp={handleSwapUp}
        onDown={handleSwapDown}
        onDelete={handleDelete}
      />
    </div>,
    document.body,
  );
});

export default KifuForkMenu;
