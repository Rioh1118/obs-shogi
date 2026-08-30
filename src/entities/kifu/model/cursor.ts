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
 * **この型を作ってよいのは `buildTesuuPointer` だけ**、というのは規約。
 * だからこのファイルの中に置いてある。外に `as TesuuPointer` を書かないこと。
 */
export type TesuuPointer = string & { readonly [tesuuPointerBrand]: true };

/**
 * 局面を一意に表す文字列を組む
 *
 * `forkPointers` は正規化してから渡すこと。並びが違うだけで別の文字列になり、
 * 同じ局面が別のキーとして扱われる。
 */
export function buildTesuuPointer(tesuu: number, forkPointers: ForkPointer[]): TesuuPointer {
  // JKFPlayer の "N,[{te,forkIndex}]" と揃える
  return `${tesuu},${JSON.stringify(forkPointers)}` as TesuuPointer;
}

/**
 * アプリ側で保持する「公式カーソル」
 * 現在局面を一意に表現し、UIの再描画やデバッグに使う。
 *
 * 注意:
 * - forkPointers は「現在局面までの分岐履歴」だけでなく、
 *   将来 forward するときに使う分岐計画も含みうる。
 * - 実際に current position を player に適用するときは
 *   normalizeForkPointers(cursor.forkPointers, cursor.tesuu) で計画を落としてから渡す。
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
 * `te > tesuu` の `ForkPointer` を持ちうるが、それは `KifuCursor` も同じ
 * （`PositionNavigationModal` が `tesuu` だけ戻したカーソルを作る）。
 *
 * brand が要るのは、両方とも `tesuu` と `ForkPointer[]` の組で構造が同じだから。
 * brand が無いと `state.cursor` がそのまま代入できる。`state.cursor.forkPointers` は
 * `cursorFromSource` が `te <= tesuu` に正規化して作るので、
 * **カーソルより先の選択が黙って空になる**。
 */
export interface PlannedCursor extends CursorPath {
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

/**
 * JKFPlayer から cursor を生成するための最小インタフェース。
 * （types 層が JKFPlayer クラスに直接依存しないための抽象）
 */
export interface CursorSource {
  tesuu: number;
  getForkPointers: (tesuu?: number) => ForkPointer[];
  getTesuuPointer: (tesuu?: number) => string;
}

/**
 * CursorSource から KifuCursor を生成する。
 * GameContext 側で「局面変更のたびに必ず同期」するために使う。
 */
export function cursorFromSource(source: CursorSource): KifuCursor {
  const tesuu = source.tesuu;
  const fps = normalizeForkPointers(source.getForkPointers(tesuu), tesuu);
  const ptr = source.getTesuuPointer(tesuu) as TesuuPointer;

  return {
    tesuu,
    forkPointers: fps,
    tesuuPointer: ptr,
  };
}
