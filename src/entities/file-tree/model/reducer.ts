import type { FileTreeAction, FileTreeState } from "./types";

export function reducer(state: FileTreeState, action: FileTreeAction): FileTreeState {
  switch (action.type) {
    case "loading":
      return { ...state, isLoading: true, error: null };

    case "kifu_loading":
      return { ...state, kifuError: null };

    case "tree_loaded":
    case "tree_updated":
      return {
        ...state,
        fileTree: action.payload,
        isLoading: false,
        error: null,
      };

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
        jkfData: action.payload.path === null ? null : (action.payload.jkfData ?? state.jkfData),
        kifuFormat:
          action.payload.path === null ? null : (action.payload.format ?? state.kifuFormat),
      };

    // 編集中の行とメニューは畳む。名前を直しても通らない失敗しかここへ来ないので
    // （`isNameInputError` が真のものは `failToNameInput` が入力欄へ返す）、
    // 入力欄を残しても直せる先が無い。`conflict_opened` が畳んでいるのと同じ理由
    case "error":
      // 衝突の解決中に失敗したときは、そのダイアログの中で伝える（`submitError`）。
      // ここで積むと対話の裏に別の失敗の箱が重なり、解決操作の続きが
      // どちらの箱に属するか読めなくなる
      if (state.conflict) {
        return { ...state, isLoading: false };
      }
      return {
        ...state,
        isLoading: false,
        menu: null,
        renamingNodeId: null,
        creatingDirParentPath: null,
        error: action.payload,
      };

    // 読み直しの失敗は**対話が開いていても捨てない**。捨てると、別名で解決した直後の
    // 読み直しが落ちたときに「ファイルはできている・ツリーは古いまま・失敗はどこにも
    // 出ない」で終わる。操作は `Ok` を返しているので対話は成功として閉じ、
    // 利用者は「作られていない」と読んで押し直し、`already_exists` に当たる。
    //
    // 畳まないのは、これが操作の失敗ではなく**そのあとの読み直しの失敗**だから。
    // 開いている入力欄は、読み直しが直れば意味を持ち続ける
    case "reload_failed":
      return { ...state, isLoading: false, error: action.payload };

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
