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
 * 出す側は `notify` を呼ぶだけでよく、表示・閉じる導線・動作の並べ方が
 * 失敗ごとに散らない。いまどの失敗がどこへ出ているかは
 * `docs/state-transitions/failure-surfacing.md` §1・§2。
 *
 * **インラインはここに来ない。** 置き場がコンポーネントの中にあるので、
 * ここからは描けない（`InlineNotice`）。
 */
export default function NotificationLayer() {
  const { notifications, dismiss } = useNotifications();

  // **新着が可視の端に来るように並べる。** どちらの入れ物も高さに上限があり、
  // 溢れたぶんは巻き取られる。出た順のまま並べると巻き取られるのが常に新着側で、
  // 失敗が続いている間に出た最後の1件——いちばん段が重いことが多い——が
  // 一度も画面に出ない。`scrollTop` の初期値は 0 なので、見えているのは先頭
  const newestFirst = (list: Notification[]) => [...list].reverse();

  const banners = newestFirst(notifications.filter((n) => n.presentation === "banner"));
  const toasts = newestFirst(notifications.filter((n) => n.presentation === "toast"));
  // **重ねない。** 2枚目が上に乗ると、1枚目を読み終える前に塞がれる。
  // 出た順の先頭を出し切ってから次へ進む
  const modal = notifications.find((n) => n.presentation === "modal");

  // 読み上げるのは最後に積まれた1件だけ。全部を流すと、1件増えるたびに
  // 出ている分がまとめて読み直される。**畳まれたものは読み直さない**——
  // 同じ失敗が続いている間ずっと喋り続けることになる。
  // 閉じたときは1つ前が読まれるが、それは次に対処するものなので害が無い
  const newest = notifications[notifications.length - 1];
  const announcement = newest ? [newest.title, newest.body].filter(Boolean).join("。") : "";

  // モーダルと同じ器へ出す。`#modal-root` は `#root` の後ろにあるので、
  // 同じ段どうしなら DOM の順で重なりが決まる（`Modal.tsx` と同じ）。
  // 位置の話は `NotificationLayer.scss` が持つ
  const root = document.getElementById("modal-root") ?? document.body;

  return (
    <>
      {createPortal(
        <div className="notice-layer">
          {/* **読み上げの領域は出しっぱなしにする。** `role="status"` は
              「既に文書に在る領域の中身が変わったとき」に読まれる規約なので、
              領域と本文を同じ描画で挿し込むと読まれるかが実装依存になる。
              通知そのものの `role` は視覚の側の意味として別に残してある */}
          <p className="notice-layer__announce" aria-live="polite">
            {announcement}
          </p>
          {banners.length > 0 && (
            <div className="notice-layer__banners">
              {banners.map((n) => (
                <Notice
                  key={n.id}
                  {...toNoticeProps(n)}
                  className="notice--banner"
                  onDismiss={() => dismiss(n.id)}
                />
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
        // **中身をスクロールさせる。** 失敗の説明は切り詰めない方針で、動作は本文の下に
        // 並ぶ。`none` のままだと本文が伸びたときに「アプリを再起動」が画面外へ落ちて
        // 押せなくなる——閉じる手段は残るので行き止まりではないが、復帰導線だけが消える。
        // 可変長の失敗文を出す既存のモーダル（KifuReadErrorDialog / FileConflictDialog）も
        // 同じ選択をしている
        <Modal onClose={() => dismiss(modal.id)} label={modal.title} size="sm" scroll="content">
          {/* **閉じる手段を目に見える形で置く。** Modal は Escape とオーバーレイでも
              閉じるが、どちらも画面に出ていない。押すものが1つも無い画面は行き止まりに見える */}
          {/* **鍵は `Notice` に付ける。`Modal` に付けない。** モーダルは1枚ずつなので
              2枚目は1枚目が消えた瞬間に同じ位置へ入り、鍵が無いと React が再マウントせず、
              1枚目の失敗の理由と走行中の状態が2枚目へ持ち越される。
              `Modal` を作り直すと `useOverlayLayer` の積み降ろしとフォーカスの戻し先が
              入れ替わるので、鍵は中身の側にだけ置く */}
          <Notice
            key={modal.id}
            {...toNoticeProps(modal)}
            className="notice--modal"
            onDismiss={() => dismiss(modal.id)}
          />
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
