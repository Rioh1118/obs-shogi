/**
 * `MultiPV`（候補手を何本読むか）の範囲。
 *
 * **プリセット編集の道具箱に置かない。** 読む側が2つある —— プリセットの入力欄と、
 * 解析ビューが出す件数の上限（`MAX_VISIBLE_CANDIDATES`）。片方が持つと、
 * もう片方は上の層へ手を伸ばすことになる。
 */
export const MULTIPV_MIN = 1;
export const MULTIPV_MAX = 8;

/** 入力欄の脇に並べる既定の選択肢 */
export const QUICK_MULTIPV = [1, 3, 5, 8] as const;
export const QUICK_MULTIPV_SET = new Set<number>(QUICK_MULTIPV);
