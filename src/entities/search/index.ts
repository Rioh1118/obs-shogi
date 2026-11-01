export type { CursorLite, PositionHit } from "./api/ids";

// 検索を起こす関数とイベント名はここから出さない。
//
// 検索の番号の発行、取り下げ、結果の破棄は `PositionSearchProvider` が持つ。
// `searchPosition` や `EVT_SEARCH_CHUNK` を出すと、provider を通らない検索と2人目の購読者を
// 作れてしまい、`chunkBuffer` の `isAccepting` の判定を素通りする。
//
// スライスの中からは barrel を経由せず実体を読むこと（1階層なら相対、
// 2階層以上は `@/entities/search/...`。`no-restricted-imports` が深い相対を禁じている）。

/**
 * 索引のカーソルを `CursorPath` に直す。`CursorLite` を自分で組み直さないこと
 * （並びと `te <= tesuu` の前提をここで揃えている）。
 */
export { cursorFromLite } from "./lib/cursorAdapter";

/**
 * 索引の具合を1つに決める。画面ごとに旗を並べ直さないこと。見る順が割れると、
 * 同じ状態に別の理由が付く。文言は画面が持ってよい。
 */
export { indexHealth } from "./lib/indexHealth";
export { pickWarns } from "./lib/pickWarns";
export type { IndexHealth } from "./lib/indexHealth";

export { PositionSearchProvider } from "./model/provider";
export { usePositionSearch } from "./model/usePositionSearch";

export type { IndexUiState } from "./model/types";
