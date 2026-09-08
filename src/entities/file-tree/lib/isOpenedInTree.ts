import type { FileTreeNode, FileTreeState } from "../model/types";

/** この述語が要る3つ。`FileTreeState` 全部を渡させない */
export type OpenedKifuFields = Pick<FileTreeState, "activeKifuPath" | "jkfData" | "kifuFormat">;

/**
 * **ツリーから見て**この節の棋譜がもう開いているか。
 *
 * **これは「盤に載っているか」ではない。** ツリーが握っているのは構文として
 * 読めたところまでで、盤に載るかは `loadGame` の `buildPlayer` まで来ないと
 * 分からない。載っているかを併せて見るのは呼び出し側の仕事
 * （`entities/file-tree` から `entities/game` は見えない）。
 *
 * **`kifuFormat` のずれを「開き直せば直る」と読まないこと。** 改名で拡張子が
 * 変わった回は `active_kifu_reconciled` が形式を運ばないのでここが偽になるが、
 * そこで開き直すと**中身と違う形式でパースされる**。パーサは投げずに0手の棋譜を
 * 返すので（`entities/kifu/api/parse.ts`）、盤が空になったまま成功として載る。
 * ずれは発生源（`reconcilePathMutation`）で直すもの → #507
 */
export function isOpenedInTree(state: OpenedKifuFields, node: FileTreeNode): boolean {
  return (
    state.activeKifuPath === node.path &&
    state.jkfData !== null &&
    state.kifuFormat === node.kifuInfo?.format
  );
}
