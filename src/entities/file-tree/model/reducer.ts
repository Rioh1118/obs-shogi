import type { FileTreeAction, FileTreeState } from "./types";

export function reducer(
  state: FileTreeState,
  action: FileTreeAction,
): FileTreeState {
  switch (action.type) {
    case "loading":
      return { ...state, isLoading: true, error: null };

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
        jkfData: null,
        kifuFormat: null,
      };

    case "kifu_opened":
      return {
        ...state,
        activeKifuPath: action.payload.path,
        jkfData: action.payload.jkfData,
        kifuFormat: action.payload.format,
        isLoading: false,
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
        jkfData:
          action.payload.path === null
            ? null
            : (action.payload.jkfData ?? state.jkfData),
        kifuFormat:
          action.payload.path === null
            ? null
            : (action.payload.format ?? state.kifuFormat),
      };

    case "error":
      return { ...state, isLoading: false, error: action.payload };

    default:
      throw new Error("Unknown action type");
  }
}
