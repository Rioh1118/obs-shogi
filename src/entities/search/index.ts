export type {
  Consistency,
  OpenProjectInput,
  OpenProjectOutput,
  SearchPositionInput,
  SearchPositionOutput,
} from "./api/contract";

export type {
  FileId,
  Gen,
  NodeId,
  RequestId,
  ForkPointer,
  Occurrence,
  FilePathEntry,
  CursorLite,
  PositionHit,
} from "./api/ids";

export type {
  IndexState,
  IndexStatePayload,
  IndexProgressPayload,
  IndexWarnPayload,
  SearchBeginPayload,
  SearchChunkPayload,
  SearchEndPayload,
  SearchErrorPayload,
} from "./api/events";

// **検索を起こす口も、イベント名も、ここからは出さない。**
//
// 検索の生死（rid の発行・取り下げ・結果の破棄）は `PositionSearchProvider` が
// 1人で持つ。生の `searchPosition` を出すと provider を通らずに検索を起こす形が、
// `EVT_SEARCH_CHUNK` を出すと `listen` と2行で2人目の購読者が立つ形が、それぞれ
// 1 import で作れる。**溜め場の門は購読者が1人であることに全面的に依存している。**
//
// スライスの中からは barrel を経由せず実体を読むこと（1階層なら相対、
// 2階層以上は `@/entities/search/...`——`no-restricted-imports` が深い相対を禁じている）。

/**
 * 索引のカーソルを `CursorPath` に直す唯一の関門。**素の `CursorLite` を
 * 自分で組み直さないこと**（並びと `te <= tesuu` の前提をここで揃えている）。
 */
export { cursorFromLite } from "./lib/cursorAdapter";
export { isIndexBusy } from "./lib/indexState";

export { PositionSearchProvider } from "./model/provider";
export { usePositionSearch } from "./model/usePositionSearch";

export type {
  SearchState,
  SearchSession,
  IndexUiState,
  FilePathById,
  PositionSearchContextType,
} from "./model/types";
