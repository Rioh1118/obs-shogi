import type { IMoveFormat } from "json-kifu-format/dist/src/Formats";
import { isUsableFork } from "@/entities/kifu/model/jkf";
import type { JKFData } from "@/entities/kifu/model/jkf";
import {
  branchIndexFromSelection,
  forkIndexFromBranchIndex,
  MAIN_LINE,
  branchIndexAfterRemoval,
  type BranchEditResult,
  type BranchIndex,
  type BranchPointRef,
  type DeleteQuery,
  type SwapQuery,
} from "../model/branch";
import { normalizeForkPointers, type CursorPath, type ForkPointer } from "../model/cursor";
import { resolveLine, type LineRef } from "./resolveLine";

/**
 * `BranchPointRef` の規約「すべて `p.te < te`」を満たす形にする
 *
 * `normalizeForkPointers` の境界は `te <= 第2引数` なので、1引いて渡す。
 */
function normalizeRef<T extends BranchPointRef>(ref: T): T {
  return {
    ...ref,
    forkPointers: normalizeForkPointers(ref.forkPointers, ref.te - 1),
  };
}

/** te より前の stream が同じか（forkPointers の prefix 同一判定） */
function sameStreamPrefix(a: ForkPointer[], b: ForkPointer[], te: number): boolean {
  const mapA = new Map<number, number>();
  for (const p of a) if (p.te < te) mapA.set(p.te, p.forkIndex);

  const mapB = new Map<number, number>();
  for (const p of b) if (p.te < te) mapB.set(p.te, p.forkIndex);

  if (mapA.size !== mapB.size) return false;
  for (const [k, v] of mapA) if (mapB.get(k) !== v) return false;
  return true;
}

function getChosenBranchIndex(forkPointers: ForkPointer[], te: number): BranchIndex {
  const p = forkPointers.find((x) => x.te === te);
  return branchIndexFromSelection(p ? p.forkIndex : null);
}

/** te の BranchIndex を forkPointers に反映（MAIN_LINE なら該当 te の pointer を削除） */
function setBranchIndex(
  forkPointers: ForkPointer[],
  te: number,
  branchIndex: BranchIndex,
): ForkPointer[] {
  const next = forkPointers.filter((p) => p.te !== te);
  if (branchIndex === MAIN_LINE) return next.sort((a, b) => a.te - b.te);

  next.push({ te, forkIndex: forkIndexFromBranchIndex(branchIndex) });
  return next.sort((a, b) => a.te - b.te);
}

type BranchPointHandle = LineRef & { index: number; move: IMoveFormat };

function resolveBranchPoint(kifu: JKFData, ref0: BranchPointRef): BranchPointHandle {
  // moves[0] は開始局面のエントリで指し手ではない。te=0 を通すと本譜の削除が
  // moves を空にする（`line[0]` が truthy なので「手が無い」判定に掛からない）。
  if (ref0.te < 1) throw new Error(`No move at te=${ref0.te}`);

  const ref = normalizeRef(ref0);
  const { line, startTe } = resolveLine(kifu, ref.forkPointers, ref.te);
  const index = ref.te - startTe;
  const move = line[index];
  if (!move) throw new Error(`No move at te=${ref.te} (startTe=${startTe})`);
  return { line, startTe, index, move };
}

/**
 * 先頭の手だけ複製した変化を作る
 *
 * 中身の無い変化は throw する。`{ ...undefined }` も `{ ...null }` も `{}` になるので、
 * 素通しすると指し手も `special` も持たない手を捏造して棋譜に書き戻すことになる。
 * `JKFData` は parse の出口で `sanitizeJkf` を通っているので、ここは手で組む経路への保険。
 */
function privatizeHead(fork: IMoveFormat[]): IMoveFormat[] {
  if (!isUsableFork(fork)) throw new Error("empty fork");
  return [{ ...fork[0] }, ...fork.slice(1)];
}

