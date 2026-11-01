/** 候補手の数を送るオプションの名前。プリセットの値はこの名前で持つ */
export const MULTIPV_OPTION = "MultiPV";

/**
 * `MultiPV`（候補手を何本読むか）の範囲。
 *
 * 読む側は2つある。プリセットの入力欄と、解析ビューが出す件数の上限（`MAX_VISIBLE_CANDIDATES`）。
 * 解析ビューが持つと入力欄から上向きの import になり、入力欄が持つと解析の上限が設定の機能に依存する
 */
export const MULTIPV_MIN = 1;
export const MULTIPV_MAX = 8;

/** 入力欄の脇に並べる既定の選択肢 */
export const QUICK_MULTIPV = [1, 3, 5, 8] as const;
