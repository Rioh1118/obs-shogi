import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import KifuForkActions from "./KifuForkActions";
import "./KifuForkMenu.scss";
import type { ForkPointer } from "@/entities/kifu/model/cursor";

type Props = {
  te: number;
  mainText: string;
  forkTexts: string[];
  selectedForkIndex: number | null;
  busy: boolean;

  branchForkPointers: ForkPointer[];

  anchorEl: HTMLButtonElement;
  onSelect: (forkIndex: number | null) => void;
  onClose: () => void;

  onSwap: (branchIndex: number, dir: "up" | "down") => void;
  onDelete: (branchIndex: number) => void;

  menuRef?: React.RefObject<HTMLDivElement | null>;
};

type Opt = {
  forkIndex: number | null;
  branchIndex: number;
  tag: string;
  move: string;
  selected: boolean;
};

function normalizeSelected(selected: number | null, n: number): number | null {
  if (selected == null) return null;
  return selected >= 0 && selected < n ? selected : null;
}

type ActionsState = {
  branchIndex: number;
  canUp: boolean;
  canDown: boolean;
  anchorRect: DOMRect;
};

const KifuForkMenu = memo(function KifuForkMenu({
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

  const options: Opt[] = useMemo(() => {
    return [
      {
        forkIndex: null,
        branchIndex: 0,
        tag: "本譜",
        move: mainText || "(手がありません)",
        selected: normalized == null,
      },
      ...forkTexts.map((t, i) => ({
        forkIndex: i,
        branchIndex: i + 1,
        tag: `変化${i + 1}`,
        move: t || "(手がありません)",
        selected: normalized === i,
      })),
    ];
  }, [forkTexts, mainText, normalized]);

  // fixed 位置
  const selfRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // actions popover
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

    const a = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;

    const margin = 8;

    let left = a.right - mw;
    left = Math.max(margin, Math.min(vw - mw - margin, left));

    const spaceBelow = vh - a.bottom;
    const spaceAbove = a.top;

    let top: number;
    if (spaceBelow >= mh + margin) {
      top = a.bottom + 6;
    } else if (spaceAbove >= mh + margin) {
      top = a.top - mh - 6;
    } else {
      top = Math.max(margin, Math.min(vh - mh - margin, a.bottom + 6));
    }

    setPos({ top, left });
  };

  useLayoutEffect(() => {
    updatePosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  const style: React.CSSProperties = pos
    ? { top: pos.top, left: pos.left }
    : { top: -9999, left: -9999 };

  const openActionsForRow = (
    rowEl: HTMLElement,
    canUp: boolean,
    canDown: boolean,
    branchIndex: number,
  ) => {
    const r = rowEl.getBoundingClientRect();

    setActions((prev) => {
      if (prev && prev.branchIndex === branchIndex) return null;

      return { branchIndex, canUp, canDown, anchorRect: r };
    });
  };

  return createPortal(
    <div
      ref={setBothRef}
      className="kifu-forkmenu"
      style={style}
      role="menu"
      aria-label={`${te}手目の分岐`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onScroll={() => {
        // スクロール時は追従させずに閉じる（ズレ事故を防ぐ）
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
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (busy) return;
              const rowEl = e.currentTarget as HTMLElement;
              openActionsForRow(rowEl, canUp, canDown, opt.branchIndex);
            }}
          >
            <button
              type="button"
              className="kifu-forkmenu__item"
              role="menuitemradio"
              aria-checked={opt.selected}
              aria-disabled={busy}
              data-selected={opt.selected ? "1" : "0"}
              onPointerDown={(e) => {
                // ✅ 左クリックだけ選択（右クリックは context menu 用）
                if (e.button !== 0) return;
                e.stopPropagation();
                e.preventDefault();
                if (busy) return;

                setActions(null);
                onSelect(opt.forkIndex);
                onClose();
              }}
            >
              <span className="kifu-forkmenu__tag">{opt.tag}</span>
              <span className="kifu-forkmenu__move" title={opt.move}>
                {opt.move}
              </span>
              <span className="kifu-forkmenu__check">
                {opt.selected ? "✓" : ""}
              </span>
            </button>

            <button
              type="button"
              className="kifu-forkmenu__more"
              aria-label="分岐の操作"
              disabled={busy}
              onPointerDown={(e) => {
                // 左ボタンだけで開く（右クリックは contextmenu）
                if (e.button !== 0) return;
                e.stopPropagation();
                e.preventDefault();
                if (busy) return;

                const rowEl = (e.currentTarget as HTMLElement).closest(
                  ".kifu-forkmenu__row",
                ) as HTMLElement | null;
                if (!rowEl) return;
                openActionsForRow(rowEl, canUp, canDown, opt.branchIndex);
              }}
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
        onUp={() => {
          if (!actions) return;
          onSwap(actions.branchIndex, "up");
        }}
        onDown={() => {
          if (!actions) return;
          onSwap(actions.branchIndex, "down");
        }}
        onDelete={() => {
          if (!actions) return;
          onDelete(actions.branchIndex);
        }}
      />
    </div>,
    document.body,
  );
});

export default KifuForkMenu;
