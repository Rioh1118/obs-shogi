import {
  type JKFData,
  type FileTreeNode,
  type KifuCreationOptions,
  type KifuFormat,
  type MenuState,
} from "@/types";
import {
  useCallback,
  useReducer,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
} from "react";
import { useAppConfig } from "./AppConfigContext";
import { KifuArchivistFactory } from "@/services/file/KifuArchivist";
import { KifuParserFactory } from "@/services/file/KifuParser";

type FileTreeState = {
  fileTree: FileTreeNode | null;
  selectedNode: FileTreeNode | null;
  jkfData: JKFData | null;
  kifuFormat: KifuFormat | null;
  expandedNodes: Set<string>;
  isLoading: boolean;
  menu: MenuState;
  error: string | null;
};

type FileTreeAction =
  | { type: "loading" }
  | { type: "tree_loaded"; payload: FileTreeNode }
  | { type: "node_selected"; payload: FileTreeNode | null }
  | { type: "kifu_loaded"; payload: { jkfData: JKFData; format: KifuFormat } }
  | { type: "tree_updated"; payload: FileTreeNode }
  | { type: "node_expanded"; payload: string }
  | { type: "node_collapsed"; payload: string }
  | { type: "menu_opened"; payload: MenuState }
  | { type: "menu_closed" }
  | { type: "error"; payload: string };

const initialState: FileTreeState = {
  fileTree: null,
  selectedNode: null,
  jkfData: null,
  kifuFormat: null,
  expandedNodes: new Set<string>(),
  isLoading: false,
  menu: null,
  error: null,
};

function fileTreeReducer(
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
        // ノード選択時にファイル内容もクリア
        jkfData: null,
        kifuFormat: null,
      };

    case "kifu_loaded":
      return {
        ...state,
        jkfData: action.payload.jkfData,
        kifuFormat: action.payload.format,
        isLoading: false,
        error: null,
      };

    case "node_expanded":
      return {
        ...state,
        expandedNodes: new Set([...state.expandedNodes, action.payload]),
      };

    case "node_collapsed": {
      const newExpandedNodes = new Set(state.expandedNodes);
      newExpandedNodes.delete(action.payload);
      return {
        ...state,
        expandedNodes: newExpandedNodes,
      };
    }

    case "menu_opened":
      return {
        ...state,
        menu: action.payload,
      };

    case "menu_closed":
      return { ...state, menu: null };

    case "error":
      return {
        ...state,
        isLoading: false,
        error: action.payload,
      };

    default:
      throw new Error("Unknown action type");
  }
}

type FileTreeContextType = FileTreeState & {
  loadFileTree: () => Promise<void>;
  selectNode: (node: FileTreeNode | null) => void;
  loadSelectedKifu: () => Promise<void>;

  // 棋譜ファイル作成 - KifuCreationOptionsで型安全に
  createNewFile: (
    parentPath: string,
    options: KifuCreationOptions,
  ) => Promise<void>;

  // ディレクトリ作成 - シンプルに
  createNewDirectory: (parentPath: string, dirname: string) => Promise<void>;

  toggleNode: (nodePath: string) => void;
  isNodeExpanded: (nodePath: string) => boolean;

  deleteNode: (node: FileTreeNode) => Promise<void>;
  renameNode: (node: FileTreeNode, newName: string) => Promise<void>;
  moveNode: (
    node: FileTreeNode,
    destDir: string,
    newName?: string,
  ) => Promise<void>;
  refreshTree: () => Promise<void>;
  isKifuSelected: () => boolean;
  getSelectedKifuData: () => JKFData | null;

  openContextMenu: (node: FileTreeNode, x: number, y: number) => void;
  closeContextMenu: () => void;
};

const FileTreeContext = createContext<FileTreeContextType | undefined>(
  undefined,
);

function FileTreeProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(fileTreeReducer, initialState);
  const { config } = useAppConfig();

  const openContextMenu = useCallback(
    (node: FileTreeNode, x: number, y: number) => {
      dispatch({ type: "menu_opened", payload: { node, x, y } });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    dispatch({ type: "menu_closed" });
  }, []);

  const loadFileTree = useCallback(async () => {
    if (!config?.root_dir) return;
    dispatch({ type: "loading" });

    try {
      const fileManager = KifuArchivistFactory.getInstance();
      const result = await fileManager.getKifuFileTree(config.root_dir);

      if (result.success) {
        dispatch({ type: "tree_loaded", payload: result.data });
      } else {
        dispatch({
          type: "error",
          payload: `ファイルツリーの読み込みに失敗しました: ${result.error}`,
        });
      }
    } catch (err) {
      dispatch({
        type: "error",
        payload: `ファイルツリーの読み込みに失敗しました: ${err}`,
      });
    }
  }, [config?.root_dir]);

  useEffect(() => {
    if (config?.root_dir) {
      loadFileTree();
    }
  }, [config?.root_dir, loadFileTree]);

  const loadSelectedKifu = useCallback(async () => {
    if (!state.selectedNode) {
      dispatch({ type: "error", payload: "ファイルが選択されていません" });
      return;
    }

    dispatch({ type: "loading" });

    try {
      const fileManager = KifuArchivistFactory.getInstance();
      const kifuParser = KifuParserFactory.getInstance();

      const readResult = await fileManager.readKifuFile(state.selectedNode);
      if (!readResult.success) {
        dispatch({ type: "error", payload: readResult.error });
        return;
      }

      const kifuFormat = state.selectedNode.kifuInfo?.format;
      if (!kifuFormat) {
        dispatch({ type: "error", payload: "棋譜フォーマットが不明です" });
        return;
      }

      const parseResult = await kifuParser.parseKifuContent(
        readResult.data,
        kifuFormat,
      );
      if (!parseResult.success) {
        dispatch({ type: "error", payload: parseResult.error });
        return;
      }

      dispatch({
        type: "kifu_loaded",
        payload: { jkfData: parseResult.data, format: kifuFormat },
      });
    } catch (err) {
      dispatch({
        type: "error",
        payload: `棋譜の読み込みに失敗しました: ${err}`,
      });
    }
  }, [state.selectedNode]);

  useEffect(() => {
    if (state.selectedNode && !state.selectedNode.isDirectory) {
      loadSelectedKifu();
    }
  }, [state.selectedNode, loadSelectedKifu]);

  const createNewFile = useCallback(
    async (parentPath: string, options: KifuCreationOptions) => {
      try {
        const fileManager = KifuArchivistFactory.getInstance();
        const result = await fileManager.createKifuFile(parentPath, options);

        if (result.success) {
          await loadFileTree(); // ツリーを更新
        } else {
          dispatch({
            type: "error",
            payload: `ファイルの作成に失敗しました: ${result.error}`,
          });
        }
      } catch (err) {
        dispatch({
          type: "error",
          payload: `ファイルの作成に失敗しました: ${err}`,
        });
      }
    },
    [loadFileTree],
  );

  const createNewDirectory = useCallback(
    async (parentPath: string, dirname: string) => {
      try {
        const fileManager = KifuArchivistFactory.getInstance();
        const result = await fileManager.createDirectory(parentPath, dirname);

        if (result.success) {
          await loadFileTree(); // ツリーを更新
        } else {
          dispatch({
            type: "error",
            payload: `ディレクトリの作成に失敗しました: ${result.error}`,
          });
        }
      } catch (err) {
        dispatch({
          type: "error",
          payload: `ディレクトリの作成に失敗しました: ${err}`,
        });
      }
    },
    [loadFileTree],
  );

  const toggleNode = useCallback(
    (nodePath: string) => {
      if (state.expandedNodes.has(nodePath)) {
        dispatch({ type: "node_collapsed", payload: nodePath });
      } else {
        dispatch({ type: "node_expanded", payload: nodePath });
      }
    },
    [state.expandedNodes],
  );

  const selectNode = useCallback((node: FileTreeNode | null) => {
    dispatch({ type: "node_selected", payload: node });
  }, []);

  const isNodeExpanded = useCallback(
    (nodePath: string) => {
      return state.expandedNodes.has(nodePath);
    },
    [state.expandedNodes],
  );

  const deleteNode = useCallback(
    async (node: FileTreeNode) => {
      try {
        const fileManager = KifuArchivistFactory.getInstance();

        const result = node.isDirectory
          ? await fileManager.deleteDirectory(node.path)
          : await fileManager.deleteKifuFile(node.path);

        if (result.success) {
          if (state.selectedNode?.id === node.id) {
            dispatch({ type: "node_selected", payload: null });
          }
          await loadFileTree();
        } else {
          dispatch({
            type: "error",
            payload: `${node.isDirectory ? "ディレクトリ" : "ファイル"}の削除に失敗しました: ${result.error}`,
          });
        }
      } catch (err) {
        dispatch({
          type: "error",
          payload: `${node.isDirectory ? "ディレクトリ" : "ファイル"}の削除に失敗しました: ${err}`,
        });
      }
    },
    [loadFileTree, state.selectedNode],
  );

  const renameNode = useCallback(
    async (node: FileTreeNode, newName: string) => {
      try {
        const fileManager = KifuArchivistFactory.getInstance();

        const result = node.isDirectory
          ? await fileManager.renameDirectory(node.path, newName)
          : await fileManager.renameKifuFile(node.path, newName);

        if (result.success) {
          if (state.selectedNode?.id === node.id) {
            dispatch({ type: "node_selected", payload: null });
          }

          await loadFileTree();
        } else {
          dispatch({
            type: "error",
            payload: `${node.isDirectory ? "ディレクトリ" : "ファイル"}のリネームに失敗しました:${result.error}`,
          });
        }
      } catch (err) {
        dispatch({
          type: "error",
          payload: `${node.isDirectory ? "ディレクトリ" : "ファイル"}のリネームに失敗しました: ${err}`,
        });
      }
    },
    [loadFileTree, state.selectedNode],
  );

  const moveNode = useCallback(
    async (node: FileTreeNode, destDir: string, newName?: string) => {
      try {
        const fileManager = KifuArchivistFactory.getInstance();

        const result = node.isDirectory
          ? await fileManager.mvDirectory(node.path, destDir, newName)
          : await fileManager.mvKifuFile(node.path, destDir, newName);

        if (result.success) {
          if (state.selectedNode?.id === node.id) {
            dispatch({ type: "node_selected", payload: null });
          }
          await loadFileTree();
        } else {
          dispatch({
            type: "error",
            payload: `${node.isDirectory ? "ディレクトリ" : "ファイル"}の移動に失敗しました: ${result.error}`,
          });
        }
      } catch (err) {
        dispatch({
          type: "error",
          payload: `${node.isDirectory ? "ディレクトリ" : "ファイル"}の移動に失敗しました: ${err}`,
        });
      }
    },
    [loadFileTree, state.selectedNode],
  );

  const refreshTree = useCallback(async () => {
    await loadFileTree();
  }, [loadFileTree]);

  const isKifuSelected = useCallback(() => {
    return state.jkfData !== null && state.kifuFormat !== null;
  }, [state.jkfData, state.kifuFormat]);

  const getSelectedKifuData = useCallback(() => {
    return state.jkfData;
  }, [state.jkfData]);

  return (
    <FileTreeContext.Provider
      value={{
        ...state,
        loadFileTree,
        selectNode,
        loadSelectedKifu,
        createNewFile,
        createNewDirectory,
        toggleNode,
        isNodeExpanded,
        deleteNode,
        renameNode,
        moveNode,
        refreshTree,
        isKifuSelected,
        getSelectedKifuData,
        openContextMenu,
        closeContextMenu,
      }}
    >
      {children}
    </FileTreeContext.Provider>
  );
}

function useFileTree() {
  const context = useContext(FileTreeContext);
  if (!context) {
    throw new Error("useFileTree must be used within FileTreeProvider");
  }
  return context;
}

export { FileTreeProvider, useFileTree };
