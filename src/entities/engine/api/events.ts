import { listen } from "@tauri-apps/api/event";
import { subscribeAll } from "@/shared/api/event/subscribeAll";
import type { UnresponsiveReason } from "./rust-types";
import { EVENT_NAMES } from "./eventNames";

/**
 * プロセスの通知の購読先。`request` はそのプロセスを起動した要求の番号。
 * **最後の要求の番号と照合する。** 起動し直している最中に古いプロセスの通知が届く
 */
export type EngineEventListeners = {
  onExited: (request: number, lastOutput: string | null) => void;
  onUnresponsive: (request: number, reason: UnresponsiveReason, lastOutput: string | null) => void;
  onAnswered: (request: number) => void;
};

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
