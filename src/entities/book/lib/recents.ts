/**
 * 控えておく本数。**多くしない。** 空の画面に並ぶ一覧で、
 * 押し間違えて GB 級を開き直させる余地を増やすだけになる。
 */
const MAX_RECENT_BOOKS = 5;

/**
 * 最近開いた定跡の一覧に1件足す。**新しいものが先頭。**
 *
 * 同じパスが既に居れば先頭へ持ち上げる（重ねない）。設定ファイルは利用者も
 * 前の版も書くので、綴りが文字列でないものと空文字は落とす。
 *
 * **存在の検査はしない。** 消えたファイルを一覧から黙って外すと、
 * 外付けドライブを繋ぎ忘れた回に「そんな定跡は開いていない」ことになる。
 * 開けなかったことは開いたときに `not_found` として出る。
 */
export function rememberBook(
  recents: readonly unknown[] | null | undefined,
  path: string,
): string[] {
  const kept = (recents ?? []).filter(
    (value): value is string => typeof value === "string" && value.length > 0 && value !== path,
  );

  return [path, ...kept].slice(0, MAX_RECENT_BOOKS);
}

/** 設定に残っている一覧を、画面に出せる形へ濾す */
export function readRecentBooks(recents: readonly unknown[] | null | undefined): string[] {
  const seen = new Set<string>();

  return (recents ?? []).filter((value): value is string => {
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/** パスの末尾。一覧に出す見出し（区切りは OS で違うので両方見る） */
export function bookFileName(path: string): string {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at < 0 ? path : path.slice(at + 1);
}

/** パスの親。一覧で同じ名前のファイルを見分けるために添える */
export function bookParentPath(path: string): string {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at <= 0 ? "" : path.slice(0, at);
}
