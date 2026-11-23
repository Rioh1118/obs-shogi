import { useState } from "react";
import type { NotifyAction } from "@/shared/lib/notification/types";

/**
 * 通知の動作を走らせ、走っている1つと、失敗した1つを覚える。
 *
 * **添字でなく動作そのもので覚える。** 通知はまとめられると `actions` が丸ごと
 * 差し替わるのに id は動かない（再マウントしない）ので、添字で覚えると
 * 一度も押していないボタンが busy かつ押せない状態で残る。押せなくなるのは
 * たいてい「エンジンが応答しない」ときで、唯一の復帰導線がそれになる
 */
export function useNoticeActions(actions: readonly NotifyAction[]) {
  const [running, setRunning] = useState<NotifyAction | null>(null);
  const [failed, setFailed] = useState<NotifyAction | null>(null);

  const invoke = (action: NotifyAction) => {
    // **二重起動はここで止める。ボタンを `disabled` にしない。**
    // フォーカス中の要素が `disabled` になるとブラウザは blur し、行き先は `<body>`。
    // 通知は `#modal-root`（文書の末尾）に描かれるので、そこから戻るには
    // アプリ全体を Tab で辿り直すことになり、直後に出る失敗の理由へ帰れない
    if (running !== null) return;
    setFailed(null);
    setRunning(action);
    // `run` が同期で投げる場合も拾えるように、呼び出しごと Promise に入れる
    void Promise.resolve()
      .then(() => action.run())
      .catch((cause: unknown) => {
        // **画面には利用者の言葉、原因はログ。** どちらか片方に寄せると、
        // 押した人に伝わらないか、後から誰も辿れないかのどちらかになる
        console.error(`[notification] 「${action.label}」が失敗した`, cause);
        setFailed(action);
      })
      .finally(() => {
        // 走り終えたものだけを落とす。差し替わったあとの動作を消さない
        setRunning((current) => (current === action ? null : current));
      });
  };

  return {
    running,
    // 差し替えられた動作の失敗を、新しいボタンの下に出したままにしない
    failed: failed && actions.includes(failed) ? failed : null,
    invoke,
  };
}
