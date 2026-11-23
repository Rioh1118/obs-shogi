import type { FileTreeAction, FileTreeNode, FileTreeState } from "./types";
import { findNode, findNodeById } from "../lib/findNodeChain";

export const initialState: FileTreeState = {
  fileTree: null,
  selectedNode: null,
  activeKifuPath: null,
  jkfData: null,
  kifuFormat: null,
  expandedNodes: new Set<string>(),
  isLoading: false,
  menu: null,
  renamingNodeId: null,
  creatingDirParentPath: null,
  error: null,
  kifuError: null,
  conflict: null,
};

export function reducer(state: FileTreeState, action: FileTreeAction): FileTreeState {
  switch (action.type) {
    case "loading":
      return { ...state, isLoading: true, error: null };

    case "kifu_loading":
      return { ...state, kifuError: null };

    case "tree_loaded":
      return {
        ...state,
        fileTree: action.payload,
        isLoading: false,
        error: null,
      };

    case "tree_refreshed":
      return {
        ...state,
        fileTree: action.payload,
        renamingNodeId: carryRenamingNodeId(state, action.payload),
      };

    // 出ている通知は差し替えない。操作の失敗を「一覧を取り直せませんでした」に変えると、
    // 落ちた操作が済んだように読める
    case "refresh_failed":
      if (state.error) return state;
      return { ...state, error: { from: "reload", error: action.payload } };

    case "node_selected":
      return {
        ...state,
        selectedNode: action.payload,
      };

    case "kifu_opened":
      return {
        ...state,
        activeKifuPath: action.payload.path,
        jkfData: action.payload.jkfData,
        kifuFormat: action.payload.format,
        isLoading: false,
        kifuError: null,
        error: null,
      };

    case "kifu_closed":
      return {
        ...state,
        activeKifuPath: null,
        jkfData: null,
        kifuFormat: null,
      };

    case "node_expanded":
      return {
        ...state,
        expandedNodes: new Set([...state.expandedNodes, action.payload]),
      };

    case "node_collapsed": {
      const next = new Set(state.expandedNodes);
      next.delete(action.payload);
      return { ...state, expandedNodes: next };
    }

    case "menu_opened":
      return { ...state, menu: action.payload };

    case "menu_closed":
      return { ...state, menu: null };

    case "rename_started":
      return { ...state, renamingNodeId: action.payload };

    case "rename_ended":
      return { ...state, renamingNodeId: null };

    case "create_dir_started":
      return { ...state, creatingDirParentPath: action.payload };

    case "create_dir_ended":
      return { ...state, creatingDirParentPath: null };

    case "nodes_expanded":
      return {
        ...state,
        expandedNodes: new Set([...state.expandedNodes, ...action.payload]),
      };

    case "selected_node_reconciled":
      return {
        ...state,
        selectedNode: action.payload,
      };

    case "active_kifu_reconciled":
      return {
        ...state,
        activeKifuPath: action.payload.path,
        jkfData: action.payload.path === null ? null : state.jkfData,
        kifuFormat: action.payload.path === null ? null : state.kifuFormat,
      };

    // 編集中の行とメニューは閉じる。名前を直せば通る失敗は `failToNameInput` が入力欄へ返す。
    // ここへ届くのは、名前を直しても通らない失敗、欄が消えたあとの名前の失敗
    // （`InlineNameEditor` の `onUnshowable`）、欄を持たない操作（移動、削除）の失敗
    case "error":
      // 衝突の解決中に失敗したときは、そのダイアログの中で伝える（`submitError`）。
      // ここで積むと対話の裏に別の失敗の箱が重なり、解決操作の続きが
      // どちらの箱に属するか読めなくなる。
      //
      // **これは code を見ない。** 対話では直せない失敗（対象が消えた、ディスクは通ったが
      // 設定が書けなかった）は、積む側が先に `conflict_closed` を送る。ここで code を見て
      // 振り分けると、対話が「自分で出す」と決めた失敗まで裏に重なる
      if (state.conflict) {
        return { ...state, isLoading: false };
      }
      return {
        ...state,
        isLoading: false,
        menu: null,
        renamingNodeId: null,
        creatingDirParentPath: null,
        error: { from: "operation", error: action.payload },
      };

    // 読み直しの失敗は対話が開いていても捨てない。捨てると、別名で解決した直後の
    // 読み直しが落ちたときに「ファイルはできている・ツリーは古いまま・失敗はどこにも
    // 出ない」で終わる。操作は `Ok` を返しているので対話は成功として閉じ、
    // 利用者は「作られていない」と読んで押し直し、`already_exists` に当たる。
    //
    // 閉じないのは、これが操作の失敗ではなく、そのあとの読み直しの失敗だから。
    // 開いている入力欄は、読み直しが直れば意味を持ち続ける
    case "reload_failed":
      return { ...state, isLoading: false, error: { from: "reload", error: action.payload } };

    case "error_cleared":
      return { ...state, error: null };

    case "kifu_error":
      return { ...state, kifuError: action.payload };

    case "kifu_error_cleared":
      return { ...state, kifuError: null };

    case "conflict_opened":
      return {
        ...state,
        isLoading: false,
        menu: null,
        renamingNodeId: null,
        creatingDirParentPath: null,
        conflict: action.payload,
      };

    case "conflict_closed":
      return {
        ...state,
        menu: null,
        renamingNodeId: null,
        creatingDirParentPath: null,
        conflict: null,
      };

    default:
      throw new Error("Unknown action type");
  }
}

/**
 * 改名中の行を、取り直したツリーの同じパスの行へ付け替える。消えていれば入力欄を閉じる。
 *
 * `id` は走査のたびに振り直される。付け替えないと、名前を打っている最中に外の変更が
 * 届いただけで入力欄が消え、打った文字を失う
 */
function carryRenamingNodeId(state: FileTreeState, nextTree: FileTreeNode): string | null {
  if (state.renamingNodeId === null || state.fileTree === null) return null;
  const renaming = findNodeById(state.fileTree, state.renamingNodeId);
  if (!renaming) return null;
  return findNode(nextTree, renaming.path)?.id ?? null;
}
