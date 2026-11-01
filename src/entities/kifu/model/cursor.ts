/**
 * JKFの変化(forks)を選択するためのポインタ
 * - te: その手数で分岐を選ぶ(=代替手が存在する手数)
 * - forkIndex: 0始まり(forks配列のインデックス)
 */
export type ForkPointer = {
  te: number;
  forkIndex: number;
};

declare const tesuuPointerBrand: unique symbol;

/**
 * 再生器が返した、局面を指す `"<tesuu>,[{te,forkIndex}]"` 形式の文字列。
 * 例: `7,[{"te":3,"forkIndex":0}]`
 *
 * 書式が同じ値が2つある。再生器が返す観測値（`JKFPlayer.getTesuuPointer`）と、要求から組んだ鍵（`cursorKey`）。
 * **本番の経路で `KifuCursor.tesuuPointer` に入れてよいのは観測値だけ。**
 * 要求の鍵を入れると、着けもしない局面の識別子で停止判定やキャッシュが回る。
 *
 * 一意なのは1つの棋譜の中だけで、どの棋譜でも開始局面は `"0,[]"` になる。
 * 棋譜をまたいで鍵にするならファイル識別子と組む（`AnalysisPane` の `cacheKey`）。
 *
 * テストの fixture は `cursorKey` で埋めてよい。本番の停止判定に当たる読み手がテストの中に居ない。
 *
 * brand が止めるのは暗黙の代入だけで、`as TesuuPointer` は通る。
 * 作るのは `ROOT_CURSOR` と `makeKifuCursor` だけで、外に `as TesuuPointer` を書かない。
 */
export type TesuuPointer = string & { readonly [tesuuPointerBrand]: true };

declare const cursorKeyBrand: unique symbol;

/**
 * 要求から組んだ鍵。`TesuuPointer` と**書式は同じで型が違う**。
 *
 * 分けてあるのは、観測の欄（`KifuCursor.tesuuPointer`）に要求の鍵を入れる形を
 * 型で止めるため。同じ型にしていると `{ ...cursor, tesuuPointer: cursorKey(path) }`
 * がそのまま通り、着けもしない局面の識別子で停止判定が回る。
 *
 * 文字列としては使える（キャッシュ鍵や React の `key`）。
 * 観測値と突き合わせてよいのは `pointsAtSame` を通す場合だけ。
 */
export type CursorKey = string & { readonly [cursorKeyBrand]: true };

declare const kifuCursorBrand: unique symbol;

/**
 * 局面を指す文字列に整える。このファイルの中だけで使う。
 *
 * 正規化を掛けないので、外から呼ぶと並びの違いがそのまま別の鍵になる。外向きは `cursorKey`。
 *
 * 返すのは素の `string`。`TesuuPointer` を返すと、再生器を通していない値を `tesuuPointer` の欄に入れる経路が
 * このファイルの中に開く。`src/__tests__/cursorConstruction.test.ts` はこのファイルを持ち主として許すので止まらない。
 */
function formatPointer(tesuu: number, forkPointers: ForkPointer[]): string {
  // JKFPlayer の "N,[{te,forkIndex}]" と揃える
  return `${tesuu},${JSON.stringify(forkPointers)}`;
}

/**
 * 現在局面を一意に指すカーソルの欄。UI の再描画とデバッグに使う。
 *
 * `forkPointers` は `te <= tesuu` に正規化されている。`te > tesuu` を持たないのはこの型だけで、
 * `CursorPath`、`PlannedCursor`、`BranchPlan` は持ちうる。
 *
 * 作るのは `makeKifuCursor` と `ROOT_CURSOR` の2つ。brand で止まるのは素のオブジェクトリテラルだけで、
 * スプレッドと二重キャストは通る。要求の鍵が観測の欄に入る形は、`TesuuPointer` と `CursorKey` の型の違いが止める。
 * **`makeKifuCursor` の第3引数は素の `string`** なので、そこへ `cursorKey` の返りを渡す形は
 * `src/__tests__/cursorConstruction.test.ts` の「呼び出しの持ち主」の規則が止める。
 */
type KifuCursorFields = {
  /** 現在の手数(0=開始局面) */
  tesuu: number;

  /** 現在ルートを決める分岐選択履歴 */
  forkPointers: ForkPointer[];

  /** `JKFPlayer.getTesuuPointer()` が返した観測値。要求の鍵（`cursorKey`）を入れない */
  tesuuPointer: TesuuPointer;
};

