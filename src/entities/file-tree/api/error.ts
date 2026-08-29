export type FsErrorCode =
  | "already_exists"
  | "not_found"
  | "invalid_name"
  | "invalid_path"
  | "invalid_type"
  | "invalid_extension"
  | "invalid_destination"
  | "permission_denied"
  | "io"
  | "unknown";

export type FsError = {
  code: FsErrorCode;
  message: string;
  path?: string;
  existingPath?: string;
  cause?: string;
};

export function asFsError(error: unknown): FsError {
  return error as FsError;
}

export function makeFsError(code: FsErrorCode, message: string, path?: string): FsError {
  return { code, message, path };
}

/**
 * 利用者に見せる一文。`message` は Rust の生メッセージなのでそのままは出さない。
 * 網羅にすることで、`FsErrorCode` を増やしたときに型検査がここへ連れてくる。
 */
export function describeFsError(code: FsErrorCode): string {
  switch (code) {
    case "already_exists":
      return "同じ名前のものが既にあります";
    case "not_found":
      return "見つかりません。ほかで移動または削除された可能性があります";
    case "invalid_name":
      return "その名前は使えません";
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
    case "unknown":
      return "原因が分かりませんでした";
  }
}
