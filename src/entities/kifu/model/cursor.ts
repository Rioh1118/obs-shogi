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
 * JKFPlayer.getTesuuPointer() が返す「局面を一意に復元できる文字列」
 * 例: `7,[{"te":3,"forkIndex":0}]`
 *
 * 素の文字列と取り違えないよう brand を付けてある。
 * brand が止めるのは暗黙の代入だけで、`as TesuuPointer` は通る。
 * **この型を作ってよいのはこのファイルの中だけ**、というのは規約。
 * 作っているのは3つ: `buildTesuuPointer`（組み立て）、`ROOT_CURSOR`（定数）、
 * `makeKifuCursor`（再生器の返り値に brand を付ける）。
 * 外に `as TesuuPointer` を書かないこと。
 */
export type TesuuPointer = string & { readonly [tesuuPointerBrand]: true };

/**
 * 局面を一意に表す文字列を組む。**このファイルの中だけで使う。**
 *
 * 正規化を掛けないので、外から呼ぶと並びの違いがそのまま別の鍵になる。
 * 外向きの口は `cursorKey`（正規化を通す）。
 */
function buildTesuuPointer(tesuu: number, forkPointers: ForkPointer[]): TesuuPointer {
  // JKFPlayer の "N,[{te,forkIndex}]" と揃える
  return `${tesuu},${JSON.stringify(forkPointers)}` as TesuuPointer;
}

/**
 * アプリ側で保持する「公式カーソル」
 * 現在局面を一意に表現し、UIの再描画やデバッグに使う。
 *
 * `forkPointers` は `te <= tesuu` に正規化されている（組む2つが必ず通す）。
 * **`te > tesuu` を持たないのはこの型だけ。** `CursorPath` / `PlannedCursor` /
 * `BranchPlan` はいずれも持ちうる。
 */
export interface KifuCursor {
  /** 現在の手数(0=開始局面) */
  tesuu: number;

  /** 現在ルートを決める分岐選択履歴 */
  forkPointers: ForkPointer[];

  /** JKFPlayer.getTesuuPonter()の結果(局面一意識別子) */
  tesuuPointer: TesuuPointer;
}

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
 * 「これから降りるつもりの変化」まで載せたカーソル
 *
 * `KifuCursor` との違いは、局面を一意に指さないので `tesuuPointer` を持たないこと。
 *
 * brand が要るのは、両方とも `tesuu` と `ForkPointer[]` の組で構造が同じだから。
 * brand が無いと `state.cursor` がそのまま代入できる。`KifuCursor` は
 * `te <= tesuu` に正規化されているので、**カーソルより先の選択が黙って空になる**。
 *
 * 素の `CursorPath`（`previewCursor` など）は `te > tesuu` を持ちうる。
 * brand が止めるのは `KifuCursor` を計画として渡すことだけ。
 */
export interface PlannedCursor {
  tesuu: number;
  /** `te > tesuu` を持ちうる。brand はここまで通す（`planByTe` が `BranchPlan` を要求する）。 */
  forkPointers: BranchPlan;
  readonly [plannedCursorBrand]: true;
}

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
 * 開始局面のカーソル。
 * ここでは「空の分岐履歴」を表す最小形として定義する。
 */
export const ROOT_CURSOR: KifuCursor = {
  tesuu: 0,
  forkPointers: [],
  tesuuPointer: "0,[]" as TesuuPointer,
};

/**
 * forkPointers を正規化する。
 * - te昇順
 * - 同一teが重複する場合は最後のものを採用
 * - tesuu が指定されている場合、te <= tesuu のみ残す
 */
