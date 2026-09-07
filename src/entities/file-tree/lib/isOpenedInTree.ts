import type { FileTreeNode, FileTreeState } from "../model/types";

/** この述語が要る3つ。`FileTreeState` 全部を渡させない */
export type OpenedKifuFields = Pick<FileTreeState, "activeKifuPath" | "jkfData" | "kifuFormat">;

/**
 * **ツリーから見て**この節の棋譜がもう開いているか。
 *
 * 3つとも要る。`activeKifuPath` だけだと、改名で拡張子が変わった回に
 * `kifuFormat` が古いまま据え置かれていること（`active_kifu_reconciled` は
 * `format` を運ばない）を見落とす。据え置かれた形式のまま開き直しを省くと、
 * **保存が別の形式で書かれる**——`.csa` に KIF の本文が入る。
 *
 * **これは「盤に載っているか」ではない。** ツリーが握っているのは構文として
 * 読めたところまでで、盤に載るかは `loadGame` の `buildPlayer` まで来ないと
 * 分からない。載っているかを併せて見るのは呼び出し側の仕事
 * （`entities/file-tree` から `entities/game` は見えない）。
 */
export function isOpenedInTree(state: OpenedKifuFields, node: FileTreeNode): boolean {
  return (
    state.activeKifuPath === node.path &&
    state.jkfData !== null &&
    state.kifuFormat === node.kifuInfo?.format
  );
}
