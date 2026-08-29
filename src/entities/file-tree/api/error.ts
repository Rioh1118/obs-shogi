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

// `satisfies` で全ての code を並べさせる。`FsErrorCode` を増やすと型検査がここへ連れてくる
const FS_ERROR_CODES = {
  already_exists: true,
  not_found: true,
  invalid_name: true,
  invalid_path: true,
  invalid_type: true,
  invalid_extension: true,
  invalid_destination: true,
  permission_denied: true,
  io: true,
  unknown: true,
} satisfies Record<FsErrorCode, true>;

function isFsErrorCode(code: unknown): code is FsErrorCode {
  return typeof code === "string" && code in FS_ERROR_CODES;
}

/**
 * 外から来た値を `FsError` にする。
 *
 * `api/service.ts` は `catch (e) { ... e as FsError }` の形で、Rust 由来でない例外も
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

export type FsErrorPresentation = {
  /**
   * 復帰に何が要るか（ADR-0004）。`warning` は読み直しで直る見込みがあるもの、
   * `danger` は読み直しても結果が変わらず、入力か権限の側を変えないと直らないもの。
   */
  tier: "warning" | "danger";
  /**
   * `code` だけでは何を直せばよいか伝わらないので、Rust の `message` を本文に添える。
   * 検証の失敗は空・`.`・`..`・パス区切り・NUL を1つの `code` に潰しているため、
   * 具体を持っているのは `message` しかない。
   */
  showMessage: boolean;
};

/**
 * 段と本文の出し方を同時に決める。分けて置くと、`FsErrorCode` を増やしたときに
 * 片方だけ更新して気づかない。
 */
export function fsErrorPresentation(code: FsErrorCode): FsErrorPresentation {
  switch (code) {
    // 一時的な事情で失敗した可能性がある。読み直すと結果が変わりうる
    case "io":
    case "unknown":
      return { tier: "warning", showMessage: false };

    // ほかで移動・削除された。読み直せばツリーが現在の状態に追いつく
    case "not_found":
      return { tier: "warning", showMessage: false };

    // 何度読み直しても同じ結果になる。権限を変えるしかない
    case "permission_denied":
      return { tier: "danger", showMessage: false };

    // 利用者の入力が原因。直し方は入力を変えることだけ
    case "already_exists":
    case "invalid_name":
    case "invalid_path":
    case "invalid_type":
    case "invalid_extension":
    case "invalid_destination":
      return { tier: "danger", showMessage: true };
  }
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
