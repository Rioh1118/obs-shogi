/**
 * 控えておく本数。**多くしない。** 空の画面に並ぶ一覧で、
 * 押し間違えて GB 級を開き直させる余地を増やすだけになる。
 */
export const MAX_RECENT_BOOKS = 5;

/**
 * 最近開いた定跡の一覧に1件足す。**新しいものが先頭。**
 *
 * 同じパスが既に居れば先頭へ持ち上げる（重ねない）。空の綴りは落とす。
 *
 * **文字列でない値は来ない。** 設定の欄は Rust 側が `Option<Vec<String>>` で、
 * `app.json` に別の型が入っていれば `serde` が設定ごと parse に失敗する
 * （`settings::app::read_or_default`）ので、ここまで届かない。
 *
 * **存在の検査はしない。** 消えたファイルを一覧から黙って外すと、
 * 外付けドライブを繋ぎ忘れた回に「そんな定跡は開いていない」ことになる。
 * 開けなかったことは開いたときに `not_found` として出る。
 */
export function rememberBook(
  recents: readonly string[] | null | undefined,
  path: string,
): string[] {
  const kept = (recents ?? []).filter((value) => value.length > 0 && value !== path);

  return [path, ...kept].slice(0, MAX_RECENT_BOOKS);
}

/**
 * 設定に残っている一覧を、画面に出せる形へ濾す。
 *
 * **上限は書く側だけでなく読む側にも掛ける。** 上限の理由は「空の画面に並ぶ数」
 * なので、書く側にしか掛けないと、前の版や手で書かれた 100 件がそのまま
 * 100 個のボタンとして並ぶ。
 *
 * **名前が取れない綴りは落とす。** `/books/` のように区切りで終わる綴りは
 * `bookFileName` が空を返すので、**名前の無いボタン**になる（押すと `InvalidType`）。
 */
export function readRecentBooks(recents: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();

  return (recents ?? [])
    .filter((value) => {
      if (bookFileName(value).length === 0 || seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, MAX_RECENT_BOOKS);
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
