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
  // ワークスペースそのものを消そうとした。UI の判定に頼らず Rust が止める
  | "root_not_deletable"
  // 棋譜を保存する形へ直せなかった（Rust の正規化・直列化）
  | "kifu_conversion_failed"
  | "permission_denied"
  | "io"
  // 棋譜の読み込み。Rust は返さない。TS 側で作る
  | "kifu_format_unknown"
  | "kifu_parse_failed"
  // ディスク側の操作は通ったが、設定を書き戻せなかった。Rust は返さない。
  // **段のために他の code を借りない**ための1つ。借りると、利用者に見せる一文
  // （`describeFsError`）が原因を偽る
  | "config_write_failed"
  | "unknown";

// TODO(#202): この語彙はファイルツリーの失敗より広い（棋譜の読み込みと書き出しを含む）。
// 名前と置き場を中身に合わせるかどうかは、依存が生まれる前に決める
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

/**
 * `satisfies` で全ての code を並べさせる。`FsErrorCode` を増やすと型検査がここへ連れてくる。
 *
 * `src/__tests__/fsErrorCodes.test.ts` がこの並びを Rust の `FsErrorCode` と突き合わせる。
 */
export const FS_ERROR_CODES = {
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
  root_not_deletable: true,
  kifu_conversion_failed: true,
  permission_denied: true,
  io: true,
  kifu_format_unknown: true,
  kifu_parse_failed: true,
  config_write_failed: true,
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

  // Tauri の reject 値はプレーンオブジェクトなので、まとめて String() に落とすと
  // "[object Object]" になり、**どのファイルで何が起きたかまで消える**。
  // 分からないのが code だけなら、残りは拾い直す
  if (typeof e === "object" && e !== null) {
    return {
      code: "unknown",
      message: typeof e.message === "string" ? e.message : describeShape(e),
      path: typeof e.path === "string" ? e.path : undefined,
      existingPath: typeof e.existingPath === "string" ? e.existingPath : undefined,
      cause: typeof e.code === "string" ? `未知の code: ${e.code}` : undefined,
    };
  }

  return makeFsError("unknown", String(error));
}

/** 中身を1行のログに落とす。循環参照でも例外にしない */
function describeShape(value: object): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
    case "invalid_extension": // 拡張子も名前の一部。直すのは同じ入力欄
      return true;

    // ここから下は名前を直しても通らない。網羅にしてあるので、
    // code を増やすと型検査がここへ連れてくる
    case "already_exists":
    case "not_found":
    case "invalid_path":
    case "invalid_type":
    case "invalid_destination":
    case "root_not_deletable":
    case "kifu_conversion_failed":
    case "permission_denied":
    case "io":
    case "kifu_format_unknown":
    case "kifu_parse_failed":
    case "config_write_failed":
    case "unknown":
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
    case "root_not_deletable":
    case "kifu_conversion_failed":
    case "kifu_format_unknown":
    case "kifu_parse_failed":
    case "config_write_failed":
      return "danger";
  }
}

/**
 * ディスク側の変更は済んでいて、そのあとの処理だけが落ちた失敗か。
 *
 * 見出しを「ファイル操作に失敗しました」にすると、通っている操作まで失敗したと
 * 読める。**網羅にしてあるので、`FsErrorCode` を増やすと型検査がここへ連れてくる。**
 * 呼び出し側で `if (code === "...")` と書くと、次に足した code は黙って
 * 「失敗した」側へ落ちる。
 */
export function isOperationAlreadyCommitted(code: FsErrorCode): boolean {
  switch (code) {
    // ディスク上の改名は通り、`app.json` の書き戻しだけが落ちた
    case "config_write_failed":
      return true;

    case "already_exists":
    case "not_found":
    case "invalid_name_empty":
    case "invalid_name_reserved":
    case "invalid_name_separator":
    case "invalid_name_control":
    case "invalid_path":
    case "invalid_type":
    case "invalid_extension":
    case "invalid_destination":
    case "root_not_deletable":
    case "kifu_conversion_failed":
    case "permission_denied":
    case "io":
    case "kifu_format_unknown":
    case "kifu_parse_failed":
    case "unknown":
      return false;
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
    case "root_not_deletable":
      return "ワークスペースそのものは削除できません";
    case "kifu_conversion_failed":
      return "棋譜をこの形式に変換できませんでした";
    case "permission_denied":
      return "権限がありません";
    case "io":
      return "読み書きに失敗しました";
    case "kifu_format_unknown":
      return "対応していない棋譜の形式です";
    case "kifu_parse_failed":
      return "棋譜を解析できませんでした";
    case "config_write_failed":
      return "ディスク上の変更は済みましたが、アプリの設定に保存できませんでした";
    case "unknown":
      return "原因が分かりませんでした";
  }
}
