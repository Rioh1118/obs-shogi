/** 控えておく本数。空の画面に並ぶ一覧なので、増やすと GB 級を押し間違えて開き直す余地が増える */
export const MAX_RECENT_BOOKS = 5;

/**
 * 最近開いた定跡の一覧に `path` を先頭で足して返す。
 *
 * 同じパスは重ねず先頭へ持ち上げ、空の綴りは落とす。
 *
 * 文字列でない値は来ない。設定の `book_recent_paths` は Rust で `Option<Vec<String>>` なので、
 * 別の型が入っていれば `serde` が設定ごと parse に失敗する（`settings::app::read_or_default`）。
 *
 * 存在は検査しない。消えたファイルを黙って外すと、外付けドライブを繋ぎ忘れただけで一覧から消える。
 * 開けなければ `not_found` が出る。
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
 * 上限は読む側でも掛ける。前の版や手で書かれた 100 件が、そのまま 100 個のボタンになるため。
 *
 * 名前が取れない綴りは落とす。`/books/` のような綴りは `bookFileName` が空を返し、
 * 名前の無いボタンになる。
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
