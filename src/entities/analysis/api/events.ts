import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AnalysisResult } from "@/entities/engine";
import { subscribeAll } from "@/shared/api/event/subscribeAll";
import { ANALYSIS_EVENT_NAMES } from "./eventNames";
import type { AnalysisSessionId } from "./tauri";

type AnalysisEvent = { sessionId: AnalysisSessionId; result: AnalysisResult };

type AnalysisEventListener = (sessionId: AnalysisSessionId, result: AnalysisResult) => void;

function listenToAnalysisEvent(
  eventName: string,
  callback: AnalysisEventListener,
): Promise<UnlistenFn> {
  return listen<AnalysisEvent>(eventName, (event) => {
    callback(event.payload.sessionId, event.payload.result);
  });
}

/**
 * 解析の通知の購読先。**どちらも `sessionId` を照合する。**
 *
 * - `onUpdate`: 解析の途中経過。前の探索が畳まりきる前に次の `go` が出ると、古い局面の `info` が
 *   新しいリスナーへ配られる。照合しないと、前の局面の評価値と読み筋が現在の盤面の結果として出る
 * - `onComplete`: エンジンが自分で探索を終えた通知。`stop` の答えはここに来ない。
 *   照合しないと、走っている別の席が終わったことになる
 */
type AnalysisEventListeners = {
  onUpdate: AnalysisEventListener;
  onComplete: AnalysisEventListener;
};

export async function setupAnalysisEventListeners(
  listeners: AnalysisEventListeners,
): Promise<() => void> {
  return subscribeAll([
    () => listenToAnalysisEvent(ANALYSIS_EVENT_NAMES.UPDATE, listeners.onUpdate),
    () => listenToAnalysisEvent(ANALYSIS_EVENT_NAMES.COMPLETE, listeners.onComplete),
  ]);
}
