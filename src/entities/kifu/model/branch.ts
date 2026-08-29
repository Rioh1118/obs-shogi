import type { ForkPointer, KifuCursor, TesuuPointer } from "./cursor";
import type { IMoveFormat } from "json-kifu-format/dist/src/Formats";

declare const branchIndexBrand: unique symbol;

/**
 * 分岐一覧の中での位置。0=本譜、1.. = `forks[BranchIndex - 1]`
 *
 * `forkIndex` と1ずれるので、素の number にすると取り違えても tsc が黙る。
 * ずれたまま削除・入れ替えに渡ると別の分岐が消える。このファイルの変換関数以外から
 * 作れないよう brand を付けてある。
 */
export type BranchIndex = number & { readonly [branchIndexBrand]: true };

/** 分岐一覧の先頭。本譜は `forks` の外にいるので `forkIndex` を持たない。 */
export const MAIN_LINE = 0 as BranchIndex;

/**
 * 手数 N から指せる分岐の候補。
 *
 * 本譜かどうかは `forkIndex` の有無だけで決まる。両方を別々のフィールドで持つと
 * 「本譜と表示しながら fork を進める」ような食い違った値が型として作れてしまう。
 */
export type BranchOption = {
  tesuu: number;
  /** 指し手のほか、投了・中断（`special`）も入る。棋譜ストリームの分岐一覧と集合を揃えるため。 */
  moveFormat: IMoveFormat;
} & (
  | { isMainLine: true; forkIndex?: never }
  /** `IMoveFormat.forks` の添字。ForkPointer の値ではない。 */
  | { isMainLine: false; forkIndex: number }
);

export type BranchPointRef = {
  /**
   * 規約: すべて p.te < te
   * (= te の分岐そのものは BranchIndex で指定する)
   */
  forkPointers: ForkPointer[];
  te: number;
};

export type SwapQuery = BranchPointRef & {
  a: BranchIndex;
  b: BranchIndex;
};

export type DeleteQuery = BranchPointRef & {
  target: BranchIndex;
};

export type BranchEditResult = {
  changed: boolean;
  nextCursor: KifuCursor | null;
};

/**
 * 分岐の表示名
 *
 * 番号は表示順ではなく `forkIndex` から作る。棋譜ストリームの分岐メニューが
 * `forkIndex` で番号を振るので、表示順で作ると同じ分岐が画面ごとに別の番号で呼ばれる。
 */
export function branchLabel(forkIndex?: number): string {
  return forkIndex == null ? "本譜" : `変化${branchIndexFromForkIndex(forkIndex)}`;
}

export function forkIndexFromBranchIndex(b: BranchIndex): number {
  if (b <= 0) throw new Error("branchIndex=0 has no forkIndex");
  return b - 1;
}

export function branchIndexFromForkIndex(forkIndex: number): BranchIndex {
  return (forkIndex + 1) as BranchIndex;
}

/**
 * 「本譜か、何番目の変化か」を BranchIndex にする
 *
 * 選択を表す `forkIndex` は本譜のとき null になる。この null を 0 に読み替える
 * 変換が画面ごとに手書きされると、`+1` の付け忘れが削除・入れ替えの対象を
 * 1つずらす形で表に出る。
 */
export function branchIndexFromSelection(forkIndex: number | null): BranchIndex {
  return forkIndex == null ? MAIN_LINE : branchIndexFromForkIndex(forkIndex);
}

/**
 * 一覧で1つ上/下に並ぶ分岐
 *
 * 一覧の端では範囲外の値を返す。呼び出し側が入れ替えの可否を先に判断している前提。
 */
export function neighborBranchIndex(b: BranchIndex, dir: "up" | "down"): BranchIndex {
  return (dir === "up" ? b - 1 : b + 1) as BranchIndex;
}

/** 手前の分岐が1つ消えて詰まったあとの位置。 */
export function shiftBranchIndexDown(b: BranchIndex): BranchIndex {
  return (b - 1) as BranchIndex;
}

export function buildTesuuPointer(tesuu: number, forkPointers: ForkPointer[]): TesuuPointer {
  // JKFPlayer の "N,[{te,forkIndex}]" と揃える
  return `${tesuu},${JSON.stringify(forkPointers)}` as TesuuPointer;
}
