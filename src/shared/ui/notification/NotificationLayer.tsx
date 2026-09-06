import { createPortal } from "react-dom";
import Modal from "@/shared/ui/Modal";
import { useNotifications } from "@/shared/lib/notification/useNotifications";
import type { Notification } from "@/shared/lib/notification/types";
import Notice from "./Notice";
import "./NotificationLayer.scss";

/**
 * グローバルの3経路（`toast` / `banner` / `modal`）を**1箇所で描く**
 * （ADR-0004 決定4・決定6）。
 *
 * 6箇所に表示・消す導線・再試行を手書きすると、表示を6回書くことになる。
 * 手書きは既に1回失敗していて、唯一の読み手がツリーごと消す実装になっていた。
 *
 * **インラインはここに来ない。** 置き場がコンポーネントの中にあるので、
 * ここからは描けない（`InlineNotice`）。
 */
export default function NotificationLayer() {
  const { notifications, dismiss } = useNotifications();

  const banners = notifications.filter((n) => n.presentation === "banner");
  const toasts = notifications.filter((n) => n.presentation === "toast");
  // **重ねない。** 2枚目が上に乗ると、1枚目を読み終える前に塞がれる。
  // 出た順の先頭を出し切ってから次へ進む
  const modal = notifications.find((n) => n.presentation === "modal");

  // タイトルバーの下から敷く。あの帯は `decorations: false` のウィンドウを
  // 動かす唯一の手段なので、覆うと窓を掴めなくなる（`Modal.scss` と同じ理由）
  const root = document.getElementById("modal-root") ?? document.body;

  return (
    <>
      {createPortal(
        <div className="notice-layer">
          {banners.length > 0 && (
            <div className="notice-layer__banners">
              {banners.map((n) => (
                <Notice key={n.id} {...toNoticeProps(n)} onDismiss={() => dismiss(n.id)} />
              ))}
            </div>
          )}
          {toasts.length > 0 && (
            <div className="notice-layer__toasts">
              {toasts.map((n) => (
                <Notice
                  key={n.id}
                  {...toNoticeProps(n)}
                  className="notice--toast"
                  onDismiss={() => dismiss(n.id)}
                />
              ))}
            </div>
          )}
        </div>,
        root,
      )}

      {modal && (
        <Modal onClose={() => dismiss(modal.id)} label={modal.title} size="sm" scroll="none">
          <Notice {...toNoticeProps(modal)} className="notice--modal" />
        </Modal>
      )}
    </>
  );
}

/**
 * 件数を出すのは**畳む鍵を持つ通知だけ**。鍵の無い通知は必ず 1 件なので、
 * そこに「1」が付くと数そのものに意味が無くなる
 */
function toNoticeProps(n: Notification) {
  return {
    tier: n.tier,
    title: n.title,
    body: n.body,
    actions: n.actions,
    count: n.dedupeKey === undefined ? undefined : n.count,
  };
}