export type KifuCursor = KifuCursorFields & { readonly [kifuCursorBrand]: true };

/**
 * 欄を揃えた組に印を付ける。`KifuCursor` はこの関数を通して作る。
 *
 * 引数を `KifuCursorFields` で受けるので、欄の型は tsc が突き合わせる。
 * 作る側に `as unknown as KifuCursor` を書くと、`tesuu` に文字列を入れても通る。
 */
const brandCursor = (fields: KifuCursorFields): KifuCursor => fields as KifuCursor;

/**
 * 盤を再生するのに要る最小の組。`KifuCursor` と `PlannedCursor` の共通部分。
 *
 * `goto` に渡すのに要るのは `tesuu` と `forkPointers` だけで、`te > tesuu` は
 * `normalizeForkPointers` が落とす。だから辿ったカーソルと計画カーソルのどちらも受けられる。
 *
 * **この型は `te > tesuu` を持ちうる**（`previewCursor` が実際に持つ）。落とすのは
 * `goto` に渡す手前の `normalizeForkPointers` であって、型ではない。
 * 局面が一致したかを確かめたい側は `KifuCursor` を自分で保持すること。この型には
 * `tesuuPointer` が無い。
 */
export type CursorPath = Pick<KifuCursor, "tesuu" | "forkPointers">;

declare const branchPlanBrand: unique symbol;

/**
 * 「これから降りるつもりの変化」の一覧。`state.branchPlan` の型。
 *
 * `te > cursor.tesuu` の `ForkPointer` を持ちうる点が `cursor.forkPointers` と違う。
 * 素の `ForkPointer[]` と取り違えると、カーソルより先の選択が黙って空になるので brand を付ける。
 * **この型を作ってよいのは `asBranchPlan` だけ**、というのは規約。
 */
export type BranchPlan = ForkPointer[] & { readonly [branchPlanBrand]: true };

/**
 * 分岐計画として確定した配列に印を付ける。
 *
 * 付けてよいのは**計画を作る側**だけ。`mergeBranchPlan`（`te > tesuu` を持ち越す唯一の
 * 関数）、初期状態の空配列、そして棋譜が変わって計画を意図的に捨てる書き込み経路。
 * 「捨てる」の印を呼び出し側に書かせているのは、捨てた場所を数えられるようにするため。
 * テストは実物と同じ組み立てを再現するために通す。
 */
export const asBranchPlan = (forkPointers: ForkPointer[]) => forkPointers as BranchPlan;

declare const plannedCursorBrand: unique symbol;

/**
 * 「これから降りるつもりの変化」まで載せたカーソル。
 *
 * `KifuCursor` と違い局面を一意に指さないので、`tesuuPointer` を持たない。
 *
 * brand が要るのは、両方とも `tesuu` と `ForkPointer[]` の組で構造が同じだから。
 * 無いと `state.cursor` がそのまま代入でき、**カーソルより先の選択が黙って空になる**。
 *
 * 通すのは `plannedCursorFrom` の返り値だけ。型が弾くのは `KifuCursor` からの代入で、
 * `as PlannedCursor` の綴りは `src/__tests__/cursorConstruction.test.ts` が見る。
 * `te > tesuu` を持つ素の `CursorPath`（`previewCursor`）を計画に使うなら、
 * `asBranchPlan` を通して `plannedCursorFrom` で組み直す。
 */
export type PlannedCursor = {
  tesuu: number;
  /** `te > tesuu` を持ちうる。brand はここまで通す（`planByTe` が `BranchPlan` を要求する）。 */
  forkPointers: BranchPlan;
  readonly [plannedCursorBrand]: true;
};

/**
 * 現在局面と分岐計画から `PlannedCursor` を組む。**この型を作ってよいのはここだけ**
 *
 * 第2引数が `BranchPlan` なのは、`cursor.forkPointers`（素の `ForkPointer[]`）を
 * 渡せてしまうと計画の抜けた値が brand 付きで通ってしまうため。
 */
export function plannedCursorFrom(
  cursor: KifuCursor | null,
  branchPlan: BranchPlan,
): PlannedCursor | null {
  if (!cursor) return null;
  const path: CursorPath = { tesuu: cursor.tesuu, forkPointers: branchPlan };
  return path as PlannedCursor;
}

