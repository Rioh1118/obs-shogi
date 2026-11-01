/** 候補手の数を送るオプションの名前。プリセットの値はこの名前で持つ */
export const MULTIPV_OPTION = "MultiPV";

/**
 * `MultiPV`（候補手を何本読むか）の範囲。
 *
 * 読む側は2つある。プリセットの入力欄と、解析ビューが出す件数の上限（`MAX_VISIBLE_CANDIDATES`）。
 * 片方が持つと、もう片方は上の層を import することになるので、ここに置く
 */
export const MULTIPV_MIN = 1;
export const MULTIPV_MAX = 8;

/** 入力欄の脇に並べる既定の選択肢 */
export const QUICK_MULTIPV = [1, 3, 5, 8] as const;
