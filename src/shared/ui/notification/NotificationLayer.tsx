import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Modal from "@/shared/ui/Modal";
import { useNotifications } from "@/shared/lib/notification/useNotifications";
import type { Notification } from "@/shared/lib/notification/types";
import Notice from "./Notice";
import NoticeBand from "./NoticeBand";
import { TIER_ICONS, TIER_ROLES } from "./tiers";
import { usePublishedHeight } from "./usePublishedHeight";
import "./NotificationLayer.scss";

/** 一度に見せる帯の数。残りは件数で言い、押すと並べる */
const SHOWN_BANDS = 2;

/** 残る知らせか。放っておけば消えるものは、帯にせず上の帯の空きに出す */
const isLasting = (n: Notification) =>
  n.presentation === "banner" || (n.presentation === "toast" && !n.autoDismiss);

/** 件数を出す条件は `Notification.count` の doc */
function toNoticeProps(n: Notification) {
  return {
    tier: n.tier,
    title: n.title,
    body: n.body,
    actions: n.actions,
    count: n.dedupeKey === undefined ? undefined : n.count,
  };
}

/**
 * グローバルの3経路（`toast`、`banner`、`modal`）を1箇所で描く（ADR-0004 決定4、決定6）。
 *
 * 残る知らせ（`banner` と、消えない `toast`）は、上の帯の下に1件1行。放っておけば消える `toast` は、
 * 本文を動かさないように上の帯の空きに1つだけ出す。
 *
 * 出す側は `notify` を呼ぶだけでよく、表示と閉じる導線が失敗ごとに散らない。
 * どの失敗がどこへ出るかは `docs/state-transitions/failure-surfacing.md`。
 * インラインは置き場が部品の中にあるのでここに来ない（`InlineNotice`）。
 */
export default function NotificationLayer() {
  const { notifications, dismiss } = useNotifications();

  const bandsRef = useRef<HTMLDivElement | null>(null);
  const [isAllShown, setIsAllShown] = useState(false);

  // **新着を先頭に並べる。** 見せる数に上限があるので、出た順のまま並べると、
  // 失敗が続いている間に出た最後の1件——いちばん tier が重いことが多い——が隠れる
  const newestFirst = (list: Notification[]) => [...list].reverse();

  const bands = newestFirst(notifications.filter(isLasting));
  const shownBands = isAllShown ? bands : bands.slice(0, SHOWN_BANDS);
  const hiddenCount = bands.length - SHOWN_BANDS;
  // 1行に1件ずつ、出た順に出す。時計が進むのも出ている1件だけ（`useAutoDismiss`）なので、
  // 後から来たものは前のものが消えてから出て、どれも読む時間を持つ
  const passing = notifications.find((n) => n.presentation === "toast" && n.autoDismiss);
  const PassingIcon = passing && TIER_ICONS[passing.tier];
  // **重ねない。** 2枚目が上に乗ると、1枚目を読み終える前に塞がれる。
  // 出た順の先頭を出し切ってから次へ進む
  const modal = notifications.find((n) => n.presentation === "modal");

  usePublishedHeight(bandsRef, "--notice-bands-h", bands.length > 0);

  // 読み上げるのは最後に積まれた1件だけ。全部を流すと、1件増えるたびに
  // 出ている分がまとめて読み直される。**まとめられたものは読み直さない**——
  // 同じ失敗が続いている間ずっと喋り続けることになる。
  // 閉じたときは1つ前が読まれるが、それは次に対処するものなので害が無い
  const newest = notifications[notifications.length - 1];
  const announcement = newest ? [newest.title, newest.body].filter(Boolean).join("。") : "";

  // モーダルと同じコンテナへ出す。`#modal-root` は `#root` の後ろにあるので、
  // z-index が同じなら DOM の順で重なりが決まる（`Modal.tsx` と同じ）。
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
          {bands.length > 0 && (
            <div className="notice-layer__bands" ref={bandsRef}>
              {shownBands.map((n, at) => (
                <NoticeBand
                  key={n.id}
                  {...toNoticeProps(n)}
                  onDismiss={() => dismiss(n.id)}
                  extra={
                    hiddenCount > 0 &&
                    at === shownBands.length - 1 && (
                      <button
                        type="button"
                        className="notice-band__action"
                        aria-expanded={isAllShown}
                        onClick={() => setIsAllShown((v) => !v)}
                      >
                        {isAllShown ? "ほかを隠す" : `ほか ${hiddenCount} 件`}
                      </button>
                    )
                  }
                />
              ))}
            </div>
          )}
          {passing && PassingIcon && (
            // 上の帯に乗るので、帯と同じくウィンドウを掴めるようにする。閉じるボタンは掴まない
            <div
              key={passing.id}
              className={`notice-line notice-line--${passing.tier}`}
              role={TIER_ROLES[passing.tier]}
              data-tauri-drag-region="deep"
            >
              <PassingIcon className="notice-line__icon" size={14} aria-hidden="true" />
              <p className="notice-line__title" title={passing.title}>
                {passing.title}
              </p>
              {passing.body && (
                <p className="notice-line__text" title={passing.body}>
                  {passing.body}
                </p>
              )}
              {passing.dedupeKey !== undefined && (
                <span className="notice-line__count">{passing.count}件</span>
              )}
              <button
                type="button"
                className="notice-line__close"
                aria-label={`「${passing.title}」を閉じる`}
                onClick={() => dismiss(passing.id)}
              >
                <X size={13} aria-hidden="true" />
              </button>
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