/**
 * 開始局面のカーソル。「空の分岐履歴」を表す最小形。
 *
 * `tesuuPointer` だけは再生器を通さず手書きしている。書式が `cursorKey` の出力と
 * 一致することは `__tests__/cursor.test.ts` が固定している。
 */
export const ROOT_CURSOR = brandCursor({
  tesuu: 0,
  forkPointers: [],
  tesuuPointer: "0,[]" as TesuuPointer,
});

/**
 * forkPointers を正規化する。
 * - te昇順
 * - 同一teが重複する場合は最後のものを採用
 * - tesuu が指定されている場合、te <= tesuu のみ残す
 */
export function normalizeForkPointers(forkPointers: ForkPointer[], tesuu?: number): ForkPointer[] {
  const filtered =
    typeof tesuu === "number" ? forkPointers.filter((fp) => fp.te <= tesuu) : [...forkPointers];

  // `sort` は安定なので、同じ `te` の中では後に来たものが最後に残る
  const sorted = [...filtered].sort((a, b) => a.te - b.te);

  const unique: ForkPointer[] = [];
  for (const fp of sorted) {
    const idx = unique.findIndex((x) => x.te === fp.te);
    if (idx >= 0) unique[idx] = fp;
    else unique.push(fp);
  }
  return unique;
}

/**
 * `BranchPointRef` の規約「すべて `p.te < te`」を満たす形にする。並びも揃える。
 *
 * `normalizeForkPointers` の境界は `te <= 第2引数` なので1引く。この `- 1` を
 * 呼び出し側で手書きすると、書き忘れた側が `te` の分岐そのものを降りてしまい、
 * **選び直す対象の分岐点ではなく、そのうちの1本の中**を指す。例外は出ないまま
 * 削除・入れ替えが別の階層の枝に当たる。
 *
 * `truncateFrom` は絞るだけで並べ替えない。整列が要るならこちら。
 */
export function normalizeBefore(fps: ForkPointer[], te: number): ForkPointer[] {
  return normalizeForkPointers(fps, te - 1);
}

/** 同じ選択の並びか。`normalizeForkPointers` を通した値どうしで比べること。 */
export function sameForkPointers(a: ForkPointer[], b: ForkPointer[]) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.te === b[i]?.te && x.forkIndex === b[i]?.forkIndex);
}

/**
 * 辿ったカーソルと、カーソルより先の計画を合成する。
 *
 * `prevPlan` / `overridePlan` を `fp.te > cursor.tesuu` で絞るのは、
 * 「`branchPlan` の `te <= cursor.tesuu` の部分は `cursor.forkPointers` と一致する」
 * （`docs/state-transitions/game.md` の不変条件1）を、この関数を通る書き込み経路が
 * 守るため。他の経路は空にするか `cursor.forkPointers` をそのまま写して守っている。
 */
export function mergeBranchPlan(
  cursor: KifuCursor,
  prevPlan: ForkPointer[],
  overridePlan?: ForkPointer[],
): BranchPlan {
  return asBranchPlan(
    normalizeForkPointers([
      ...cursor.forkPointers,
      ...prevPlan.filter((fp) => fp.te > cursor.tesuu),
      ...(overridePlan ?? []).filter((fp) => fp.te > cursor.tesuu),
    ]),
  );
}

/**
 * `te` 以降の選択を落とす（`te` そのものも落とす）。
 *
 * 使う側は3つ。
 *
 * - 計画を書き換える側: `te` の選択を変えたら先の計画は別の枝の値になるので捨てる
 * - 分岐編集で退避する側: 消える枝より先の選択を落とす
 * - `BranchPointRef.forkPointers` を組む側（`buildStreamRows`）: `te` の分岐を選び直す prefix にする
 *
 * 並べ替えはしない。順序も揃えるなら `normalizeBefore`。
 * `normalizeForkPointers` は境界が `p.te <= te` になるので置き換えにならない。
 */
export function truncateFrom(fps: ForkPointer[], te: number): ForkPointer[] {
  return fps.filter((p) => p.te < te);
}

