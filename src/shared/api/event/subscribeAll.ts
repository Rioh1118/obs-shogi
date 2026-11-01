import type { UnlistenFn } from "@tauri-apps/api/event";

/**
 * 順に購読する。途中で落ちたら、そこまでに登録した分を解除してから投げ直す。
 *
 * 登録が残ると、畳まれた画面のハンドラが呼ばれ続ける。受け取る側は畳まれた後にタイマーを張るので、
 * `window` が消えた環境ではそのタイマー自身が投げる
 */
export async function subscribeAll(subscribes: (() => Promise<UnlistenFn>)[]): Promise<() => void> {
  const unlisteners: UnlistenFn[] = [];

  /** 解除は1本ずつ包む。1本目が投げても残りを解除する */
  const unlistenAll = () => {
    for (const unlisten of unlisteners) {
      try {
        unlisten();
      } catch (e) {
        console.debug("[EVENT] unlisten failed (ignored)", e);
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