declare const candidatesBrand: unique symbol;

/**
 * 分岐点を候補の並びに読み出した結果と、そこから派生させたもの
 *
 * `forks`（本譜のぶん1少ない）や `BranchOption[]`（空の変化を読み飛ばすので候補数と
 * 一致しない）を同じ座標系として暗黙に渡せないようにしてある。
 * `as Candidates` は通るので、書いてよいのはこのファイルの中だけ、というのは規約。
 */
type Candidates = IMoveFormat[][] & { readonly [candidatesBrand]: true };

/**
 * 候補の実在する位置か確かめる
 *
 * 整数であることまで見る。`NaN` も小数も `< 0` と `>= 候補数` の両方を false にするので、
 * 大小比較だけの検査を素通りし、`Array.prototype.splice` が 0 方向へ丸めて
 * 頼んだのと違う候補を消す。
 *
 * @throws {Error} 整数でないとき
 * @throws {Error} `0 <= b < candidates.length` に入らないとき
 */
function assertBranchIndex(b: BranchIndex, candidates: Candidates): void {
  // 理由ごとに分ける。0.5 を「範囲外」と言うと、範囲の側を疑って時間を使うことになる。
  if (!Number.isInteger(b)) throw new Error(`branchIndex ${b} is not an integer`);
  if (b < MAIN_LINE || b >= candidates.length) {
    throw new Error(`branchIndex ${b} is out of range (0..${candidates.length - 1})`);
  }
}

/**
 * 分岐点を候補の並びにする
 *
 * - `candidates[0]` = 本譜の `te` 以降
 * - `candidates[1..]` = その手にぶら下がる変化
 * - 候補の先頭がさらに `forks` を持つ形は「同じ手数の別候補」なので、兄弟に持ち上げて平坦にする
 *
 * 配列と各候補の先頭の手はここで作り直した私有のもの。`writeCandidates` が書き換えるのは
 * 先頭の手の `forks` だけなので、それより深い手は元の棋譜と共有したまま書き戻してよい。
 */
function readCandidates(h: BranchPointHandle): Candidates {
  // 書き換えるのは各候補の先頭の手の forks だけなので、その手だけを複製する。
  // 深く複製すると、呼び出し側が既に作った複製ともう1枚ぶんの棋譜を余計にコピーすることになる。
  const tail = h.line.slice(h.index);
  if (tail.length === 0) throw new Error("main tail is empty");

  const head = { ...tail[0] };
  const forks = head.forks ?? [];
  delete head.forks;
  tail[0] = head;

  const candidates: IMoveFormat[][] = [tail, ...forks.map(privatizeHead)];

  // 同じteのforksを持ち上げ（固定点まで）
  let changed = true;
  while (changed) {
    changed = false;
    const extra: IMoveFormat[][] = [];
    for (const seg of candidates) {
      const segHead = seg[0];
      if (segHead.forks?.length) {
        extra.push(...segHead.forks.map(privatizeHead));
        delete segHead.forks;
        changed = true;
      }
    }
    if (extra.length) candidates.push(...extra);
  }

  return candidates as Candidates;
}

/** 候補の並びを棋譜に書き戻す（`te` 以降を置換し、本譜側の先頭の手に `forks` を集約） */
function writeCandidates(h: BranchPointHandle, candidates: Candidates): void {
  if (candidates.length === 0) {
    // te以降を全部消す
    h.line.splice(h.index);
    return;
  }

  const main = candidates[0];
  // 候補は tail か privatizeHead の返り値で、どちらも非空。空なら不変条件が壊れている。
  if (main.length === 0) throw new Error("candidate is empty");

  const forkSegs = candidates.slice(1);

  if (forkSegs.length) main[0].forks = forkSegs;
  else delete main[0].forks;

  h.line.splice(h.index, h.line.length - h.index, ...main);
}