/**
 * te の選択を差し替える。`null` は「本譜を選ぶ」＝その te の選択を消す。
 * **計画に選択を書く関数はこれ1つ。**
 *
 * 本譜を `forkIndex` の無い状態で表すのは `ForkPointer` の作りに従ったもの。
 * `0` は「変化の0番目」であって本譜ではない。
 *
 * 返りは te 昇順。`mergeBranchPlan` や `normalizeForkPointers` と同じ並びで
 * 返さないと、比べる側（`sameForkPointers`）が並び順の違いだけで別の計画と判定する。
 */
export function selectAt(fps: ForkPointer[], te: number, forkIndex: number | null): ForkPointer[] {
  const without = fps.filter((p) => p.te !== te);
  if (forkIndex != null) without.push({ te, forkIndex });
  return without.sort((a, b) => a.te - b.te);
}

/**
 * `te` で選ばれている変化。無ければ `null`（＝本譜）。
 *
 * 計画（`BranchPlan`）にも辿ったカーソル（`cursor.forkPointers`）にも使う。
 * `0` は「変化の0番目」であって本譜ではないので、`?? null` の形を崩さないこと。
 */
export function forkIndexAt(fps: ForkPointer[], te: number): number | null {
  return fps.find((p) => p.te === te)?.forkIndex ?? null;
}

/**
 * 辿り終えた局面から `KifuCursor` を組む。実際の呼び手は `cursorFromPlayer`。
 *
 * `tesuuPointer` は再生器が返した文字列をそのまま使うので、渡す3つは**同じ局面を辿り終えた1つの再生器から**取る。
 * 別々に組むと、局面を一意に指すはずの値が中身と食い違う。
 *
 * `forkPointers` は `te <= tesuu` に正規化する。計画は `BranchPlan` が別に持つ。
 */
export function makeKifuCursor(
  tesuu: number,
  forkPointers: ForkPointer[],
  tesuuPointer: string,
): KifuCursor {
  return brandCursor({
    tesuu,
    forkPointers: normalizeForkPointers(forkPointers, tesuu),
    tesuuPointer: tesuuPointer as TesuuPointer,
  });
}

/**
 * `te` の選択を選び直して、そこへ移るカーソルを組む。
 *
 * `te` 以降の選択は落とす。その先は別の枝に対して作られた値で、残すと利用者が見ていない変化に盤が入る。
 * 落ちるのはこの戻り値の中だけで、`state.branchPlan` に残っている分は `mergeBranchPlan` が復活させる。
 *
 * `path` が `null` を取るのは、行を描く側が `PlannedCursor | null` を持つため（`KifuStreamList`）。
 * `view.player` の判定が先に返すので本番では通らないが、呼び手に `!` を書かせず「選択の履歴が無い」と決めてある。
 */
export function descendTo(
  path: CursorPath | null,
  te: number,
  forkIndex: number | null,
): CursorPath {
  if (!path) return { tesuu: te, forkPointers: selectAt([], te, forkIndex) };
  return { tesuu: te, forkPointers: selectAt(truncateFrom(path.forkPointers, te), te, forkIndex) };
}

/**
 * カーソルが指す局面を文字列の鍵にする。`CursorPath` の局面を比べる鍵はこれ1つ。
 *
 * 再生器を通していないので、その局面に着ける保証は無い。
 * `goto` は実在しない変化を黙って捨て、同じ `tesuu` の別の線に着く。
 * 着いた先の同一性が要るなら `state.cursor.tesuuPointer` を見る。
 *
 * 見るのは `te <= tesuu` の範囲だけで、カーソルより先の予定だけが違う2つの要求は同じ鍵になる。
 * `applyCursor` はその部分を `branchPlan` へ引き継ぐので、**要求の重複判定にこの鍵を使わない**。
 */
export function cursorKey(path: CursorPath): CursorKey {
  return formatPointer(
    path.tesuu,
    normalizeForkPointers(path.forkPointers, path.tesuu),
  ) as CursorKey;
}

/**
 * 観測値と要求の鍵が同じ局面を指しているか。**2つの鍵が出会ってよい唯一の場所。**
 *
 * 書式が同じなので文字列としては比べられるが、型を分けてあるぶん `===` が通らない。
 * 突き合わせたい側はここを通す（呼ぶのは `reachedCursor`）。
 */
export function pointsAtSame(observed: TesuuPointer, requested: CursorKey): boolean {
  return (observed as string) === (requested as string);
}