export function normalizeForkPointers(forkPointers: ForkPointer[], tesuu?: number): ForkPointer[] {
  const filtered =
    typeof tesuu === "number" ? forkPointers.filter((fp) => fp.te <= tesuu) : [...forkPointers];

  // te昇順、同一teは後勝ち（reduceで最後を残す）
  const sorted = [...filtered].sort((a, b) => a.te - b.te);

  const unique: ForkPointer[] = [];
  for (const fp of sorted) {
    const idx = unique.findIndex((x) => x.te === fp.te);
    if (idx >= 0) unique[idx] = fp;
    else unique.push(fp);
  }
  return unique;
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
 * `te` 以降の選択を落とす（`te` そのものも落とす）
 *
 * 使う側は3つ。**計画を書き換える側**は、`te` の選択を変えたらその先の計画が
 * 別の枝に対して作られた値になるので捨てる（残すと利用者が一度も見ていない
 * 変化に盤が入る）。**分岐編集で退避する側**は、消える枝より先の選択を落とす。
 * **分岐点を指す `BranchPointRef.forkPointers` を組む側**（`buildStreamRows`）は、
 * `te` の分岐そのものを選び直すための prefix にする（規約「すべて `p.te < te`」）。
 *
 * 並べ替えはしない。順序も揃えたいなら `normalizeForkPointers` を使うこと。
 */
export function truncateFrom(fps: ForkPointer[], te: number): ForkPointer[] {
  return fps.filter((p) => p.te < te);
}

/**
 * te の選択を差し替える。`null` は「本譜を選ぶ」＝その te の選択を消す。
 * **計画に選択を書く口はこれ1つ。**
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
 * **辿り終えた**局面から `KifuCursor` を組む
 *
 * `tesuuPointer` は再生器が返した文字列をそのまま brand 付きにするので、
 * 渡す3つは**同じ局面を辿り終えた1つの再生器から**取ること。別々に組むと、
 * 局面を一意に指すはずの値が中身と食い違う。実際の口は `cursorFromPlayer`。
 *
 * `forkPointers` は `te <= tesuu` に正規化する。だから
 * **`state.cursor.forkPointers` はカーソルより先の選択を持たない**
 * （計画は `BranchPlan` が別に持つ）。
 */
export function makeKifuCursor(
  tesuu: number,
  forkPointers: ForkPointer[],
  tesuuPointer: string,
): KifuCursor {
  return {
    tesuu,
    forkPointers: normalizeForkPointers(forkPointers, tesuu),
    tesuuPointer: tesuuPointer as TesuuPointer,
  };
}

/**
 * `te` の選択を選び直して、そこへ移るカーソルを組む。
 *
 * `te` 以降の選択は落とす。`te` の選択を変えた以上、その先は別の枝に対して
 * 作られた値なので意味を失う（残すと利用者が一度も見ていない変化に盤が入る）。
 *
 * **ただし落ちるのはこの戻り値の中だけ。** `state.branchPlan` に残っている分は
 * `mergeBranchPlan` が復活させる（線を乗り換えても深い計画は残る → #306）。
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
 * カーソルを文字列の鍵にする。**`CursorPath` どうしを比べる鍵はこれ1つ。**
 *
 * 「着いた局面」どうしを比べるのは別で、そちらは `KifuCursor.tesuuPointer`
 * （`provider.tsx` の移動前後の比較、`AnalysisPane` のキャッシュ鍵）。
 * つまり鍵は2種類あり、**要求を比べるのがこれ**。
 *
 * `KifuCursor.tesuuPointer` と違い、これは**要求の鍵**でしかない。
 * 再生器を通していないので、その局面に本当に着ける保証は無い
 * （`goto` は実在しない変化を黙って捨て、同じ `tesuu` の別の線に着く）。
 * 「同じ鍵 = 同じ要求」であって「同じ局面」ではない。
 *
 * 着いた先の同一性が要る側は `state.cursor.tesuuPointer`（再生器が返した値）を見ること。
 */
export function cursorKey(path: CursorPath): TesuuPointer {
  return buildTesuuPointer(path.tesuu, normalizeForkPointers(path.forkPointers, path.tesuu));
}
