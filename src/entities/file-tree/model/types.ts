import type { JKFData } from "@/entities/kifu";
import type { KifuCreationOptions, KifuFormat } from "@/entities/kifu";
import type { AsyncResult } from "@/shared/lib/result";

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

export type FileTreeState = {
  fileTree: FileTreeNode | null;
  selectedNode: FileTreeNode | null;
  jkfData: JKFData | null;
  kifuFormat: KifuFormat | null;

  expandedNodes: Set<string>;
  isLoading: boolean;
  menu: MenuState;
  renamingNodeId: string | null;
  creatingDirParentPath: string | null;
  error: string | null;
};

export type FileTreeAction =
  | { type: "loading" }
  | { type: "tree_loaded"; payload: FileTreeNode }
  | { type: "node_selected"; payload: FileTreeNode | null }
  | { type: "kifu_loaded"; payload: { jkfData: JKFData; format: KifuFormat } }
  | { type: "tree_updated"; payload: FileTreeNode }
  | { type: "node_expanded"; payload: string }
  | { type: "node_collapsed"; payload: string }
  | { type: "menu_opened"; payload: MenuState }
  | { type: "menu_closed" }
  | { type: "rename_started"; payload: string }
  | { type: "rename_ended" }
  | { type: "create_dir_started"; payload: string }
  | { type: "create_dir_ended" }
  | { type: "error"; payload: string };

export const initialState: FileTreeState = {
  fileTree: null,
  selectedNode: null,
  jkfData: null,
  kifuFormat: null,
  expandedNodes: new Set<string>(),
  isLoading: false,
  menu: null,
  renamingNodeId: null,
  creatingDirParentPath: null,
  error: null,
};

export type FileTreeContextType = FileTreeState & {
  loadFileTree: () => Promise<void>;
  selectNode: (node: FileTreeNode | null) => void;
  loadSelectedKifu: () => Promise<void>;

  createNewFile: (
    parentPath: string,
    options: KifuCreationOptions,
  ) => Promise<void>;
  importKifuFile: (
    parentPath: string,
    fileName: string,
    rawContent: string,
  ) => AsyncResult<string, string>;
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
  startInlineRename: (node: FileTreeNode) => void;
  cancelInlineRename: () => void;
  startCreateDirectory: (parentPath: string) => void;
  cancelCreateDirectory: () => void;

  selectNodeByAbsPath: (absPath: string) => void;
};
