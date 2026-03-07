import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import type { FileTreeNode } from "./types";
import { FileTreeContext } from "./context";
import { reducer } from "./reducer";
import { initialState } from "./types";

import * as api from "../api/service";
import {
  parseKifuContentToJKF,
  type KifuCreationOptions,
} from "@/entities/kifu";
import {
  findNodeChain,
  isSameOrDescendantPath,
  joinPath,
  remapSubtreePath,
  replaceBasename,
  scrollNodeIntoView,
} from "../lib/path";

type Props = {
  rootDir: string | null;
  children: ReactNode;
};

export function FileTreeProvider({ rootDir, children }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const pendingRevealPathRef = useRef<string | null>(null);
  const pendingSelectedPathRef = useRef<string | null>(null);

  const revealNodeInCurrentTree = useCallback(
    (absPath: string) => {
      const root = state.fileTree;
      if (!root) return;

      const chain = findNodeChain(root, absPath);
      if (!chain) return;
      const expandPaths = chain
        .slice(0, -1)
        .filter((n) => n.isDirectory)
        .map((n) => n.path);

      dispatch({ type: "nodes_expanded", payload: expandPaths });

      scrollNodeIntoView(absPath);
    },
    [state.fileTree],
  );
  const loadFileTree = useCallback(async () => {
    if (!rootDir) return;
    dispatch({ type: "loading" });

    const res = await api.fetchTree(rootDir);
    if (res.success) {
      dispatch({ type: "tree_loaded", payload: res.data });
    } else {
      dispatch({
        type: "error",
        payload: `ファイルツリーの読み込みに失敗しました: ${res.error}`,
      });
    }
  }, [rootDir]);

  useEffect(() => {
    if (rootDir) void loadFileTree();
  }, [rootDir, loadFileTree]);

  useEffect(() => {
    if (!state.fileTree) return;

    const nextSelectedPath = pendingSelectedPathRef.current;
    if (nextSelectedPath) {
      pendingSelectedPathRef.current = null;

      const chain = findNodeChain(state.fileTree, nextSelectedPath);
      dispatch({
        type: "selected_node_reconciled",
        payload: chain ? chain[chain.length - 1] : null,
      });
    }

    const targetPath = pendingRevealPathRef.current;
    if (targetPath) {
      pendingRevealPathRef.current = null;
      revealNodeInCurrentTree(targetPath);
    }
  }, [state.fileTree, revealNodeInCurrentTree]);

  const selectNode = useCallback((node: FileTreeNode | null) => {
    dispatch({ type: "node_selected", payload: node });
  }, []);

  const loadSelectedKifu = useCallback(async () => {
    const node = state.selectedNode;
    if (!node) {
      dispatch({ type: "error", payload: "ファイルが選択されていません" });
      return;
    }
    if (node.isDirectory) return;

    const fmt = node.kifuInfo?.format;
    if (!fmt) {
      dispatch({ type: "error", payload: "棋譜フォーマットが不明です" });
      return;
    }

    dispatch({ type: "loading" });

    const readRes = await api.readKifu(node);
    if (!readRes.success) {
      dispatch({ type: "error", payload: readRes.error });
      return;
    }

    try {
      const jkfData = parseKifuContentToJKF(readRes.data, fmt);
      dispatch({ type: "kifu_loaded", payload: { jkfData, format: fmt } });
    } catch (e) {
      dispatch({
        type: "error",
        payload: e instanceof Error ? e.message : String(e),
      });
    }
  }, [state.selectedNode]);

  useEffect(() => {
    if (state.selectedNode && !state.selectedNode.isDirectory) {
      void loadSelectedKifu();
    }
  }, [state.selectedNode, loadSelectedKifu]);

  const createNewFile = useCallback(
    async (parentPath: string, options: KifuCreationOptions) => {
      const res = await api.createKifu(parentPath, options);
      if (!res.success) {
        dispatch({
          type: "error",
          payload: `ファイルの作成に失敗しました: ${res.error}`,
        });
        return;
      }

      const createdPath = joinPath(parentPath, options.fileName);
      pendingRevealPathRef.current = createdPath;
      await loadFileTree();
    },
    [loadFileTree],
  );

  const importKifuFile = useCallback(
    async (parentPath: string, fileName: string, rawContent: string) => {
      const res = await api.importKifu(parentPath, fileName, rawContent.trim());
      if (res.success) {
        pendingRevealPathRef.current = joinPath(parentPath, fileName);
        await loadFileTree();
      }
      return res;
    },
    [loadFileTree],
  );

  const createNewDirectory = useCallback(
    async (parentPath: string, dirname: string) => {
      const res = await api.createDir(parentPath, dirname);
      if (!res.success) {
        dispatch({
          type: "error",
          payload: `ディレクトリの作成に失敗しました: ${res.error}`,
        });
        return;
      }
      pendingRevealPathRef.current = joinPath(parentPath, dirname);
      await loadFileTree();
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

  const isNodeExpanded = useCallback(
    (nodePath: string) => {
      return state.expandedNodes.has(nodePath);
    },
    [state.expandedNodes],
  );

  const deleteNode = useCallback(
    async (node: FileTreeNode) => {
      const res = node.isDirectory
        ? await api.removeDir(node.path)
        : await api.removeFile(node.path);

      if (!res.success) {
        dispatch({
          type: "error",
          payload: `${node.isDirectory ? "ディレクトリ" : "ファイル"}の削除に失敗しました: ${res.error}`,
        });
        return;
      }

      if (isSameOrDescendantPath(state.selectedNode?.path, node.path)) {
        pendingSelectedPathRef.current = null;
        dispatch({ type: "node_selected", payload: null });
      }
      await loadFileTree();
    },
    [loadFileTree, state.selectedNode],
  );

  const renameNode = useCallback(
    async (node: FileTreeNode, newName: string) => {
      const res = node.isDirectory
        ? await api.renameDir(node.path, newName)
        : await api.renameFile(node.path, newName);

      if (!res.success) {
        dispatch({
          type: "error",
          payload: `${node.isDirectory ? "ディレクトリ" : "ファイル"}のリネームに失敗しました: ${res.error}`,
        });
        return;
      }

      const renamedPath = replaceBasename(node.path, newName);
      const nextSelectedPath = remapSubtreePath(
        state.selectedNode?.path,
        node.path,
        renamedPath,
      );
      if (nextSelectedPath) {
        pendingSelectedPathRef.current = nextSelectedPath;
      }
      pendingRevealPathRef.current = renamedPath;
      await loadFileTree();
    },
    [loadFileTree, state.selectedNode],
  );

  const moveNode = useCallback(
    async (node: FileTreeNode, destDir: string, newName?: string) => {
      const res = node.isDirectory
        ? await api.moveDir(node.path, destDir, newName)
        : await api.moveFile(node.path, destDir, newName);

      if (!res.success) {
        dispatch({
          type: "error",
          payload: `${node.isDirectory ? "ディレクトリ" : "ファイル"}の移動に失敗しました: ${res.error}`,
        });
        return;
      }

      const movedPath = joinPath(destDir, newName ?? node.name);

      const nextSelectedPath = remapSubtreePath(
        state.selectedNode?.path,
        node.path,
        movedPath,
      );

      if (nextSelectedPath) {
        pendingSelectedPathRef.current = nextSelectedPath;
      }

      pendingRevealPathRef.current = movedPath;
      await loadFileTree();
    },
    [loadFileTree, state.selectedNode],
  );

  const openContextMenu = useCallback(
    (node: FileTreeNode, x: number, y: number) => {
      dispatch({ type: "menu_opened", payload: { node, x, y } });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    dispatch({ type: "menu_closed" });
  }, []);

  const startInlineRename = useCallback((node: FileTreeNode) => {
    dispatch({ type: "menu_closed" });
    dispatch({ type: "rename_started", payload: node.id });
  }, []);

  const cancelInlineRename = useCallback(() => {
    dispatch({ type: "rename_ended" });
  }, []);

  const startCreateDirectory = useCallback(
    (parentPath: string) => {
      if (!state.expandedNodes.has(parentPath)) {
        dispatch({ type: "node_expanded", payload: parentPath });
      }
      dispatch({ type: "create_dir_started", payload: parentPath });
      dispatch({ type: "menu_closed" });
    },
    [state.expandedNodes],
  );

  const cancelCreateDirectory = useCallback(() => {
    dispatch({ type: "create_dir_ended" });
  }, []);

  const refreshTree = useCallback(async () => {
    await loadFileTree();
  }, [loadFileTree]);

  const isKifuSelected = useCallback(() => {
    return state.jkfData !== null && state.kifuFormat !== null;
  }, [state.jkfData, state.kifuFormat]);

  const getSelectedKifuData = useCallback(() => state.jkfData, [state.jkfData]);

  const selectNodeByAbsPath = useCallback(
    // NOTE: 現状はselectではなくreveal/focusのみを行う
    (absPath: string) => {
      revealNodeInCurrentTree(absPath);
    },
    [revealNodeInCurrentTree],
  );

  return (
    <FileTreeContext.Provider
      value={{
        ...state,
        loadFileTree,
        selectNode,
        loadSelectedKifu,
        createNewFile,
        importKifuFile,
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
        startInlineRename,
        cancelInlineRename,
        startCreateDirectory,
        cancelCreateDirectory,
        selectNodeByAbsPath,
      }}
    >
      {children}
    </FileTreeContext.Provider>
  );
}
