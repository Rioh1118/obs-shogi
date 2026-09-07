import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AnalysisSessionId } from "./tauri";
import type { AnalysisResult } from "@/entities/engine/api/rust-types";
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
export async function listenToAnalysisUpdates(
  callback: (sessionId: AnalysisSessionId, result: AnalysisResult) => void,
): Promise<UnlistenFn> {
  return await listen<AnalysisUpdate>(EVENT_NAMES.ANALYSIS_UPDATE, (event) => {
    const p: AnalysisUpdate = event.payload;
    callback(p.sessionId, p.result);
  });
}

/**
 * 探索の完了通知。**`sessionId` を照合すること**——一致しない完了通知を採ると、
 * 走っている別の席の表示が停止中に落ち、前の局面の評価値が残る。
 * `analysis-update` より結末が重い。
 */
export async function listenToAnalysisComplete(
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
 * エンジンのエラー通知。**上流の英文をそのまま画面へ出さないこと**——
 * `state.error` は利用者に見せる欄で、Rust の内部メッセージはログにだけ残す。
 */
export async function listenToEngineErrors(callback: (error: string) => void): Promise<UnlistenFn> {
  return await listen<string>(EVENT_NAMES.ENGINE_ERROR, (event) => {
    callback(event.payload);
  });
}

// ===== 統合リスナー =====
export interface AnalysisEventListeners {
  onUpdate?: (sessionId: AnalysisSessionId, result: AnalysisResult) => void;
  onComplete?: (sessionId: AnalysisSessionId, result: AnalysisResult) => void;
  onError?: (error: string) => void;
}

/**
 * 3つの通知を購読する。**途中で落ちたら、そこまでに登録した分を解除してから投げ直す。**
 *
 * 解除する者が居ないまま登録が残ると、畳まれた画面のハンドラが呼ばれ続ける
 * ——受け取る側は畳まれた後にタイマーを張るので、`window` が消えた環境では
 * そのタイマー自身が投げる。
 */
export async function setupAnalysisEventListeners(
  listeners: AnalysisEventListeners,
): Promise<() => void> {
  const unlisteners: UnlistenFn[] = [];

  /** 解除は1本ずつ包む。**1本目が投げても残りを解除する。** */
  const unlistenAll = () => {
    for (const unlisten of unlisteners) {
      try {
        unlisten();
      } catch (e) {
        console.debug("[ANALYSIS] unlisten failed (ignored)", e);
      }
    }
    unlisteners.length = 0;
  };

  try {
    if (listeners.onUpdate) {
      unlisteners.push(await listenToAnalysisUpdates(listeners.onUpdate));
    }

    if (listeners.onComplete) {
      unlisteners.push(await listenToAnalysisComplete(listeners.onComplete));
    }

    if (listeners.onError) {
      unlisteners.push(await listenToEngineErrors(listeners.onError));
    }
  } catch (e) {
    unlistenAll();
    throw e;
  }

  return unlistenAll;
}
