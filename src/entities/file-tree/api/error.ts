export type FsErrorCode =
  | "already_exists"
  | "not_found"
  // 名前の検証。何を直せばよいかが code から決まるように、原因ごとに分けてある
  | "invalid_name_empty"
  | "invalid_name_reserved"
  | "invalid_name_separator"
  | "invalid_name_control"
  | "invalid_path"
  | "invalid_type"
  | "invalid_extension"
  | "invalid_destination"
  | "permission_denied"
  | "io"
  // 棋譜の読み込み。Rust は返さない。TS 側で作る
  | "kifu_format_unknown"
  | "kifu_parse_failed"
  | "unknown";

export type FsError = {
  code: FsErrorCode;
  /**
   * 開発者向けのログ。**利用者に見せる文は `describeFsError` が code から作る。**
   * ここに利用者向けの日本語を入れると、同じ型の値が画面ごとに違う規則で
   * 文章化されることになる。
   */
  message: string;
  path?: string;
  existingPath?: string;
  cause?: string;
};

// `satisfies` で全ての code を並べさせる。`FsErrorCode` を増やすと型検査がここへ連れてくる
const FS_ERROR_CODES = {
  already_exists: true,
  not_found: true,
  invalid_name_empty: true,
  invalid_name_reserved: true,
  invalid_name_separator: true,
  invalid_name_control: true,
  invalid_path: true,
  invalid_type: true,
  invalid_extension: true,
  invalid_destination: true,
  permission_denied: true,
  io: true,
  kifu_format_unknown: true,
  kifu_parse_failed: true,
  unknown: true,
} satisfies Record<FsErrorCode, true>;

function isFsErrorCode(code: unknown): code is FsErrorCode {
  return typeof code === "string" && code in FS_ERROR_CODES;
}

/**
 * 外から来た値を `FsError` にする。
 *
 * `api/service.ts` は `catch (e) { ... }` の形で、Rust 由来でない例外も
 * ここへ流す（棋譜のパース失敗など）。素通しすると `code` がどの分岐にも当たらず、
 * 表示側で見出しの無い箱になる。
 */
export function asFsError(error: unknown): FsError {
  const e = error as Partial<FsError> | null | undefined;
  if (e && typeof e.message === "string" && isFsErrorCode(e.code)) {
    return e as FsError;
  }
  return makeFsError("unknown", error instanceof Error ? error.message : String(error));
}

export function makeFsError(code: FsErrorCode, message: string, path?: string): FsError {
  return { code, message, path };
}

/**
 * 別名を選ばせる対話（`FileConflictDialog`）が引き取る失敗か。
 *
 * 引き取られた失敗を呼び出し元でも描くと、同じ失敗が対話とその背後に二重に出る。
 * どちらが引き取るかの判定をここ1箇所に置き、失敗を出す側と引き取る側が
 * 同じ条件を見るようにする。
 */
export function isResolvedByConflictDialog(code: FsErrorCode): boolean {
  return code === "already_exists";
}

/**
 * 打った名前を直せば通る失敗か。
 *
 * この種の失敗は**入力欄のそばに出す**（ADR-0004 の F-14）。通知として積むと
 * reducer が編集行ごと畳み、打った文字列まで一緒に捨てることになる。
 * 直すための入力欄が、直せという知らせに巻き込まれて消える。
 */
export function isNameInputError(code: FsErrorCode): boolean {
  switch (code) {
    case "invalid_name_empty":
    case "invalid_name_reserved":
    case "invalid_name_separator":
    case "invalid_name_control":
      return true;
    default:
      return false;
  }
}

/**
 * 復帰に何が要るか（ADR-0004）。
 *
 * `warning` は読み直しで直る見込みがあるもの、`danger` は読み直しても結果が変わらず、
 * 入力か権限の側を変えないと直らないもの。読み直しても直らない失敗に再読み込みを
 * 出すと、押しても何も起きないので利用者は押し続ける。
 */
export function fsErrorTier(code: FsErrorCode): "warning" | "danger" {
  switch (code) {
    // 一時的な事情で失敗した可能性がある。読み直すと結果が変わりうる
    case "io":
    case "unknown":
      return "warning";

    // ほかで移動・削除された。読み直せばツリーが現在の状態に追いつく
    case "not_found":
      return "warning";

    // 何度読み直しても同じ結果になる。権限か入力、あるいはファイルの中身の側を変えるしかない
    case "permission_denied":
    case "already_exists":
    case "invalid_name_empty":
    case "invalid_name_reserved":
    case "invalid_name_separator":
    case "invalid_name_control":
    case "invalid_path":
    case "invalid_type":
    case "invalid_extension":
    case "invalid_destination":
    case "kifu_format_unknown":
    case "kifu_parse_failed":
      return "danger";
  }
}

/**
 * 利用者に見せる一文。**ここが利用者向けの文言の唯一の置き場。**
 * 網羅にしてあるので、`FsErrorCode` を増やすと型検査がここへ連れてくる。
 */
export function describeFsError(code: FsErrorCode): string {
  switch (code) {
    case "already_exists":
      return "同じ名前のものが既にあります";
    case "not_found":
      return "見つかりません。ほかで移動または削除された可能性があります";
    case "invalid_name_empty":
      return "名前を入力してください";
    case "invalid_name_reserved":
      return "その名前は使えません";
    case "invalid_name_separator":
      return "名前に / や \\ は使えません";
    case "invalid_name_control":
      return "名前に使えない文字が含まれています";
    case "invalid_path":
      return "その場所は扱えません";
    case "invalid_type":
      return "ファイルとフォルダを取り違えています";
    case "invalid_extension":
      return "対応していない拡張子です";
    case "invalid_destination":
      return "その移動先には置けません";
    case "permission_denied":
      return "権限がありません";
    case "io":
      return "読み書きに失敗しました";
    case "kifu_format_unknown":
      return "対応していない棋譜の形式です";
    case "kifu_parse_failed":
      return "棋譜を解析できませんでした";
    case "unknown":
      return "原因が分かりませんでした";
  }
}
