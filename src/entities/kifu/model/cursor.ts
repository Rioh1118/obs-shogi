/**
 * JKFの変化(forks)を選択するためのポインタ
 * - te: その手数で分岐を選ぶ(=代替手が存在する手数)
 * - forkIndex: 0始まり(forks配列のインデックス)
 */
export type ForkPointer = {
  te: number;
  forkIndex: number;
};

/**
 * JKFPlayer.getTesuuPointer()が返す「局面を一意に復元できる文字列」
 * 例: "7,[{\"te\":3,\"forkIndex\":0}]"
 *
 * 文字列のままでも良いが、方で明示するためにbranded typeにする。
 */
export type TesuuPointer = string & { readonly __brand: "TesuuPointer" };

/**
 * アプリ側で保持する「公式カーソル」
 * 現在局面を一意に表現し、UIの再描画やデバッグに使う。
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
export function normalizeForkPointers(
  forkPointers: ForkPointer[],
  tesuu?: number,
): ForkPointer[] {
  const filtered =
    typeof tesuu === "number"
      ? forkPointers.filter((fp) => fp.te <= tesuu)
      : [...forkPointers];

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
