import type { KifuCursor } from "@/entities/kifu/model/cursor";

/**
 * まだディスクへ書けていない下書きの置き場。
 *
 * **コンポーネントの外に置く。** コメントノートは `KifuStreamList` の中にあり、
 * 棋譜を閉じると（ワークスペースの切り替え、開いているフォルダの削除）一覧ごと
 * unmount する。中に持つと、そこで下書きが黙って消える。
 */
export type UnsavedDraft = {
  draft: string;
  /** 書けなかった理由。次に同じ面を開いたときにそのまま出す */
  error: string;
  /** その失敗を画面で見せたか。**見せていない失敗を「1回目」と数えないため** */
  told: boolean;
};

/**
 * 預かりの鍵。「どのファイルの、どの手の、どの変化か」。
 *
 * **棋譜の識別子を混ぜる。** 手数と変化だけで作ると、別のファイルの同じ手数が
 * 同じ鍵になり、預かった下書きが別のファイルへ出る。
 *
 * **組む側と読む側を同じファイルに置く。** 形を2箇所が別々に知っていると、
 * 掃除する側が経路を読み違えて、番号の動いていない面まで落とす。
 */
export function unsavedDraftKey(cursor: KifuCursor, absPath: string | null): string {
  const path = (cursor.forkPointers ?? []).map((p) => `${p.te}:${p.forkIndex}`).join("|");
  return `${absPath ?? ""}__${cursor.tesuu}__${path}`;
}

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

/** 鍵を分解する。形は `${absPath}__${tesuu}__${te}:${forkIndex}|…` */
function parseKey(key: string, prefix: string): { tesuu: number; forkPath: string[] } | null {
  const rest = key.slice(prefix.length);
  const sep = rest.indexOf("__");
  if (sep < 0) return null;
  const tesuu = Number.parseInt(rest.slice(0, sep), 10);
  if (!Number.isFinite(tesuu)) return null;
  const path = rest.slice(sep + 2);
  return { tesuu, forkPath: path === "" ? [] : path.split("|") };
}

/**
 * 分岐の番号が振り直されたので、**その振り直しに当たる面**の預かりを捨てる。
 *
 * 鍵は `forkIndex`（`forks` 配列の位置）を含む。番号が動いたあとに残しておくと、
 * その鍵は**別の変化**を指し、預かった下書きがそこのノートに出て書き込まれる。
 *
 * **当たらない面は落とさない。** 落とすと「書いた本文はこのまま残っています」という
 * 断言が、**本文と何の関係も無い操作1回で**、しかも無通知に破れる。
 * 当たるのは2つだけ。
 *
 * - `te` の分岐点を**通っている**面（そこの番号が詰まる／入れ替わる）
 * - 本譜が動いた場合の、`te` 以降で**その分岐点を通っていない**面
 *   （本譜そのものが別の線に差し替わるため）
 *
 * **番号を動かす書き込みが成功したあとに呼ぶこと。** 先に呼ぶと、
 * 失敗して棋譜が巻き戻ったときに預かりだけが戻らない。
 *
 * **走っている書き込みが掴んでいる `cursor` の番号までは直せない** → #309
 */
export function dropUnsavedDraftsFor(
  absPath: string | null,
  te: number,
  mainLineMoved: boolean,
): void {
  const prefix = `${absPath ?? ""}__`;
  for (const key of Array.from(store.keys())) {
    if (!key.startsWith(prefix)) continue;
    const parsed = parseKey(key, prefix);
    if (!parsed) {
      store.delete(key);
      continue;
    }
    const passesThrough = parsed.forkPath.some((p) => p.startsWith(`${te}:`));
    if (passesThrough || (mainLineMoved && parsed.tesuu >= te)) store.delete(key);
  }
}

/** テスト用。実行時に呼ぶ場所は無い */
export function clearUnsavedDrafts(): void {
  store.clear();
}
