import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AnalysisResult } from "./types";
import { EVENT_NAMES } from "./constants";

// ===== リアルタイムイベントリスナー =====
export async function listenToAnalysisUpdates(
  callback: (result: AnalysisResult) => void,
): Promise<UnlistenFn> {
  return await listen<AnalysisResult>(EVENT_NAMES.ANALYSIS_UPDATE, (event) => {
    console.log("Analysis update received:", event.payload);
    callback(event.payload);
  });
}

export async function listenToAnalysisComplete(
  callback: (sessionId: string, result: AnalysisResult) => void,
): Promise<UnlistenFn> {
  return await listen<{ sessionId: string; result: AnalysisResult }>(
    EVENT_NAMES.ANALYSIS_COMPLETE,
    (event) => {
      console.log("Analysis complete:", event.payload);
      callback(event.payload.sessionId, event.payload.result);
    },
  );
}

export async function listenToEngineErrors(
  callback: (error: string) => void,
): Promise<UnlistenFn> {
  return await listen<string>(EVENT_NAMES.ENGINE_ERROR, (event) => {
    console.error("Engine error:", event.payload);
    callback(event.payload);
  });
}

// ===== 統合リスナー =====
export interface AnalysisEventListeners {
  onUpdate?: (result: AnalysisResult) => void;
  onComplete?: (sessionId: string, result: AnalysisResult) => void;
  onError?: (error: string) => void;
}

export async function setupAnalysisEventListeners(
  listeners: AnalysisEventListeners,
): Promise<() => void> {
  const unlisteners: UnlistenFn[] = [];

  if (listeners.onUpdate) {
    const unlisten = await listenToAnalysisUpdates(listeners.onUpdate);
    unlisteners.push(unlisten);
  }

  if (listeners.onComplete) {
    const unlisten = await listenToAnalysisComplete(listeners.onComplete);
    unlisteners.push(unlisten);
  }

  if (listeners.onError) {
    const unlisten = await listenToEngineErrors(listeners.onError);
    unlisteners.push(unlisten);
  }

  // 全リスナー解除関数を返す
  return () => {
    unlisteners.forEach((unlisten) => unlisten());
  };
}
