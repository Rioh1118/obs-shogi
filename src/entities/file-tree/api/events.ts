import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { subscribeAll } from "@/shared/api/event/subscribeAll";

/**
 * ワークスペースの中身が変わった合図。`src-tauri/src/workspace/events.rs` の写し。
 * 一致は `src/__tests__/workspaceWire.test.ts` が見る。
 */
const EVT_WORKSPACE_CHANGED = "workspace-changed" as const;

/**
 * ツリーを読み直すきっかけを購読する。2つあり、どちらも中身を持たない。
 *
 * - 監視が変更の落ち着いたところで送る合図
 * - アプリのウィンドウにフォーカスが戻ったとき。監視が黙って止まっていても、
 *   監視がまだ起きていなくても（索引の構築が終わるまで起きない）、戻った時点でディスクと揃う
 *
 * 途中で落ちたら、張れた分を解除して投げ直す。
 */
export function listenWorkspaceChanges(onChange: () => void): Promise<() => void> {
  return subscribeAll([
    () => listen(EVT_WORKSPACE_CHANGED, () => onChange()),
    () =>
      getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused) onChange();
      }),
  ]);
}
