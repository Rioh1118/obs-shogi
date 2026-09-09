import type { JKFData } from "@/entities/kifu/model/jkf";
import type { KifuCreationOptions, KifuFormat } from "@/entities/kifu/model/kifu";
import type { AsyncResult } from "@/shared/lib/result";
import type { FsError } from "../api/error";

export interface FileSystemNode {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
  /**
   * 走査を途中で打ち切った。**`children` の少なさを鵜呑みにできない印。**
   *
   * これを見ないと、上限に当たったフォルダが「空のフォルダ」と同じに描かれる。
   * 中身は Finder では見えるのに、何度読み直しても一覧には出ない
   */
  truncated?: boolean;
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
  /**
   * **ツリーが開いた棋譜。** `openKifuNode` が構文として読めた時点で進む。
   *
   * **盤に載ったことは意味しない。** 載るかは `entities/game` の `loadGame` まで
   * 来ないと分からないので、載せられなかった回はこちらだけが進む。
   * 画面に出ている棋譜を問うなら `entities/game` の `loadedAbsPath`。
   */
  activeKifuPath: string | null;
  jkfData: JKFData | null;
  kifuFormat: KifuFormat | null;

  expandedNodes: Set<string>;
  isLoading: boolean;
  menu: MenuState;
  renamingNodeId: string | null;
  creatingDirParentPath: string | null;
  /**
   * ツリーまわりの失敗。**出どころを持つ。**
   *
   * `operation` は利用者が起こした操作そのものの失敗。`reload` は操作は通ったが
   * そのあとの読み直しが落ちた場合で、画面に「失敗しました」とだけ出すと
   * 「操作が失敗した」と読めてしまう（実際は済んでいて、一覧だけが古い）
   */
  error: FileTreeFailure | null;
  kifuError: FsError | null;
  conflict: FileConflictState | null;
};

export type FileTreeFailure = {
  from: "operation" | "reload";
  error: FsError;
};

export type FileTreeAction =
  | { type: "loading" }
  | { type: "kifu_loading" }
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
  /** ツリーの読み直しの失敗。`error` と違い、衝突の対話が開いていても捨てない */
  | { type: "reload_failed"; payload: FsError }
  | { type: "error_cleared" }
  | { type: "kifu_error"; payload: FsError }
  | { type: "kifu_error_cleared" }
  | { type: "conflict_opened"; payload: FileConflictState }
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
  kifuError: null,
  conflict: null,
};

export type SelectNodeOptions = {
  /**
   * ツリー側が「もう開いている」と判断しても、開き直させる。
   *
   * 判断材料は盤の側（`entities/game` の `loadedAbsPath`）にしか無く、ここからは見えない。
   *
   * **省略できないのは、省いた側が黙るから。** 既定値を置くと「盤に載っていない棋譜への
   * 2度目の要求が、何も起こさずに成功を返す」に倒れる。正しい既定値を決めようが無いので、
   * 呼び出し側に必ず書かせる。
   */
  forceReopen: boolean;
};

export type FileTreeContextType = FileTreeState & {
  loadFileTree: () => AsyncResult<void, FsError>;

  /**
   * 選択を動かす。**ツリーが開くべき棋譜も一緒に動く**（フォルダは動かさない）。
   *
   * 飛行中の読み出しは、返った時点で宛先と違うパスなら捨てられる。棋譜を選んでから
   * `openKifuNode` を呼ぶ順にすること。逆にすると、選び直しが読み出しを追い越す
   */
  selectNode: (node: FileTreeNode | null) => void;

  /**
   * 棋譜を読んで `activeKifuPath` を進める。
   *
   * **`Ok` は「開いた」を意味しない。** 読んでいるあいだに利用者が別の棋譜を選んだ
   * 要求は、何も起こさずに `Ok` で抜ける（結果を捨てないと、ツリーが選んでいるのとは
   * 別の棋譜が開いたことになる → #223）。フォルダを渡したときも `Ok`。
   *
   * 開けたかは `activeKifuPath`、盤に載ったかは `entities/game` の `loadedAbsPath`
   */
  openKifuNode: (node: FileTreeNode) => AsyncResult<void, FsError>;
  closeActiveKifu: () => void;

  createNewFile: (parentPath: string, options: KifuCreationOptions) => AsyncResult<void, FsError>;

  importKifuFile: (
    parentPath: string,
    fileName: string,
    rawContent: string,
  ) => AsyncResult<void, FsError>;

  createNewDirectory: (parentPath: string, dirname: string) => AsyncResult<void, FsError>;

  toggleNode: (nodePath: string) => void;
  isNodeExpanded: (nodePath: string) => boolean;

  deleteNode: (node: FileTreeNode) => AsyncResult<void, FsError>;
  renameNode: (node: FileTreeNode, newName: string) => AsyncResult<void, FsError>;

  moveNode: (node: FileTreeNode, destDir: string, newName?: string) => AsyncResult<void, FsError>;

  refreshTree: () => AsyncResult<void, FsError>;
  isKifuSelected: () => boolean;
  getSelectedKifuData: () => JKFData | null;

  openContextMenu: (node: FileTreeNode, x: number, y: number) => void;
  closeContextMenu: () => void;
  startInlineRename: (node: FileTreeNode) => void;
  cancelInlineRename: () => void;
  startCreateDirectory: (parentPath: string) => void;
  cancelCreateDirectory: () => void;

  /** 表示側で見つけた失敗を、Rust から返る失敗と同じ経路に載せる */
  pushError: (error: FsError) => void;
  clearError: () => void;
  clearKifuError: () => void;
  closeConflict: () => void;
  resolveConflictByRename: (nextName: string) => AsyncResult<void, FsError>;

  revealNodeByAbsPath: (absPath: string) => void;

  /**
   * ツリーの選択をそのパスへ移し、必要なら棋譜を開く。
   *
   * **返るのは「ツリーにその節が在ったか」だけ。** 開けたかも、盤に載ったかも意味しない。
   */
  selectNodeByAbsPath: (absPath: string, options: SelectNodeOptions) => boolean;
};
