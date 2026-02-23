//
// ===== プロジェクト操作 =====

import { invoke } from "@tauri-apps/api/core";
import type {
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
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RequestId } from "./ids";

/**
 * ルートディレクトリ配下をスキャンしてインデックス構築を開始する。
// commands/search/index.ts
 * 結果（進捗/完了）はイベントで受け取る。
 */
export async function openProject(rootDir: string): Promise<OpenProjectOutput> {
  return await invoke<OpenProjectOutput>("open_project", {
    input: { root_dir: rootDir },
  });
}

// ===== 局面検索 =====

/**
 * 局面検索を開始（結果はイベントで chunk として届く）
 */
export async function searchPosition(
  input: SearchPositionInput,
): Promise<SearchPositionOutput> {
  return await invoke<SearchPositionOutput>("search_position", { input });
}

/**
 * よく使うショートカット：BestEffort + chunk_size デフォルト
 */
export async function searchPositionBestEffort(
  sfen: string,
  chunkSize: number = 5000,
): Promise<SearchPositionOutput> {
  return await searchPosition({
    sfen,
    consistency: "BestEffort",
    chunk_size: chunkSize,
  });
}

// ===== イベント購読ヘルパ =====

export interface SearchEventHandlers {
  // index events
  onIndexState?: (p: IndexStatePayload) => void;
  onIndexProgress?: (p: IndexProgressPayload) => void;
  onIndexWarn?: (p: IndexWarnPayload) => void;

  // search events
  onSearchBegin?: (p: SearchBeginPayload) => void;
  onSearchChunk?: (p: SearchChunkPayload) => void;
  onSearchEnd?: (p: SearchEndPayload) => void;
  onSearchError?: (p: SearchErrorPayload) => void;
}

/**
 * search モジュールのイベントをまとめて購読し、unlisten関数を返す。
 * Reactなら useEffect で呼んで、cleanupで unlistenAll() を呼ぶ運用が安全。
 */
export async function listenSearchEvents(
  handlers: SearchEventHandlers,
): Promise<UnlistenFn> {
  const unlisteners: UnlistenFn[] = [];

  if (handlers.onIndexState) {
    unlisteners.push(
      await listen<IndexStatePayload>(EVT_INDEX_STATE, (e) =>
        handlers.onIndexState?.(e.payload),
      ),
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
      await listen<IndexWarnPayload>(EVT_INDEX_WARN, (e) =>
        handlers.onIndexWarn?.(e.payload),
      ),
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
      await listen<SearchEndPayload>(EVT_SEARCH_END, (e) =>
        handlers.onSearchEnd?.(e.payload),
      ),
    );
  }

  if (handlers.onSearchError) {
    unlisteners.push(
      await listen<SearchErrorPayload>(EVT_SEARCH_ERROR, (e) =>
        handlers.onSearchError?.(e.payload),
      ),
    );
  }

  // まとめて解除する関数を返す
  return () => {
    for (const u of unlisteners) u();
  };
}

/**
 * request_id を見て「自分が投げた検索結果だけ処理したい」時用の薄いフィルタ。
 */
export function filterByRequestId<T extends { request_id: RequestId }>(
  requestId: RequestId,
  handler: (p: T) => void,
): (p: T) => void {
  return (p: T) => {
    if (p.request_id === requestId) handler(p);
  };
}
