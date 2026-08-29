import { useCallback, useEffect, useReducer, useRef, type ReactNode } from "react";

import type { FileConflictRequest, FileTreeNode } from "./types";
import { FileTreeContext } from "./context";
import { reducer } from "./reducer";
import { initialState } from "./types";

import * as api from "../api/service";
import { parseKifuContentToJKF } from "@/entities/kifu/api/parse";
import { type KifuCreationOptions } from "@/entities/kifu/model/kifu";
import { sanitizeJkf } from "@/entities/kifu/lib/sanitizeJkf";
import {
  findNodeChain,
  isSameOrDescendantPath,
  remapSubtreePath,
  scrollNodeIntoView,
} from "../lib/path";
import {
  isNameInputError,
  isResolvedByConflictDialog,
  makeFsError,
  type FsError,
} from "../api/error";
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
  const selectedNodeRef = useRef(state.selectedNode);
  selectedNodeRef.current = state.selectedNode;
  const kifuOpenGenerationRef = useRef(0);

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

  const pushConflict = useCallback((request: FileConflictRequest, error: FsError) => {
    dispatch({
      type: "conflict_opened",
      payload: { request, error },
    });
  }, []);

  // 失敗をどこへ出すかは、その操作を**起こした場所が出す場所を持っているか**で決まる。
  // 3つの名前はその行き先を表す。→ docs/state-transitions/file-tree.md の ※2

  // 通知へ積む。ツリーから直に起こす操作で使う（呼び出し元は出す場所を持たない）
  const failWithNotice = useCallback(
    (error: FsError, request?: FileConflictRequest) => {
      if (isResolvedByConflictDialog(error.code) && request) {
        pushConflict(request, error);
      } else {
        pushError(error);
      }
      return Err(error);
    },
    [pushConflict, pushError],
  );

  // 呼び出し元へ返す。モーダルの中から起こす操作で使う。
  // あちらは自分の中に出す場所を持っているので、ここでも積むと同じ失敗が
  // 2箇所に別の文言で同時に出る。衝突だけは別名を選ばせる対話が引き取る
  const failToCaller = useCallback(
    (error: FsError, request: FileConflictRequest) => {
      if (isResolvedByConflictDialog(error.code)) {
        pushConflict(request, error);
      }
      return Err(error);
    },
    [pushConflict],
  );

  // 名前の失敗だけ呼び出し元へ返し、残りは通知へ積む。入力欄から起こす操作で使う。
  // 入力欄はその場に残っているので、そこへ出せば打った文字列を捨てずに直せる。
  // state.error に積むと reducer が編集行ごと畳む（ADR-0004 の F-14）
  const failToNameInput = useCallback(
    (error: FsError, request: FileConflictRequest) => {
      if (isResolvedByConflictDialog(error.code)) {
        pushConflict(request, error);
      } else if (!isNameInputError(error.code)) {
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
        pendingSelectedPathRef.current = remapSubtreePath(selectedPath, oldPath, nextPath);
      }

      const activePath = state.activeKifuPath;
      if (isSameOrDescendantPath(activePath, oldPath)) {
        const nextActiveKifuPath = remapSubtreePath(activePath, oldPath, nextPath);

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

  const openKifuNode = useCallback(async (node: FileTreeNode): AsyncResult<void, FsError> => {
    if (node.isDirectory) return Ok(undefined);

    const fmt = node.kifuInfo?.format;
    if (!fmt) {
      const error = makeFsError("kifu_format_unknown", "kifu format is not resolved", node.path);
      dispatch({ type: "kifu_error", payload: error });
      return Err(error);
    }

    const prevSelectedNode = selectedNodeRef.current;
    const myGeneration = ++kifuOpenGenerationRef.current;

    const restoreSelection = () => {
      // 1) このリクエストより新しい openKifuNode が始まっていたらスキップ
      // 2) openKifuNode 以外の操作（ツリー再読み込み・deleteNode 等）で
      //    selectedNode が既に別のノードに変わっていてもスキップ
      if (
        kifuOpenGenerationRef.current === myGeneration &&
        selectedNodeRef.current?.path === node.path
      ) {
        dispatch({ type: "node_selected", payload: prevSelectedNode });
      }
    };

    dispatch({ type: "kifu_loading" });

    const readRes = await api.readKifu(node);
    if (!readRes.success) {
      restoreSelection();
      dispatch({ type: "kifu_error", payload: readRes.error });
      return Err(readRes.error);
    }

    try {
      const jkfData = sanitizeJkf(parseKifuContentToJKF(readRes.data, fmt));
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
      restoreSelection();
      // cause には元の例外メッセージだけを入れる。スタックはノイズが多い
      const rawCause = e instanceof Error ? (e as { cause?: unknown }).cause : undefined;
      const cause =
        e instanceof Error
          ? rawCause instanceof Error
            ? `${e.message}\n原因: ${rawCause.message}`
            : e.message
          : String(e);
      const error: FsError = {
        code: "kifu_parse_failed",
        message: "failed to parse kifu content",
        path: node.path,
        cause,
      };
      dispatch({ type: "kifu_error", payload: error });
      return Err(error);
    }
  }, []);

  const closeActiveKifu = useCallback(() => {
    dispatch({ type: "kifu_closed" });
  }, []);

  const createNewFile = useCallback(
    async (parentPath: string, options: KifuCreationOptions): AsyncResult<void, FsError> => {
      const res = await api.createKifu(parentPath, options);

      if (!res.success) {
        return failToCaller(res.error, {
          kind: "create_file",
          parentPath,
          options,
        });
      }

      pendingRevealPathRef.current = res.data;

      // 変更そのものは成功している。読み直しの失敗は loadFileTree が state.error へ
      // 積むので、ここで返すと同じ失敗が2箇所に出るうえ「操作に失敗した」と嘘になる
      void loadFileTree();
      return Ok(undefined);
    },
    [failToCaller, loadFileTree],
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
        return failToCaller(res.error, {
          kind: "import_file",
          parentPath,
          fileName,
          rawContent: trimmed,
        });
      }

      pendingRevealPathRef.current = res.data;

      // 変更そのものは成功している。読み直しの失敗は loadFileTree が state.error へ
      // 積むので、ここで返すと同じ失敗が2箇所に出るうえ「操作に失敗した」と嘘になる
      void loadFileTree();
      return Ok(undefined);
    },
    [loadFileTree, failToCaller],
  );

  const createNewDirectory = useCallback(
    async (parentPath: string, dirname: string): AsyncResult<void, FsError> => {
      const res = await api.createDir(parentPath, dirname);

      if (!res.success) {
        return failToNameInput(res.error, {
          kind: "create_directory",
          parentPath,
          dirName: dirname,
        });
      }
      pendingRevealPathRef.current = res.data;

      // 変更そのものは成功している。読み直しの失敗は loadFileTree が state.error へ
      // 積むので、ここで返すと同じ失敗が2箇所に出るうえ「操作に失敗した」と嘘になる
      void loadFileTree();
      return Ok(undefined);
    },
    [failToNameInput, loadFileTree],
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

      // 変更そのものは成功している。読み直しの失敗は loadFileTree が state.error へ
      // 積むので、ここで返すと同じ失敗が2箇所に出るうえ「操作に失敗した」と嘘になる
      void loadFileTree();
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
        return failToNameInput(
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

      // 変更そのものは成功している。読み直しの失敗は loadFileTree が state.error へ
      // 積むので、ここで返すと同じ失敗が2箇所に出るうえ「操作に失敗した」と嘘になる
      void loadFileTree();
      return Ok(undefined);
    },
    [failToNameInput, loadFileTree, reconcilePathMutation, rootDir, setRootDir],
  );

  const moveNode = useCallback(
    async (node: FileTreeNode, destDir: string, newName?: string): AsyncResult<void, FsError> => {
      const res = node.isDirectory
        ? await api.moveDir(node.path, destDir, newName)
        : await api.moveFile(node.path, destDir, newName);

      if (!res.success) {
        return failWithNotice(
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

      // 変更そのものは成功している。読み直しの失敗は loadFileTree が state.error へ
      // 積むので、ここで返すと同じ失敗が2箇所に出るうえ「操作に失敗した」と嘘になる
      void loadFileTree();
      return Ok(undefined);
    },
    [failWithNotice, reconcilePathMutation, loadFileTree],
  );

  const openContextMenu = useCallback((node: FileTreeNode, x: number, y: number) => {
    dispatch({ type: "menu_opened", payload: { node, x, y } });
  }, []);

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
        // 対話が開いている間 reducer は `error` を落とすので、積んでも出ない。
        // 名前の失敗は対話の `submitError` が出す（ADR-0004 の F-14）
        return Err(makeFsError("invalid_name_empty", "name is empty"));
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
          const result = await importKifuFile(req.parentPath, trimmed, req.rawContent);

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
            // 対話を先に閉じてから積む。開いている間は reducer が `error` を落とす。
            // 対象が消えている以上、この対話では直せないので通知へ送る
            const error = makeFsError("not_found", "rename target is missing", req.path);
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
            // 対話を先に閉じてから積む（上と同じ理由）
            const error = makeFsError("not_found", "move target is missing", req.path);
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

  const clearKifuError = useCallback(() => {
    dispatch({ type: "kifu_error_cleared" });
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
        pushError,
        clearError,
        clearKifuError,
        closeConflict,
      }}
    >
      {children}
    </FileTreeContext.Provider>
  );
}
