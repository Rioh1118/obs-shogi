import type { ForkPointer } from "@/types";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import KifuForkActions from "./KifuForkActions";

type Props = {
  te: number;
  mainText: string; // 本譜の表示
  forkTexts: string[];
  selectedForkIndex: number | null;
  busy: boolean;

  branchForkPointers: ForkPointer[];

  anchorEl: HTMLButtonElement; // ⎇ボタン
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

    // 先に実サイズを使って clamp
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;

    const margin = 8;

    // 右揃え気味（⎇ボタンの右端に合わせる）
    let left = a.right - mw;
    left = Math.max(margin, Math.min(vw - mw - margin, left));

    // 下に出す。入らなければ上に反転
    const spaceBelow = vh - a.bottom;
    const spaceAbove = a.top;

    let top: number;
    if (spaceBelow >= mh + margin) {
      top = a.bottom + 6;
    } else if (spaceAbove >= mh + margin) {
      top = a.top - mh - 6;
    } else {
      // どっちも厳しいなら、とりあえず画面内に押し込む
      top = Math.max(margin, Math.min(vh - mh - margin, a.bottom + 6));
    }

    setPos({ top, left });
  };

  useLayoutEffect(() => {
    // マウント直後と、内容変化時に測る
    updatePosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorEl, options.length]);

  useLayoutEffect(() => {
    if (!pos) return;

    const onResize = () => updatePosition();
    // capture=true でスクロール（親スクロール含む）も拾う
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  // pos がまだなら一旦画面外（チラつき防止）
  const style: React.CSSProperties = pos
    ? { top: pos.top, left: pos.left }
    : { top: -9999, left: -9999 };

  return createPortal(
    <div
      ref={setBothRef}
      className="kifu-forkmenu"
      style={style}
      role="menu"
      aria-label={`${te}手目の分岐`}
      // 外側クリック判定に吸われないように
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((opt, idx) => {
        const canUp = idx > 0;
        const canDown = idx < options.length - 1;
        return (
          <div
            key={opt.forkIndex == null ? "main" : `fork-${opt.forkIndex}`}
            className="kifu-forkmenu__row"
            role="none"
          >
            <button
              type="button"
              className="kifu-forkmenu__item"
              role="menuitemradio"
              aria-checked={opt.selected}
              aria-disabled={busy}
              data-selected={opt.selected ? "1" : "0"}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (busy) return;
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

            <KifuForkActions
              busy={busy}
              canUp={canUp}
              canDown={canDown}
              onUp={() => {
                onSwap(opt.branchIndex, "up");
                onClose();
              }}
              onDown={() => {
                onSwap(opt.branchIndex, "down");
                onClose();
              }}
              onDelete={() => {
                onDelete(opt.branchIndex);
                onClose();
              }}
            />
          </div>
        );
      })}
    </div>,
    document.body,
  );
});

export default KifuForkMenu;
