/**
 * 定跡ファイルの形式。綴りは Rust の `BookFormat`（`serde(rename_all = "camelCase")`）。
 *
 * どの形式を読めるかはここへ写さない。増えるのは Rust で、写すとこちらだけが古くなる
 * （`docs/spec/features/book.md`）。
 */
export type BookFormat = "yaneuraouDb" | "aperyBin" | "shogiGuiSbk" | "yaneuraouYbb";

/** 定跡が持っている1手。欠けている欄は形式と行による（Rust の `BookMove`） */
export type BookMove = {
  /** USI 表記（`7g7f` / `P*5e`） */
  usiMove: string;
  /** 相手の応手。定跡が持っていなければ `null` */
  ponder: string | null;
  /** 手番側から見た評価値 */
  value: number | null;
  depth: number | null;
  /** この手が選ばれた回数 */
  count: number | null;
};

/** 開いている定跡ひとつ（Rust の `BookInfo`） */
export type BookInfo = {
  handle: number;
  path: string;
  format: BookFormat;
  /**
   * 収録局面数。指し手の数ではない。数えられない形式は `null`。
   * `0` は本当に0局面なので、`null` と同じに扱わないこと。
   */
  positionCount: number | null;
  /**
   * 読めずに捨てた欄の数。0 でないなら、表の `—` は「もともと無い」でなく「読み損ねた」かもしれない。
   *
   * 数える欄は `ponder`、`value`、`depth`、`count` の4つ。応手を外すと、壊れた応手の綴りを持つ
   * 定跡で、応手欄の `—` だけが「定跡が応手を持っていない」と読める。
   */
  droppedFields: number | null;
};

/** 定跡を辿るのをやめた理由（Rust の `BookWalkStop`） */
export type BookWalkStop = "outOfBook" | "depthCap" | "brokenMove";

/** 候補手1本を辿った結果（Rust の `BookLine`） */
export type BookLine = {
  /** 辿り始めた手。並びでなくこれで突き合わせる */
  usiMove: string;
  /** 定跡に沿って進めた手数。辿り始めた手を含む（`1` は行き止まり） */
  plies: number;
  stopped: BookWalkStop;
};

/**
 * フロントで分岐できる粒度の失敗種別。
 * 綴りは Rust の `BookErrorCode`（`serde(rename_all = "snake_case")`。camelCase ではない）。
 */
export type BookErrorCode =
  | "not_found"
  | "permission_denied"
  | "invalid_type"
  | "invalid_path"
  | "unknown_extension"
  | "unsupported_format"
  | "invalid_content"
  | "too_large"
  | "invalid_handle"
  | "invalid_sfen"
  | "io"
  | "unknown";

/**
 * 定跡まわりの失敗。
 *
 * 分岐に使うのは `code` だけで、`message` では分岐しない。利用者に見せる文は Rust が組み立て、
 * 文言はそちらの都合で変わる。
 */
export type BookError = {
  code: BookErrorCode;
  message: string;
  /** どのファイルで起きたか。帯の文に添える */
  path: string | null;
};
