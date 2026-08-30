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

/**
 * 預ける。
 *
 * `generation` を渡した場合、掴んだときの値（`at`）と**いまの値**（`now()`）が違えば
 * 何もしない。鍵に入っている `forkIndex` は `forks` 配列の位置で、分岐の削除・入れ替えが
 * その配列を詰めたり入れ替えたりする。番号が動いたあとに、動く前の鍵で積み直すと、
 * **別の変化のノートに前の変化の下書きが出て、そこへ書き込まれる**。
 * 合わなければ**預けずに捨てる**。捨てると本文は失われるが、
 * 残すと利用者が打った覚えのない変化へ本文が入る。**失うほうを採る。**
 *
 * 世代の持ち主は `entities/kifu/lib/branchGeneration.ts`。番号を動かした側が進める。
 * 渡さないのは、番号を跨がないことがその場で分かる呼び出し（unmount の後始末）。
 */
export function putUnsavedDraft(
  key: string,
  value: UnsavedDraft,
  generation?: { at: number; now: () => number },
): void {
  if (generation && generation.at !== generation.now()) return;
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

/** 鍵から手数を読む。形は `${absPath}__${tesuu}__${forkPath}` */
function tesuuOf(key: string, prefix: string): number | null {
  const rest = key.slice(prefix.length);
  const tesuu = Number.parseInt(rest.slice(0, rest.indexOf("__")), 10);
  return Number.isFinite(tesuu) ? tesuu : null;
}

/**
 * 分岐の番号が振り直されたので、影響を受ける預かりを捨てる。
 *
 * **`fromTesuu` より前の手は落とさない。** そこの `forkIndex` は動かないので、
 * 落とすと「書いた本文はこのまま残っています」という断言が
 * **無関係な操作1回で破れる**。
 *
 * **番号を動かす書き込みが成功したあとに呼ぶこと。** 先に呼ぶと、
 * 失敗して棋譜が巻き戻ったときに預かりだけが戻らない。
 *
 * 番号そのものの世代は `entities/kifu/lib/branchGeneration.ts` が持ち、
 * **番号が動いた瞬間**に進む（成否を待たない）。この掃除とは時刻が違う。
 */
export function dropUnsavedDraftsFor(absPath: string | null, fromTesuu: number): void {
  const prefix = `${absPath ?? ""}__`;
  for (const key of Array.from(store.keys())) {
    if (!key.startsWith(prefix)) continue;
    const tesuu = tesuuOf(key, prefix);
    if (tesuu === null || tesuu >= fromTesuu) store.delete(key);
  }
}

/** テスト用。実行時に呼ぶ場所は無い */
export function clearUnsavedDrafts(): void {
  store.clear();
}