function swapInPlace<T>(arr: T[], i: number, j: number) {
  const t = arr[i];
  arr[i] = arr[j];
  arr[j] = t;
}

function deleteCandidate(c: Candidates, target: BranchIndex): Candidates {
  // candidates は BranchIndex と同じ座標（0=本譜）。範囲は呼び出し側が確かめている。
  const next = c.slice() as IMoveFormat[][];
  next.splice(target, 1);
  // 元が Candidates なので、1つ減っても座標系は同じ。
  return next as Candidates;
}

/**
 * 削除後の cursor の patch（同じ stream を辿っている前提）
 *
 * `chosen === target`（消える候補の中にいる）ケースは退避で処理するので、ここには来ない。
 */
function patchForkPointersForDeleteNonReloc(
  fps: ForkPointer[],
  te: number,
  target: BranchIndex,
): ForkPointer[] {
  const chosen = getChosenBranchIndex(fps, te);

  if (target === MAIN_LINE) {
    // 本譜を削除: 変化1 が本譜に繰り上がる
    if (chosen === MAIN_LINE) return fps; // 本譜追従→新しい本譜へ
    // それ以外は1つ詰める（変化1 は本譜になる）
    return setBranchIndex(fps, te, branchIndexAfterRemoval(chosen));
  } else {
    // 変化を削除: target より後ろの変化は1つ詰める
    if (chosen === MAIN_LINE) return fps;
    if (chosen > target) return setBranchIndex(fps, te, branchIndexAfterRemoval(chosen));
    return fps;
  }
}

/**
 * 削除された候補の中に cursor がいたときの退避先
 *
 * 本譜を消したか変化を消したかで退避先は変わらない。変わるのは「候補が残っているか」だけ。
 */
function relocateCursorOnDelete(
  cursor: CursorPath,
  ref: BranchPointRef,
  candidatesAfter: Candidates,
): CursorPath {
  // 退避時は te 以降の pointer を落とす
  const kept = cursor.forkPointers.filter((p) => p.te < ref.te);
  // 候補が全部消えたら te の手前へ。残っていれば繰り上がった候補の te 適用後へ。
  const tesuu = candidatesAfter.length === 0 ? Math.max(0, ref.te - 1) : ref.te;
  return { tesuu, forkPointers: normalizeForkPointers(kept, tesuu) };
}

/**
 * 分岐点の候補2つを入れ替える
 *
 * `kifu` をその場で書き換える。呼び出し側は `cloneJkf` した複製を渡すこと。
 * React の state をそのまま渡すと、盤と棋譜ストリームが state 更新を経ずに食い違う。
 *
 * `cursor` が同じ stream を辿っているときだけ、選択が同じ候補を指し続けるよう patch した
 * カーソルを返す。別 stream なら `cursor` をそのまま返す。
 *
 * `te` にぶら下がる同じ手数の入れ子の変化は兄弟に平坦化される。触っていない変化でも
 * `te` の `forkIndex` の並びが変わり、その形でファイルに書き戻される。
 *
 * @throws {Error} `q.te` が1以上の手を指していないとき
 * @throws {Error} `q.a` / `q.b` が整数でないか、候補の範囲外のとき
 * @throws {Error} `q.forkPointers` が実在しない変化を指すとき
 * @throws {Error} `cursor.forkPointers` の `q.te` に対応する `forkIndex` が0以上の整数でないとき
 * @throws {Error} `forks` に中身の無い変化が混じるとき
 */
