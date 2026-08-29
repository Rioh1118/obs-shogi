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
  /** 棋譜を書き換えたか。`false` なら渡した `kifu` は無傷。 */
  changed: boolean;
  /**
   * 編集後のカーソル。
   *
   * `null` になるのは `cursor` を渡さなかったときだけ。編集が別の stream で起きて
   * カーソルに影響しない場合は、渡した `cursor` がそのまま返る。
   */
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

/**
 * `IMoveFormat.forks` の添字に戻す
 *
 * 本譜は `forks` の外にいて添字を持たないので、`MAIN_LINE` を渡すと throw する。
 * 範囲外の値を黙って本譜に丸めないための境界。
 *
 * @throws {Error} `MAIN_LINE` 以下を渡したとき
 */
export function forkIndexFromBranchIndex(b: BranchIndex): number {
  if (b <= 0) throw new Error("branchIndex=0 has no forkIndex");
  return b - 1;
}

/** `IMoveFormat.forks` の添字を分岐一覧の位置にする。本譜が0を占めるぶん1ずれる。 */
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
 * 一覧の端では範囲外の値を返す。下限（`MAIN_LINE` 未満）は呼び出し側が捨て、
 * 上限は `swapBranchesInKifu` が "swap indices out of range" で弾く。
 * ここでは候補数を知らないので上限を見られない。
 */
export function neighborBranchIndex(b: BranchIndex, dir: "up" | "down"): BranchIndex {
  return (dir === "up" ? b - 1 : b + 1) as BranchIndex;
}

/**
 * 自分より前にある分岐が1つ削除されたあとの位置
 *
 * `MAIN_LINE` に対して呼ぶと範囲外の値を返す。その値を `setBranchIndex` に渡すと
 * `forkIndexFromBranchIndex` が throw するので、黙って本譜にはならない。
 */
export function branchIndexAfterRemoval(b: BranchIndex): BranchIndex {
  return (b - 1) as BranchIndex;
}

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
