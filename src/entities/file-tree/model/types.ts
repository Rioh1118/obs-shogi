import type { JKFData } from "@/entities/kifu/model/jkf";
import type { KifuCreationOptions, KifuFormat } from "@/entities/kifu/model/kifu";
import type { AsyncResult } from "@/shared/lib/result";
import type { FsError } from "../api/error";

export type FileTreeNode = {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
  /**
   * 走査を途中で打ち切った印。`children` の少なさを鵜呑みにしないために見る。
   *
   * これを見ないと、上限に当たったフォルダが「空のフォルダ」と同じに描かれる。
   * 中身は Finder では見えるのに、何度読み直しても一覧には出ない
   */
  truncated?: boolean;
  lastModified?: Date;
  size?: number;
  displayInfo: { iconType: "folder" | "kif-file" };
  kifuInfo?: { format: KifuFormat };
};

type MenuState = { node: FileTreeNode; x: number; y: number } | null;

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
  selectedNode: FileTreeNode | null;
  /**
   * ツリーが開いた棋譜のパス。`openKifuNode` が構文として読めた時点で進む。
   *
   * 盤に載ったことは意味しない。載るかは `entities/game` の `loadGame` まで
   * 来ないと分からないので、載せられなかったときはこちらだけが進む。
   * 画面に出ている棋譜を問うなら `entities/game` の `loadedAbsPath`。
   */
  activeKifuPath: string | null;
  /**
   * 開いた時点で読んだ棋譜。開いたときの内容のまま古くなる。
   * 棋譜を入れるのは `kifu_opened` だけで、盤の保存（`saveKifuToFile`）はディスクにしか
   * 書かない。編集後の中身が要るなら `entities/game` の `jkf` を見る。
   *
   * この参照が改名と移動を跨いで変わらないことが、盤の保存先を張り替えてよい唯一の根拠に
   * なる（`GameFileTreeBridge` が前に載せた `jkfData` と突き合わせている）。
   * 参照を作り直すと改名で盤が載せ直され、開いた時点まで巻き戻る。
   * 逆に、**別のファイルを指しながら参照を持ち越すと、盤の棋譜が別のファイルへ書かれる。**
   * `activeKifuReferenceIdentity.test.ts` が両方向を固定している。
   */
  jkfData: JKFData | null;
  kifuFormat: KifuFormat | null;

  expandedNodes: Set<string>;
  isLoading: boolean;
  menu: MenuState;
  renamingNodeId: string | null;
  creatingDirParentPath: string | null;
  /**
   * ツリーまわりの失敗。出どころを `from` に持つ。
   *
   * `operation` は利用者が起こした操作そのものの失敗。`reload` はツリーの取得の失敗で、
   * 操作のあとの読み直しなら操作は済んでいて、一覧だけが古い。画面に「失敗しました」と
   * だけ出すと操作が失敗したと読めるので、見出しを分ける（`failureHeading`）
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
  /**
   * 改名か移動でパスが張り替わった。`jkfData` と `kifuFormat` は据え置く。
   *
   * 同じ棋譜の名前が変わっただけなので、参照が残ることが盤の載せ直しを避ける根拠になる
   * （`jkfData` の doc）。`path` が `null` なら棋譜を閉じる。
   * 形式が据え置けるのは、`ensure_same_extension` が拡張子を変える改名を断るから。
   */
  | {
      type: "active_kifu_reconciled";
      payload: {
        path: string | null;
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

export type SelectNodeOptions = {
  /**
   * ツリーが「もう開いている」と見ても開き直させる。
   *
   * 判断材料は盤の側（`entities/game` の `loadedAbsPath`）にしか無く、ここからは見えない。
   *
   * 省略できないのは、省いた側が黙るから。既定値を置くと「盤に載っていない棋譜への
   * 2度目の要求が、何も起こさずに成功を返す」に倒れる。正しい既定値を決めようが無いので、
   * 呼び手に必ず書かせる。
   */
  forceReopen: boolean;
};

export type FileTreeContextType = FileTreeState & {
  /**
   * 選択を動かす。ツリーが開くべき棋譜も一緒に動く（フォルダは動かさない）。
   *
   * 飛行中の読み出しは、返った時点で宛先と違うパスなら捨てられる。棋譜を選んでから
   * `openKifuNode` を呼ぶ順にする。読み出しを待ってから選ぶと、開けなかったときに
   * 選択が戻らず、開いていない棋譜が選ばれたまま残る
   */
  selectNode: (node: FileTreeNode | null) => void;

  /**
   * 棋譜を読んで `activeKifuPath` を進める。
   *
   * `Ok` は「開いた」を意味しない。読んでいるあいだに利用者が別の棋譜を選んだ要求は、
   * 何も起こさずに `Ok` で抜ける（結果を捨てないと、ツリーが選んでいるのとは別の棋譜が
   * 開いたことになる）。フォルダを渡したときも `Ok`。
   *
   * 開けたかは `activeKifuPath`、盤に載ったかは `entities/game` の `loadedAbsPath`
   */
  openKifuNode: (node: FileTreeNode) => AsyncResult<void, FsError>;

  /**
   * 棋譜を1枚作り、作られた絶対パスを返す。
   *
   * ツリーの読み直しを待ってから返る。行は見える位置まで開くが、**選択は動かさない**。
   * 作ったファイルを開きたい呼び手は、返ったパスを `selectNodeByAbsPath` へ渡す。
   */
  createNewFile: (parentPath: string, options: KifuCreationOptions) => AsyncResult<string, FsError>;

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

  /**
   * ツリーの選択をそのパスへ移し、必要なら棋譜を開く。
   *
   * 返るのは、ツリーにその節が在ったかだけ。開けたかも、盤に載ったかも意味しない。
   */
  selectNodeByAbsPath: (absPath: string, options: SelectNodeOptions) => boolean;
};
