import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { GameEvent } from "./rust-types";

/**
 * 対局の出来事を運ぶ Tauri のイベント名。種類ごとに分けず、順序を保つために1本にする。
 *
 * 綴りは Rust の `GAME_EVENT`（`engine/commands/game.rs`）と揃える。食い違うと `emit` は
 * 成功したまま何も届かない。突き合わせは `src/__tests__/gameEventChannel.test.ts`。
 */
export const GAME_EVENT = "game-event";

/**
 * 対局の出来事を購読する。
 *
 * `moveDecided` を受けたら `continueGame` か `endGameByRule` を返す。どちらも呼ばないと
 * 対局はその場で止まり、`RULING_TIMEOUT` で終局する。
 */
export async function listenToGameEvents(
  callback: (event: GameEvent) => void,
): Promise<UnlistenFn> {
  return await listen<GameEvent>(GAME_EVENT, (event) => {
    callback(event.payload);
  });
}
