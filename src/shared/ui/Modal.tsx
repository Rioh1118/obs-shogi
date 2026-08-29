import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useOverlayLayer } from "@/shared/lib/overlayStack";
import "./Modal.scss";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

/** Tab で辿れる要素。`disabled` は辿れないので、busy のボタンはここに入らない */
const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

type ModalTheme = "light" | "dark";
type ModalVariant = "dialog" | "workspace";
type ModalSize = "sm" | "md" | "lg" | "xl";
type ModalChrome = "card" | "none";
type ModalPadding = "none" | "md";
type ModalScroll = "card" | "content" | "none";

interface ModalProps {
  children: ReactNode;
  onClose: () => void;
  /**
   * 支援技術に読ませる名前。**必須。**
   * 無いと `role="dialog"` が全部「ダイアログ」としか読まれず、
   * 何が開いたのかが分からない。画面の見出しと同じ文にする
   */
  label: string;
  theme?: ModalTheme;
  variant?: ModalVariant;
  size?: ModalSize;
  chrome?: ModalChrome;
  padding?: ModalPadding;
  scroll?: ModalScroll;

  closeOnEsc?: boolean;
  closeOnOverlay?: boolean;
  showCloseButton?: boolean;
}

function Modal({
  children,
  onClose,
  label,

  // 対話の面は暗い側を既定にしてある（ADR-0005）。共通の `Button` は暗い面の上に
  // しか色を持たないので、既定を明るい側にすると theme を書き忘れたモーダルで
  // 「キャンセル」が背景に溶ける。既定を安全側に置いて書き忘れを事故にしない
  theme = "dark",
  variant = "dialog",
  size = "md",
  chrome = "card",
  padding = "md",
  scroll = "none",

  closeOnEsc = true,
  closeOnOverlay = true,
  showCloseButton = false,
}: ModalProps) {
  const className = useMemo(() => {
    return [
      "modal",
      `modal--${theme}`,
      `modal--${variant}`,
      `modal--size-${size}`,
      `modal--chrome-${chrome}`,
      `modal--pad-${padding}`,
    ].join(" ");
  }, [theme, variant, size, chrome, padding]);

  const cardRef = useRef<HTMLDivElement | null>(null);
  // 開いている間だけマウントされる
  const isTop = useOverlayLayer(true);

  // 開いたときに中へフォーカスを移し、開いている間は中に閉じ込める。
  //
  // 閉じ込めが要るのは、**開いたままフォーカスを失う経路がある**ため。
  // フォーカスを持つ要素が `disabled` になるとブラウザは blur し、行き先は `<body>`
  // になる。`#modal-root` は `#root` の後ろにあるので、そこからの Tab は
  // オーバーレイの裏のアプリ本体へ入っていく。閉じたら元の場所へ返す
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    if (!card) return;

    const focusables = () => [...card.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const pullBack = () => (focusables()[0] ?? card).focus();

    pullBack();

    const onFocusOut = (event: FocusEvent) => {
      if (!isTop()) return;

      const next = event.relatedTarget as Node | null;
      if (next && card.contains(next)) return;

      // disabled で blur したときは relatedTarget が null になる。
      // 実際にどこへ移ったかが決まってから確かめる
      queueMicrotask(() => {
        if (!card.isConnected || !isTop()) return;
        if (card.contains(document.activeElement)) return;
        pullBack();
      });
    };

    // 端での折り返し。ここを塞がないと、最初の要素から Shift+Tab で外へ出る
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !isTop()) return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        card.focus();
        return;
      }

      const edge = event.shiftKey ? items[0] : items[items.length - 1];
      if (document.activeElement !== edge) return;

      event.preventDefault();
      (event.shiftKey ? items[items.length - 1] : items[0]).focus();
    };

    card.addEventListener("focusout", onFocusOut);
    card.addEventListener("keydown", onKeyDown);

    return () => {
      card.removeEventListener("focusout", onFocusOut);
      card.removeEventListener("keydown", onKeyDown);

      restoreTo?.focus?.();
    };
  }, [isTop]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      // 重なっているときに閉じるのは最上位の1枚だけ。絞らないと、
      // 登録順のせいで**先に開いた下の1枚**が閉じる
      if (!isTop()) return;

      const isComposing = e.isComposing;
      if (e.key === "Escape" && closeOnEsc && !isComposing) {
        e.preventDefault();
        onClose();
        return;
      }
    };

    // **バブル段で聞く。** キャプチャ段だと、ポータル先（`#modal-root`）に張られた
    // React のハンドラより必ず先に走る。中の入力が Escape を自分の用途に使う
    // （`TagsInput` は打ちかけの文字を消す）経路が、届く前に閉じられて死ぬ。
    // バブルなら内側が先に処理でき、`e.defaultPrevented` でここが降りる
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeOnEsc, onClose, isTop]);

  const root = document.getElementById("modal-root") ?? document.body;

  return createPortal(
    <div className={className}>
      <div
        className="modal__overlay"
        onClick={() => {
          if (!closeOnOverlay) return;
          onClose();
        }}
      >
        <div
          ref={cardRef}
          className={`modal__card modal__card--scroll-${scroll}`}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          {showCloseButton && (
            <button type="button" className="modal__close" aria-label="閉じる" onClick={onClose}>
              <X size={18} />
            </button>
          )}
          {scroll === "content" ? <div className="modal__body">{children}</div> : children}
        </div>
      </div>
    </div>,
    root,
  );
}

export default Modal;
