import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AnalysisSessionId } from "./tauri";
import type { AnalysisResult, UnresponsiveReason } from "@/entities/engine/api/rust-types";
import { EVENT_NAMES } from "./eventNames";

type AnalysisUpdate = { sessionId: AnalysisSessionId; result: AnalysisResult };
// ===== リアルタイムイベントリスナー =====
/**
 * 解析の途中経過を受ける。
 *
 * **`sessionId` を捨てないこと。** 前の探索が畳まりきる前に次の `go` が出ると、
 * 古い局面の `info` が新しいリスナーへ配られる。照合しないと、前の局面の
 * 評価値と読み筋が現在の盤面の解析結果として画面に出る（Rust 側が
 * `AnalysisUpdate` の doc に同じことを書いている）。
 */
async function listenToAnalysisUpdates(
  callback: (sessionId: AnalysisSessionId, result: AnalysisResult) => void,
): Promise<UnlistenFn> {
  return await listen<AnalysisUpdate>(EVENT_NAMES.ANALYSIS_UPDATE, (event) => {
    const p: AnalysisUpdate = event.payload;
    callback(p.sessionId, p.result);
  });
}

/**
 * エンジンが自分で探索を終えた通知。`stop` の答えはここに来ない。
 * **`sessionId` を照合すること**——一致しない完了通知を採ると、走っている別の席が
 * 終わったことになる。
 */
async function listenToAnalysisComplete(
  callback: (sessionId: AnalysisSessionId, result: AnalysisResult) => void,
): Promise<UnlistenFn> {
  return await listen<{ sessionId: AnalysisSessionId; result: AnalysisResult }>(
    EVENT_NAMES.ANALYSIS_COMPLETE,
    (event) => {
      callback(event.payload.sessionId, event.payload.result);
    },
  );
}

/**
 * プロセスの通知の購読先。`request` はそのプロセスを起動した要求の番号で、
 * **最後に撃った番号と照合すること**——起動し直している最中に古いプロセスの通知が届く。
 */
export interface EngineEventListeners {
  onExited: (request: number, lastOutput: string | null) => void;
  onUnresponsive: (request: number, reason: UnresponsiveReason, lastOutput: string | null) => void;
  onAnswered: (request: number) => void;
}

// ===== 統合リスナー =====
interface AnalysisEventListeners {
  onUpdate?: (sessionId: AnalysisSessionId, result: AnalysisResult) => void;
  onComplete?: (sessionId: AnalysisSessionId, result: AnalysisResult) => void;
}

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
  const { onUpdate, onComplete } = listeners;
  return subscribeAll([
    ...(onUpdate ? [() => listenToAnalysisUpdates(onUpdate)] : []),
    ...(onComplete ? [() => listenToAnalysisComplete(onComplete)] : []),
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
