import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AnalysisSessionId } from "./tauri";
import type { AnalysisResult, UnresponsiveReason } from "./rust-types";
import { EVENT_NAMES } from "./eventNames";

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
 * プロセスの通知の購読先。`request` はそのプロセスを起動した要求の番号で、
 * **最後に撃った番号と照合すること**——起動し直している最中に古いプロセスの通知が届く。
 */
export type EngineEventListeners = {
  onExited: (request: number, lastOutput: string | null) => void;
  onUnresponsive: (request: number, reason: UnresponsiveReason, lastOutput: string | null) => void;
  onAnswered: (request: number) => void;
};

/**
 * 解析の通知の購読先。**`sessionId` を照合すること。**
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

/**
 * 順に購読する。**途中で落ちたら、そこまでに登録した分を解除してから投げ直す。**
 *
 * 解除する者が居ないまま登録が残ると、畳まれた画面のハンドラが呼ばれ続ける
 * ——受け取る側は畳まれた後にタイマーを張るので、`window` が消えた環境では
 * そのタイマー自身が投げる。
 */
async function subscribeAll(subscribes: (() => Promise<UnlistenFn>)[]): Promise<() => void> {
  const unlisteners: UnlistenFn[] = [];

  /** 解除は1本ずつ包む。**1本目が投げても残りを解除する。** */
  const unlistenAll = () => {
    for (const unlisten of unlisteners) {
      try {
        unlisten();
      } catch (e) {
        console.debug("[ENGINE] unlisten failed (ignored)", e);
      }
    }
    unlisteners.length = 0;
  };

  try {
    for (const subscribe of subscribes) {
      unlisteners.push(await subscribe());
    }
  } catch (e) {
    unlistenAll();
    throw e;
  }

  return unlistenAll;
}

/** 解析の通知を購読する */
export async function setupAnalysisEventListeners(
  listeners: AnalysisEventListeners,
): Promise<() => void> {
  return subscribeAll([
    () => listenToAnalysisEvent(EVENT_NAMES.ANALYSIS_UPDATE, listeners.onUpdate),
    () => listenToAnalysisEvent(EVENT_NAMES.ANALYSIS_COMPLETE, listeners.onComplete),
  ]);
}

/** プロセスの通知を購読する */
export async function setupEngineEventListeners(
  listeners: EngineEventListeners,
): Promise<() => void> {
  return subscribeAll([
    () =>
      listen<{ request: number; lastOutput: string | null }>(EVENT_NAMES.ENGINE_EXITED, (event) => {
        listeners.onExited(event.payload.request, event.payload.lastOutput);
      }),
    () =>
      listen<{ request: number; reason: UnresponsiveReason; lastOutput: string | null }>(
        EVENT_NAMES.ENGINE_UNRESPONSIVE,
        (event) => {
          const { request, reason, lastOutput } = event.payload;
          listeners.onUnresponsive(request, reason, lastOutput);
        },
      ),
    () =>
      listen<{ request: number }>(EVENT_NAMES.ENGINE_ANSWERED, (event) => {
        listeners.onAnswered(event.payload.request);
      }),
  ]);
}
