/**
 * まだディスクへ書けていない下書きの置き場。
 *
 * **コンポーネントの外に置く。** コメントノートは `KifuStreamList` の中にあり、
 * 棋譜を閉じると（ワークスペースの切り替え、開いているフォルダの削除）一覧ごと
 * unmount する。中に持つと、そこで下書きが黙って消える。
 *
 * 鍵は「どのファイルの、どの手の、どの変化か」。手数と変化だけで作ると、
 * 別のファイルの同じ手数が同じ鍵になり、預かった下書きが別のファイルへ出る。
 */
export type UnsavedDraft = {
  draft: string;
  /** 書けなかった理由。次に同じ面を開いたときにそのまま出す */
  error: string;
  /** その失敗を画面で見せたか。**見せていない失敗を「1回目」と数えないため** */
  told: boolean;
};

const store = new Map<string, UnsavedDraft>();

export function getUnsavedDraft(key: string): UnsavedDraft | undefined {
  return store.get(key);
}

export function putUnsavedDraft(key: string, value: UnsavedDraft): void {
  store.set(key, value);
}

export function dropUnsavedDraft(key: string): void {
  store.delete(key);
}

/**
 * 預かりが**そのとき置かれたものと同じなら**捨てる。
 *
 * 本文の一致で判定すると、続きを書いて保存に成功したときに一致せず、預かりが永久に残る。
 * 次にその面を開くと古い本文が出て、**保存済みの本文をディスク上で巻き戻す**。
 */
export function dropUnsavedDraftIfUnchanged(key: string, expected: UnsavedDraft | undefined): void {
  if (store.get(key) === expected) store.delete(key);
}

/** テスト用。実行時に呼ぶ場所は無い */
export function clearUnsavedDrafts(): void {
  store.clear();
}
