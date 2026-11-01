import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { subscribeAll } from "@/shared/api/event/subscribeAll";

import type {
  CancelSearchInput,
  OpenProjectInput,
  OpenProjectOutput,
  SearchPositionInput,
  SearchPositionOutput,
} from "./contract";
import {
  EVT_INDEX_PROGRESS,
  EVT_INDEX_STATE,
  EVT_INDEX_WARN,
  EVT_SEARCH_BEGIN,
  EVT_SEARCH_CHUNK,
  EVT_SEARCH_END,
  EVT_SEARCH_ERROR,
  type IndexProgressPayload,
  type IndexStatePayload,
  type IndexWarnPayload,
  type SearchBeginPayload,
  type SearchChunkPayload,
  type SearchEndPayload,
  type SearchErrorPayload,
} from "./events";
import type { RequestId } from "./ids";

export async function openProject(rootDir: string): Promise<OpenProjectOutput> {
  const input: OpenProjectInput = { rootDir };
  return await invoke<OpenProjectOutput>("open_project", { input });
}

/**
 * 局面検索を始める。Rust は検索を spawn して番号をすぐ返すので、解決は検索の完了を待たない。
 * 結果は `EVT_SEARCH_CHUNK` で届く。
 */
export async function searchPosition(input: SearchPositionInput): Promise<SearchPositionOutput> {
  return await invoke<SearchPositionOutput>("search_position", { input });
}

/** 進行中の検索を取り消す。Rust は終わった検索の番号でも `Ok` を返す。 */
export async function cancelSearch(requestId: RequestId): Promise<void> {
  const input: CancelSearchInput = { requestId };
  await invoke<void>("cancel_search", { input });
}

export type SearchEventHandlers = {
  onIndexState: (p: IndexStatePayload) => void;
  onIndexProgress: (p: IndexProgressPayload) => void;
  onIndexWarn: (p: IndexWarnPayload) => void;

  onSearchBegin: (p: SearchBeginPayload) => void;
  onSearchChunk: (p: SearchChunkPayload) => void;
  onSearchEnd: (p: SearchEndPayload) => void;
  onSearchError: (p: SearchErrorPayload) => void;
};

function subscribePayload<T>(name: string, handler: (payload: T) => void) {
  return () => listen<T>(name, (event) => handler(event.payload));
}

/** 全部のイベントを順に購読する。途中で失敗したら、張れた分を解除して投げ直す。 */
export function listenSearchEvents(handlers: SearchEventHandlers): Promise<() => void> {
  return subscribeAll([
    subscribePayload(EVT_INDEX_STATE, handlers.onIndexState),
    subscribePayload(EVT_INDEX_PROGRESS, handlers.onIndexProgress),
    subscribePayload(EVT_INDEX_WARN, handlers.onIndexWarn),
    subscribePayload(EVT_SEARCH_BEGIN, handlers.onSearchBegin),
    subscribePayload(EVT_SEARCH_CHUNK, handlers.onSearchChunk),
    subscribePayload(EVT_SEARCH_END, handlers.onSearchEnd),
    subscribePayload(EVT_SEARCH_ERROR, handlers.onSearchError),
  ]);
}
