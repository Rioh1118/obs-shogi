import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { GameEvent } from "./rust-types";

/**
 * 対局の出来事はこの1本にまとまっている。
 *
 * **綴りは Rust 側（`engine/commands/game.rs` の `GAME_EVENT`）と一致している
 * こと。** 食い違うと `emit` は成功したまま何も届かず、症状は「購読を張り忘れた
 * とき」と同じ形になる。突き合わせは `src/__tests__/gameEventChannel.test.ts`。
 *
 * 種類ごとにイベント名を分けないのは、**順序を保つため**。
 * 別々の名前にすると `moveDecided` より先に `turnChanged` が届く並びを
 * 呼び出し側が自分で組み直すことになる。
 */
export const GAME_EVENT = "game-event";

/**
 * 対局の出来事を受け取る。
 *
 * **`moveDecided` を受けたら必ず `continueGame` か `endGameByRule` を返すこと。**
 * どちらも呼ばないと対局はその場で止まり、`RULING_TIMEOUT` で中断される。
 */
export async function listenToGameEvents(
  callback: (event: GameEvent) => void,
): Promise<UnlistenFn> {
  return await listen<GameEvent>(GAME_EVENT, (event) => {
    callback(event.payload);
  });
}
