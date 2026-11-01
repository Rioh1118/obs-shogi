import { useEffect, useRef, type ReactNode } from "react";
import { useOverlayLayer } from "@/shared/lib/overlayStack";
import "./Modal.scss";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

/** Tab で辿れる要素。`disabled` は辿れないので、busy のボタンはここに入らない */
const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

type ModalVariant = "dialog" | "workspace";
type ModalSize = "sm" | "md" | "lg" | "xl";
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
  variant?: ModalVariant;
  size?: ModalSize;
  scroll?: ModalScroll;

  closeOnEsc?: boolean;
  closeOnOverlay?: boolean;
  showCloseButton?: boolean;
}

function Modal({
  children,
  onClose,
  label,

  variant = "dialog",
  size = "md",
  scroll = "none",

  closeOnEsc = true,
  closeOnOverlay = true,
  showCloseButton = false,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  // 開いている間だけマウントされる
  const isTop = useOverlayLayer(true);

  // 開いたときに中へフォーカスを移し、開いている間は中に閉じ込める。
  //
  // 閉じ込めが要るのは、**開いたままフォーカスを失う経路がある**ため。
  // フォーカスを持つ要素が `disabled` になるとブラウザは blur し、行き先は `<body>`
  // になる。`#modal-root` は `#root` の後ろにあるので、そこからの Tab は
  // オーバーレイの裏のアプリ本体へ入っていく。閉じたら元の場所へ返す（残っていれば）
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    if (!card) return;

    /**
     * Tab の順に並ぶ、実際に焦点を取れる要素を返す。
     *
     * 隠れた面の中のボタンを落とす。`querySelectorAll` は `display: none` を除かないので、
     * 隠れたボタンが折り返しの端に選ばれると、そこからの Tab は**器の外へ抜ける**。
     *
     * 見るのは `hidden` 属性で、`checkVisibility()` は使わない。
     * 実装差が大きく（happy-dom は `[hidden]` に `true` を返す）、テストから見えなくなる。
     */
    const focusables = () =>
      [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.closest("[hidden]") === null,
      );
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

      // 開いた引き金が同じコミットで消えている経路がある（右クリックのメニューから
      // 削除の確認へ、インライン編集が畳まれてから失敗のモーダルへ）。そのとき
      // `restoreTo` は `<body>` なので、返すとフォーカスが文書の先頭へ落ちる。
      // 返せる先が無いなら何もしない
      if (restoreTo && restoreTo !== document.body && restoreTo.isConnected) {
        restoreTo.focus();
      }
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

    // バブル段で聞く。キャプチャ段だと `#modal-root` に張られた React のハンドラより先に走り、
    // 中の入力が Escape を使う経路（`TagsInput` は打ちかけの文字を消す）が届く前に閉じられる。
    //
    // **内側は `preventDefault()` で降ろす。** `stopPropagation()` は `document` まで届かないので、
    // 消すものが無いときも Escape が無反応になる
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeOnEsc, onClose, isTop]);

  const root = document.getElementById("modal-root") ?? document.body;

  return createPortal(
    <div className={`modal modal--dark modal--${variant} modal--size-${size}`}>
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
