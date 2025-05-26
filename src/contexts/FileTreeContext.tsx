import {
  createContext,
  useReducer,
  useEffect,
  useContext,
  useCallback,
} from "react";
import type { ReactNode } from "react";
import type { FileTreeNode } from "@/types/file-tree";
import { useAppConfig } from "./AppConfigContext";
import {
  getFileTree,
  createFile,
  createDirectory,
  deleteFile,
  deleteDirectory,
  renameFile,
  readFile,
} from "../commands/file_system";

type FileTreeState = {
  fileTree: FileTreeNode | null;
  selectedNode: FileTreeNode | null;
  fileContent: string | null;
  expandedNodes: Set<string>;
  isLoading: boolean;
  error: string | null;
};

type FileTreeAction =
  | { type: "loading" }
  | { type: "tree_loaded"; payload: FileTreeNode }
  | { type: "node_selected"; payload: FileTreeNode | null }
  | { type: "file_content_loaded"; payload: string }
  | { type: "file_content_cleared" }
  | { type: "tree_updated"; payload: FileTreeNode }
  | { type: "node_expanded"; payload: string }
  | { type: "node_collapsed"; payload: string }
  | { type: "error"; payload: string };

const initialState: FileTreeState = {
  fileTree: null,
  selectedNode: null,
  fileContent: null,
  expandedNodes: new Set<string>(),
  isLoading: false,
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
        fileContent: null,
      };
    case "file_content_loaded":
      return {
        ...state,
        fileContent: action.payload,
        isLoading: false,
        error: null,
      };
    case "file_content_cleared":
      return {
        ...state,
        fileContent: null,
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
    case "error":
      return {
        ...state,
        isLoading: false,
        error: action.payload,
      };
    default:
      throw new Error("Unknown actioin type");
  }
}

type FileTreeContextType = FileTreeState & {
  loadFileTree: () => Promise<void>;
  selectNode: (node: FileTreeNode | null) => void;
  loadFileContent: (filePath: string) => Promise<void>;
  createNewFile: (filePath: string, content?: string) => Promise<void>;
  createNewDirectory: (dirPath: string) => Promise<void>;
  deleteSelectedFile: () => Promise<void>;
  deleteSelectedDirectory: () => Promise<void>;
  toggleNode: (nodeId: string) => void;
  isNodeExpanded: (nodeId: string) => boolean;
  renameSelected: (newPath: string) => Promise<void>;
  refreshTree: () => Promise<void>;
};

const FileTreeContext = createContext<FileTreeContextType | undefined>(
  undefined,
);

function FileTreeProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(fileTreeReducer, initialState);
  const { config } = useAppConfig();

  const loadFileTree = useCallback(async () => {
    if (!config?.root_dir) return;

    dispatch({ type: "loading" });

    try {
      const tree = await getFileTree(config.root_dir);
      dispatch({ type: "tree_loaded", payload: tree });
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

  const selectNode = useCallback((node: FileTreeNode | null) => {
    dispatch({ type: "node_selected", payload: node });
  }, []);

  const loadFileContent = useCallback(async (filePath: string) => {
    dispatch({ type: "loading" });
    try {
      const content = await readFile(filePath);
      dispatch({ type: "file_content_loaded", payload: content });
    } catch (err) {
      dispatch({
        type: "error",
        payload: `ファイル内容の読み込みに失敗しました: ${err}`,
      });
    }
  }, []);

  const createNewFile = useCallback(
    async (filePath: string, content: string = "") => {
      try {
        await createFile(filePath, content);
        await loadFileTree();
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
    async (dirPath: string) => {
      try {
        await createDirectory(dirPath);
        await loadFileTree();
      } catch (err) {
        dispatch({
          type: "error",
          payload: `ディレクトリの作成に失敗しました: ${err}`,
        });
      }
    },
    [loadFileTree],
  );

  const deleteSelectedFile = useCallback(async () => {
    if (!state.selectedNode || state.selectedNode.isDir) return;

    try {
      await deleteFile(state.selectedNode.path);
      dispatch({ type: "node_selected", payload: null });
      await loadFileTree();
    } catch (err) {
      dispatch({
        type: "error",
        payload: `ファイルの削除に失敗しました: ${err}`,
      });
    }
  }, [state.selectedNode, loadFileTree]);

  const deleteSelectedDirectory = useCallback(async () => {
    if (!state.selectedNode || !state.selectedNode.isDir) return;

    try {
      await deleteDirectory(state.selectedNode.path);
      dispatch({ type: "node_selected", payload: null });
      await loadFileTree();
    } catch (err) {
      dispatch({
        type: "error",
        payload: `ディレクトリの削除に失敗しました: ${err}`,
      });
    }
  }, [state.selectedNode, loadFileTree]);

  const toggleNode = useCallback(
    (nodeId: string) => {
      if (state.expandedNodes.has(nodeId)) {
        dispatch({ type: "node_collapsed", payload: nodeId });
      } else {
        dispatch({ type: "node_expanded", payload: nodeId });
      }
    },
    [state.expandedNodes],
  );

  const isNodeExpanded = useCallback(
    (nodeId: string) => {
      return state.expandedNodes.has(nodeId);
    },
    [state.expandedNodes],
  );

  const renameSelected = useCallback(
    async (newPath: string) => {
      if (!state.selectedNode) return;

      try {
        await renameFile(state.selectedNode.path, newPath);
        await loadFileTree();
      } catch (err) {
        dispatch({
          type: "error",
          payload: `リネームに失敗しました: ${err}`,
        });
      }
    },
    [state.selectedNode, loadFileTree],
  );

  const refreshTree = useCallback(async () => {
    await loadFileTree();
  }, [loadFileTree]);

  return (
    <FileTreeContext.Provider
      value={{
        ...state,
        loadFileTree,
        selectNode,
        loadFileContent,
        createNewFile,
        createNewDirectory,
        deleteSelectedFile,
        deleteSelectedDirectory,
        toggleNode,
        isNodeExpanded,
        renameSelected,
        refreshTree,
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
