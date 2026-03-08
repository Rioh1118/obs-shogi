import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import type { FileConflictRequest, FileTreeNode } from "./types";
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
  remapSubtreePath,
  scrollNodeIntoView,
} from "../lib/path";
import { makeFsError, type FsError } from "../api/error";
import { Err, Ok, type AsyncResult } from "@/shared/lib/result";
import { useAppConfig } from "@/entities/app-config";

type Props = {
  rootDir: string | null;
  children: ReactNode;
};

export function FileTreeProvider({ rootDir, children }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { setRootDir } = useAppConfig();
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

  const pushError = useCallback((error: FsError) => {
    dispatch({ type: "error", payload: error });
  }, []);

  const pushConflict = useCallback(
    (request: FileConflictRequest, error: FsError) => {
      dispatch({
        type: "conflict_opened",
        payload: { request, error },
      });
    },
    [],
  );

  const handleFailure = useCallback(
    (error: FsError, request?: FileConflictRequest) => {
      if (error.code === "already_exists" && request) {
        pushConflict(request, error);
      } else {
        pushError(error);
      }
      return Err(error);
    },
    [pushConflict, pushError],
  );

  const reconcilePathMutation = useCallback(
    (oldPath: string, nextPath: string) => {
      const selectedPath = state.selectedNode?.path ?? null;
      if (isSameOrDescendantPath(selectedPath, oldPath)) {
        pendingSelectedPathRef.current = remapSubtreePath(
          selectedPath,
          oldPath,
          nextPath,
        );
      }

      const activePath = state.activeKifuPath;
      if (isSameOrDescendantPath(activePath, oldPath)) {
        const nextActiveKifuPath = remapSubtreePath(
          activePath,
          oldPath,
          nextPath,
        );

        dispatch({
          type: "active_kifu_reconciled",
          payload: { path: nextActiveKifuPath },
        });
      }

      pendingRevealPathRef.current = nextPath;
    },
    [state.selectedNode?.path, state.activeKifuPath],
  );

  const loadFileTree = useCallback(async (): AsyncResult<void, FsError> => {
    if (!rootDir) {
      return Ok(undefined);
    }
    dispatch({ type: "loading" });

    const res = await api.fetchTree(rootDir);

    if (!res.success) {
      dispatch({ type: "error", payload: res.error });
      return Err(res.error);
    }

    dispatch({ type: "tree_loaded", payload: res.data });
    return Ok(undefined);
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

    if (state.activeKifuPath) {
      const activeChain = findNodeChain(state.fileTree, state.activeKifuPath);
      if (!activeChain) {
        dispatch({ type: "kifu_closed" });
      }
    }

    const targetPath = pendingRevealPathRef.current;
    if (targetPath) {
      pendingRevealPathRef.current = null;
      revealNodeInCurrentTree(targetPath);
    }
  }, [state.fileTree, revealNodeInCurrentTree, state.activeKifuPath]);

  const selectNode = useCallback((node: FileTreeNode | null) => {
    dispatch({ type: "node_selected", payload: node });
  }, []);

  const findNodeByPath = useCallback(
    (absPath: string): FileTreeNode | null => {
      const root = state.fileTree;
      if (!root) return null;

      const chain = findNodeChain(root, absPath);
      return chain ? chain[chain.length - 1] : null;
    },
    [state.fileTree],
  );

  const openKifuNode = useCallback(
    async (node: FileTreeNode): AsyncResult<void, FsError> => {
      if (node.isDirectory) return Ok(undefined);

      const fmt = node.kifuInfo?.format;
      if (!fmt) {
        const error = makeFsError(
          "invalid_type",
          "棋譜フォーマットが不明です",
          node.path,
        );
        pushError(error);
        return Err(error);
      }

      dispatch({ type: "loading" });

      const readRes = await api.readKifu(node);
      if (!readRes.success) {
        pushError(readRes.error);
        return Err(readRes.error);
      }

      try {
        const jkfData = parseKifuContentToJKF(readRes.data, fmt);
        dispatch({
          type: "kifu_opened",
          payload: {
            path: node.path,
            jkfData,
            format: fmt,
          },
        });
        return Ok(undefined);
      } catch (e) {
        const error = makeFsError(
          "invalid_type",
          e instanceof Error ? e.message : String(e),
          node.path,
        );
        pushError(error);
        return Err(error);
      }
    },
    [pushError],
  );

  const closeActiveKifu = useCallback(() => {
    dispatch({ type: "kifu_closed" });
  }, []);

  const createNewFile = useCallback(
    async (
      parentPath: string,
      options: KifuCreationOptions,
    ): AsyncResult<void, FsError> => {
      const res = await api.createKifu(parentPath, options);

      if (!res.success) {
        return handleFailure(res.error, {
          kind: "create_file",
          parentPath,
          options,
        });
      }

      pendingRevealPathRef.current = res.data;

      const reload = await loadFileTree();
      if (!reload.success) return reload;

      return Ok(undefined);
    },
    [handleFailure, loadFileTree],
  );

  const importKifuFile = useCallback(
    async (
      parentPath: string,
      fileName: string,
      rawContent: string,
    ): AsyncResult<void, FsError> => {
      const trimmed = rawContent.trim();
      const res = await api.importKifu(parentPath, fileName, trimmed);

      if (!res.success) {
        return handleFailure(res.error, {
          kind: "import_file",
          parentPath,
          fileName,
          rawContent: trimmed,
        });
      }

      pendingRevealPathRef.current = res.data;

      const reload = await loadFileTree();
      if (!reload.success) return reload;

      return Ok(undefined);
    },
    [loadFileTree, handleFailure],
  );

  const createNewDirectory = useCallback(
    async (parentPath: string, dirname: string): AsyncResult<void, FsError> => {
      const res = await api.createDir(parentPath, dirname);

      if (!res.success) {
        return handleFailure(res.error, {
          kind: "create_directory",
          parentPath,
          dirName: dirname,
        });
      }
      pendingRevealPathRef.current = res.data;

      const reload = await loadFileTree();
      if (!reload.success) return reload;

      return Ok(undefined);
    },
    [handleFailure, loadFileTree],
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
    async (node: FileTreeNode): AsyncResult<void, FsError> => {
      const res = node.isDirectory
        ? await api.removeDir(node.path)
        : await api.removeFile(node.path);

      if (!res.success) {
        pushError(res.error);
        return Err(res.error);
      }

      if (isSameOrDescendantPath(state.selectedNode?.path, node.path)) {
        pendingSelectedPathRef.current = null;
        dispatch({ type: "node_selected", payload: null });
      }

      if (isSameOrDescendantPath(state.activeKifuPath, node.path)) {
        dispatch({ type: "kifu_closed" });
      }

      const reload = await loadFileTree();
      if (!reload.success) return reload;

      return Ok(undefined);
    },
    [loadFileTree, pushError, state.selectedNode, state.activeKifuPath],
  );

  const renameNode = useCallback(
    async (node: FileTreeNode, newName: string) => {
      const res = node.isDirectory
        ? await api.renameDir(node.path, newName)
        : await api.renameFile(node.path, newName);

      if (!res.success) {
        return handleFailure(
          res.error,
          node.isDirectory
            ? {
                kind: "rename_directory",
                path: node.path,
                newName,
              }
            : {
                kind: "rename_file",
                path: node.path,
                newName,
              },
        );
      }

      const nextPath = res.data;
      reconcilePathMutation(node.path, nextPath);

      const isRootRename = node.isDirectory && rootDir === node.path;
      if (isRootRename) {
        setRootDir(nextPath);
        return Ok(undefined);
      }

      const reload = await loadFileTree();
      if (!reload.success) return reload;

      return Ok(undefined);
    },
    [handleFailure, loadFileTree, reconcilePathMutation, rootDir, setRootDir],
  );

  const moveNode = useCallback(
    async (
      node: FileTreeNode,
      destDir: string,
      newName?: string,
    ): AsyncResult<void, FsError> => {
      const res = node.isDirectory
        ? await api.moveDir(node.path, destDir, newName)
        : await api.moveFile(node.path, destDir, newName);

      if (!res.success) {
        return handleFailure(
          res.error,
          node.isDirectory
            ? {
                kind: "move_directory",
                path: node.path,
                destDir,
                newName,
              }
            : {
                kind: "move_file",
                path: node.path,
                destDir,
                newName,
              },
        );
      }

      const nextPath = res.data;
      reconcilePathMutation(node.path, nextPath);

      const reload = await loadFileTree();
      if (!reload.success) return reload;

      return Ok(undefined);
    },
    [handleFailure, reconcilePathMutation, loadFileTree],
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

  const refreshTree = useCallback(async (): AsyncResult<void, FsError> => {
    return await loadFileTree();
  }, [loadFileTree]);

  const isKifuSelected = useCallback(() => {
    return state.jkfData !== null && state.kifuFormat !== null;
  }, [state.jkfData, state.kifuFormat]);

  const getSelectedKifuData = useCallback(() => state.jkfData, [state.jkfData]);

  const resolveConflictByRename = useCallback(
    async (nextName: string): AsyncResult<void, FsError> => {
      const conflict = state.conflict;
      if (!conflict) return Ok(undefined);

      const trimmed = nextName.trim();
      if (!trimmed) {
        const error = makeFsError("invalid_name", "名前を入力してください");
        pushError(error);
        return Err(error);
      }

      const req = conflict.request;

      switch (req.kind) {
        case "create_file": {
          const result = await createNewFile(req.parentPath, {
            ...req.options,
            fileName: trimmed,
          });

          if (result.success) {
            dispatch({ type: "conflict_closed" });
          }
          return result;
        }

        case "import_file": {
          const result = await importKifuFile(
            req.parentPath,
            trimmed,
            req.rawContent,
          );

          if (result.success) {
            dispatch({ type: "conflict_closed" });
          }
          return result;
        }

        case "create_directory": {
          const result = await createNewDirectory(req.parentPath, trimmed);

          if (result.success) {
            dispatch({ type: "conflict_closed" });
          }
          return result;
        }

        case "rename_file":
        case "rename_directory": {
          const node = findNodeByPath(req.path);
          if (!node) {
            const error = makeFsError(
              "not_found",
              "変更対象の項目が見つかりません",
              req.path,
            );
            dispatch({ type: "conflict_closed" });
            pushError(error);
            return Err(error);
          }

          const result = await renameNode(node, trimmed);

          if (result.success) {
            dispatch({ type: "conflict_closed" });
          }
          return result;
        }

        case "move_file":
        case "move_directory": {
          const node = findNodeByPath(req.path);
          if (!node) {
            const error = makeFsError(
              "not_found",
              "移動対象の項目が見つかりません",
              req.path,
            );
            dispatch({ type: "conflict_closed" });
            pushError(error);
            return Err(error);
          }

          const result = await moveNode(node, req.destDir, trimmed);

          if (result.success) {
            dispatch({ type: "conflict_closed" });
          }
          return result;
        }
      }
    },
    [
      state.conflict,
      pushError,
      createNewFile,
      importKifuFile,
      createNewDirectory,
      renameNode,
      moveNode,
      findNodeByPath,
    ],
  );

  const revealNodeByAbsPath = useCallback(
    (absPath: string) => {
      revealNodeInCurrentTree(absPath);
    },
    [revealNodeInCurrentTree],
  );

  const selectNodeByAbsPath = useCallback(
    (absPath: string): boolean => {
      const node = findNodeByPath(absPath);
      if (!node) {
        return false;
      }

      revealNodeInCurrentTree(absPath);
      dispatch({ type: "node_selected", payload: node });

      if (node.isDirectory) {
        return true;
      }

      const isAlreadyActive =
        state.activeKifuPath === node.path &&
        state.jkfData !== null &&
        state.kifuFormat === node.kifuInfo?.format;

      if (!isAlreadyActive) {
        void openKifuNode(node);
      }

      return true;
    },
    [
      findNodeByPath,
      openKifuNode,
      revealNodeInCurrentTree,
      state.activeKifuPath,
      state.jkfData,
      state.kifuFormat,
    ],
  );

  const clearError = useCallback(() => {
    dispatch({ type: "error_cleared" });
  }, []);

  const closeConflict = useCallback(() => {
    dispatch({ type: "conflict_closed" });
  }, []);

  return (
    <FileTreeContext.Provider
      value={{
        ...state,
        loadFileTree,
        selectNode,
        openKifuNode,
        closeActiveKifu,
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
        revealNodeByAbsPath,
        selectNodeByAbsPath,
        resolveConflictByRename,
        clearError,
        closeConflict,
      }}
    >
      {children}
    </FileTreeContext.Provider>
  );
}
