import type { JKFData } from "@/entities/kifu";
import type { KifuCreationOptions, KifuFormat } from "@/entities/kifu";
import type { AsyncResult } from "@/shared/lib/result";
import type { FsError } from "../api/error";

export interface FileSystemNode {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
  lastModified?: Date;
  size?: number;
}

export interface FileTreeDisplayInfo {
  iconType: "folder" | "kif-file";
  isExpanded?: boolean;
  isSelected?: boolean;
}

export interface KifuFileInfo {
  format: KifuFormat;
  moveCount?: number;
  hasBranches?: boolean;
  gameInfo?: {
    black?: string;
    white?: string;
    date?: string;
  };
}

export type FileTreeNode = FileSystemNode & {
  displayInfo: FileTreeDisplayInfo;
  kifuInfo?: KifuFileInfo;
};

export type MenuState = { node: FileTreeNode; x: number; y: number } | null;

export type FileConflictRequest =
  | {
      kind: "create_file";
      parentPath: string;
      options: KifuCreationOptions;
    }
  | {
      kind: "import_file";
      parentPath: string;
      fileName: string;
      rawContent: string;
    }
  | {
      kind: "create_directory";
      parentPath: string;
      dirName: string;
    }
  | {
      kind: "rename_file";
      path: string;
      newName: string;
    }
  | {
      kind: "rename_directory";
      path: string;
      newName: string;
    }
  | {
      kind: "move_file";
      path: string;
      destDir: string;
      newName?: string;
    }
  | {
      kind: "move_directory";
      path: string;
      destDir: string;
      newName?: string;
    };

export type FileConflictState = {
  request: FileConflictRequest;
  error: FsError;
};

export type FileTreeState = {
  fileTree: FileTreeNode | null;
  // ツリー上の選択
  selectedNode: FileTreeNode | null;
  // 現在開いている棋譜
  activeKifuPath: string | null;
  jkfData: JKFData | null;
  kifuFormat: KifuFormat | null;

  expandedNodes: Set<string>;
  isLoading: boolean;
  menu: MenuState;
  renamingNodeId: string | null;
  creatingDirParentPath: string | null;
  error: string | null;
  conflict: FileConflictState | null;
};

export type FileTreeAction =
  | { type: "loading" }
  | { type: "tree_loaded"; payload: FileTreeNode }
  | { type: "node_selected"; payload: FileTreeNode | null }
  | {
      type: "kifu_opened";
      payload: {
        path: string;
        jkfData: JKFData;
        format: KifuFormat;
      };
    }
  | { type: "kifu_closed" }
  | { type: "tree_updated"; payload: FileTreeNode }
  | { type: "node_expanded"; payload: string }
  | { type: "node_collapsed"; payload: string }
  | { type: "menu_opened"; payload: MenuState }
  | { type: "menu_closed" }
  | { type: "rename_started"; payload: string }
  | { type: "rename_ended" }
  | { type: "create_dir_started"; payload: string }
  | { type: "create_dir_ended" }
  | { type: "nodes_expanded"; payload: string[] }
  | { type: "selected_node_reconciled"; payload: FileTreeNode | null }
  | {
      type: "active_kifu_reconciled";
      payload: {
        path: string | null;
        jkfData?: JKFData | null;
        format?: KifuFormat | null;
      };
    }
  | { type: "error"; payload: FsError }
  | { type: "error_cleared" }
  | { type: "conflict_opend"; payload: FileConflictState }
  | { type: "conflict_closed" };

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
  conflict: null,
};

export type FileTreeContextType = FileTreeState & {
  loadFileTree: () => AsyncResult<void, FsError>;
  selectNode: (node: FileTreeNode | null) => void;
  openKifuNode: (node: FileTreeNode) => AsyncResult<void, FsError>;
  closeActiveKifu: () => void;

  createNewFile: (
    parentPath: string,
    options: KifuCreationOptions,
  ) => AsyncResult<void, FsError>;

  importKifuFile: (
    parentPath: string,
    fileName: string,
    rawContent: string,
  ) => AsyncResult<void, FsError>;

  createNewDirectory: (
    parentPath: string,
    dirname: string,
  ) => AsyncResult<void, FsError>;

  toggleNode: (nodePath: string) => void;
  isNodeExpanded: (nodePath: string) => boolean;

  deleteNode: (node: FileTreeNode) => AsyncResult<void, FsError>;
  renameNode: (
    node: FileTreeNode,
    newName: string,
  ) => AsyncResult<void, FsError>;

  moveNode: (
    node: FileTreeNode,
    destDir: string,
    newName?: string,
  ) => AsyncResult<void, FsError>;

  refreshTree: () => AsyncResult<void, FsError>;
  isKifuSelected: () => boolean;
  getSelectedKifuData: () => JKFData | null;

  openContextMenu: (node: FileTreeNode, x: number, y: number) => void;
  closeContextMenu: () => void;
  startInlineRename: (node: FileTreeNode) => void;
  cancelInlineRename: () => void;
  startCreateDirectory: (parentPath: string) => void;
  cancelCreateDirectory: () => void;

  clearError: () => void;
  closeConflict: () => void;

  selectNodeByAbsPath: (absPath: string) => void;
};
