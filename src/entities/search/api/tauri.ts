import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  CancelSearchInput,
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

// ===== プロジェクト操作 =====

export async function openProject(rootDir: string): Promise<OpenProjectOutput> {
  return await invoke<OpenProjectOutput>("open_project", {
    input: { rootDir },
  });
}

// ===== 局面検索 =====

/**
 * 局面検索を開始。Rust 側は spawn してすぐ rid を返すので、この Promise は
 * 検索完了を待たず、直ちに resolve する。結果は EVT_SEARCH_CHUNK で届く。
 */
export async function searchPosition(input: SearchPositionInput): Promise<SearchPositionOutput> {
  return await invoke<SearchPositionOutput>("search_position", { input });
}

export async function searchPositionBestEffort(
  sfen: string,
  chunkSize: number = 5000,
): Promise<SearchPositionOutput> {
  return await searchPosition({
    sfen,
    consistency: "BestEffort",
    chunkSize,
  });
}

/**
 * 進行中の検索をキャンセル。フロント側 cleanup で必ず呼ぶ。
 */
export async function cancelSearch(requestId: number): Promise<void> {
  const input: CancelSearchInput = { requestId };
  await invoke<void>("cancel_search", { input });
}

// ===== イベント購読ヘルパ =====

export interface SearchEventHandlers {
  onIndexState?: (p: IndexStatePayload) => void;
  onIndexProgress?: (p: IndexProgressPayload) => void;
  onIndexWarn?: (p: IndexWarnPayload) => void;

  onSearchBegin?: (p: SearchBeginPayload) => void;
  onSearchChunk?: (p: SearchChunkPayload) => void;
  onSearchEnd?: (p: SearchEndPayload) => void;
  onSearchError?: (p: SearchErrorPayload) => void;
}

export async function listenSearchEvents(handlers: SearchEventHandlers): Promise<UnlistenFn> {
  const unlisteners: UnlistenFn[] = [];

  if (handlers.onIndexState) {
    unlisteners.push(
      await listen<IndexStatePayload>(EVT_INDEX_STATE, (e) => handlers.onIndexState?.(e.payload)),
    );
  }
  if (handlers.onIndexProgress) {
    unlisteners.push(
      await listen<IndexProgressPayload>(EVT_INDEX_PROGRESS, (e) =>
        handlers.onIndexProgress?.(e.payload),
      ),
    );
  }
  if (handlers.onIndexWarn) {
    unlisteners.push(
      await listen<IndexWarnPayload>(EVT_INDEX_WARN, (e) => handlers.onIndexWarn?.(e.payload)),
    );
  }
  if (handlers.onSearchBegin) {
    unlisteners.push(
      await listen<SearchBeginPayload>(EVT_SEARCH_BEGIN, (e) =>
        handlers.onSearchBegin?.(e.payload),
      ),
    );
  }
  if (handlers.onSearchChunk) {
    unlisteners.push(
      await listen<SearchChunkPayload>(EVT_SEARCH_CHUNK, (e) =>
        handlers.onSearchChunk?.(e.payload),
      ),
    );
  }
  if (handlers.onSearchEnd) {
    unlisteners.push(
      await listen<SearchEndPayload>(EVT_SEARCH_END, (e) => handlers.onSearchEnd?.(e.payload)),
    );
  }
  if (handlers.onSearchError) {
    unlisteners.push(
      await listen<SearchErrorPayload>(EVT_SEARCH_ERROR, (e) =>
        handlers.onSearchError?.(e.payload),
      ),
    );
  }

  return () => {
    for (const u of unlisteners) u();
  };
}