export function swapBranchesInKifu(
  kifu: JKFData,
  q0: SwapQuery,
  cursor: CursorPath | null,
): BranchEditResult {
  const q = normalizeRef(q0);
  const h = resolveBranchPoint(kifu, q);
  const candidates = readCandidates(h);

  assertBranchIndex(q.a, candidates);
  assertBranchIndex(q.b, candidates);
  if (q.a === q.b) return { changed: false, nextCursor: cursor };

  // cursor の検査は棋譜を書き換える前に済ませる。後ろに置くと、例外が出たのに
  // kifu だけ書き換わった状態が呼び出し側に残る。
  const chosen =
    cursor && sameStreamPrefix(cursor.forkPointers, q.forkPointers, q.te)
      ? getChosenBranchIndex(cursor.forkPointers, q.te)
      : null;

  swapInPlace(candidates, q.a, q.b);
  writeCandidates(h, candidates);

  if (!cursor) return { changed: true, nextCursor: null };
  if (chosen === null) return { changed: true, nextCursor: cursor };

  const fps = setBranchIndex(
    cursor.forkPointers,
    q.te,
    chosen === q.a ? q.b : chosen === q.b ? q.a : chosen,
  );
  const next: CursorPath = {
    tesuu: cursor.tesuu,
    forkPointers: normalizeForkPointers(fps),
  };
  return { changed: true, nextCursor: next };
}

/**
 * 分岐点の候補を1つ消す
 *
 * `kifu` をその場で書き換える。呼び出し側は `cloneJkf` した複製を渡すこと。
 * 本譜を消すと変化1が本譜に繰り上がり、`te` 以降の手ごと置き換わる。
 *
 * `te` にぶら下がる同じ手数の入れ子の変化は兄弟に平坦化される。触っていない変化でも
 * `te` の `forkIndex` の並びが変わり、その形でファイルに書き戻される。
 *
 * `cursor` が消える候補の中にいたときは、`te` の直後（消しきったなら `te - 1`）へ退避させた
 * カーソルを返す。
 *
 * @throws {Error} `q.te` が1以上の手を指していないとき
 * @throws {Error} `q.target` が整数でないか、候補の範囲外のとき
 * @throws {Error} `q.forkPointers` が実在しない変化を指すとき
 * @throws {Error} `cursor.forkPointers` の `q.te` に対応する `forkIndex` が0以上の整数でないとき
 * @throws {Error} `forks` に中身の無い変化が混じるとき
 */
export function deleteBranchInKifu(
  kifu: JKFData,
  q0: DeleteQuery,
  cursor: CursorPath | null,
): BranchEditResult {
  const q = normalizeRef(q0);
  const h = resolveBranchPoint(kifu, q);
  const candidatesBefore = readCandidates(h);

  assertBranchIndex(q.target, candidatesBefore);

  // cursor の検査は棋譜を書き換える前に済ませる。後ろに置くと、例外が出たのに
  // kifu だけ書き換わった状態が呼び出し側に残る。
  const chosen =
    cursor && sameStreamPrefix(cursor.forkPointers, q.forkPointers, q.te)
      ? getChosenBranchIndex(cursor.forkPointers, q.te)
      : null;

  const candidatesAfter = deleteCandidate(candidatesBefore, q.target);
  writeCandidates(h, candidatesAfter);

  if (!cursor) return { changed: true, nextCursor: null };
  if (chosen === null) return { changed: true, nextCursor: cursor };

  // 削除された候補の中にいて、かつ te 以降にいるなら退避
  if (chosen === q.target) {
    if (cursor.tesuu >= q.te) {
      return {
        changed: true,
        nextCursor: relocateCursorOnDelete(cursor, q, candidatesAfter),
      };
    }

    // 予定していた選択が消えた
    const fps = setBranchIndex(cursor.forkPointers, q.te, MAIN_LINE);
    return {
      changed: true,
      nextCursor: {
        tesuu: cursor.tesuu,
        forkPointers: normalizeForkPointers(fps),
      },
    };
  }

  // それ以外は pointer の詰めだけ
  const fps = patchForkPointersForDeleteNonReloc(cursor.forkPointers, q.te, q.target);
  const next: CursorPath = {
    tesuu: cursor.tesuu,
    forkPointers: normalizeForkPointers(fps),
  };
  return { changed: true, nextCursor: next };
}
