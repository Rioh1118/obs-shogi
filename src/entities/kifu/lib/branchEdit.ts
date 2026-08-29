import type { IMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { JKFData } from "@/entities/kifu/model/jkf";
import {
  assertBranchIndex,
  branchIndexFromSelection,
  buildTesuuPointer,
  forkIndexFromBranchIndex,
  MAIN_LINE,
  branchIndexAfterRemoval,
  type BranchEditResult,
  type BranchIndex,
  type BranchPointRef,
  type DeleteQuery,
  type SwapQuery,
} from "../model/branch";
import { normalizeForkPointers, type ForkPointer, type KifuCursor } from "../model/cursor";
import { isUsableFork } from "./sanitizeJkf";

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

/** line + startTe を辿る（forkPointers は絶対手数で te を持っている） */
type LineRef = { line: IMoveFormat[]; startTe: number };
type BranchPointHandle = LineRef & { index: number; move: IMoveFormat };

function resolveLine(kifu: JKFData, forkPointers: ForkPointer[], uptoTe: number): LineRef {
  let line = kifu.moves as IMoveFormat[];
  let startTe = 0;

  const fps = normalizeForkPointers(forkPointers, uptoTe - 1).filter((p) => p.te < uptoTe);

  for (const p of fps) {
    const idx = p.te - startTe;
    const mv = line[idx];
    if (!mv || !mv.forks || !mv.forks[p.forkIndex]) {
      throw new Error(`resolveLine failed at te=${p.te} forkIndex=${p.forkIndex}`);
    }
    line = mv.forks[p.forkIndex];
    startTe = p.te;
  }

  return { line, startTe };
}

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
 * 分岐点にぶら下がる候補の並び。添字は `BranchIndex`（0=本譜）。
 *
 * 配列と各候補の先頭の手は `readCandidates` が作り直した私有のもの。
 * `writeCandidates` が書き換えるのは先頭の手の `forks` だけなので、
 * それより深い手は元の棋譜と共有したまま書き戻してよい。
 */
type Candidates = IMoveFormat[][];

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

/**
 * 分岐点を候補の並びにする
 *
 * - `candidates[0]` = 本譜の `te` 以降
 * - `candidates[1..]` = その手にぶら下がる変化
 * - 候補の先頭がさらに `forks` を持つ形は「同じ手数の別候補」なので、兄弟に持ち上げて平坦にする
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

  const candidates: Candidates = [tail, ...forks.map(privatizeHead)];

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

  return candidates;
}

/** candidates をJKFに書き戻す（te以降のtailを置換し、main headに forks を付与） */
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

  // forks は本譜側の先頭の手に集約
  if (forkSegs.length) main[0].forks = forkSegs;
  else delete main[0].forks;

  // te以降のtailを置換
  h.line.splice(h.index, h.line.length - h.index, ...main);
}

/** swap */
function swapInPlace<T>(arr: T[], i: number, j: number) {
  const t = arr[i];
  arr[i] = arr[j];
  arr[j] = t;
}

/** delete candidate */
function deleteCandidate(c: Candidates, target: BranchIndex): Candidates {
  // candidates は BranchIndex と同じ座標（0=本譜）。範囲は呼び出し側が確かめている。
  const next = c.slice();
  next.splice(target, 1);
  return next;
}

/** swap後の cursor patch（同一stream前提） */
function patchForkPointersForSwap(
  fps: ForkPointer[],
  te: number,
  a: BranchIndex,
  b: BranchIndex,
): ForkPointer[] {
  const chosen = getChosenBranchIndex(fps, te);

  const nextChosen = chosen === a ? b : chosen === b ? a : chosen;

  return setBranchIndex(fps, te, nextChosen);
}

/** delete後の cursor patch（同一stream前提、退避しないケース用） */
function patchForkPointersForDeleteNonReloc(
  fps: ForkPointer[],
  te: number,
  target: BranchIndex,
): ForkPointer[] {
  const chosen = getChosenBranchIndex(fps, te);

  // chosen==target の場合は “退避” で処理するので、ここでは来ない想定
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

/** 削除された候補の中に cursor がいたときの退避先 */
function relocateCursorOnDelete(
  cursor: KifuCursor,
  ref: BranchPointRef,
  target: BranchIndex,
  candidatesAfter: Candidates,
): KifuCursor {
  // 退避時は te 以降の pointer を落とす
  const kept = cursor.forkPointers.filter((p) => p.te < ref.te);

  if (target === MAIN_LINE) {
    if (candidatesAfter.length === 0) {
      const tesuu = Math.max(0, ref.te - 1);
      const fps = normalizeForkPointers(kept, tesuu);
      return {
        tesuu,
        forkPointers: fps,
        tesuuPointer: buildTesuuPointer(tesuu, fps),
      };
    }
    // 代替が本譜になった直後へ
    const tesuu = ref.te;
    const fps = normalizeForkPointers(kept, tesuu);
    return {
      tesuu,
      forkPointers: fps,
      tesuuPointer: buildTesuuPointer(tesuu, fps),
    };
  }

  // 変化を削除: 本譜の te 適用後へ
  const tesuu = ref.te;
  const fps = normalizeForkPointers(kept, tesuu);
  return {
    tesuu,
    forkPointers: fps,
    tesuuPointer: buildTesuuPointer(tesuu, fps),
  };
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
 * @throws {Error} `te` が1以上の手を指していないとき、`a` / `b` が候補の範囲外のとき、
 *   `forkPointers` が実在しない変化を指すとき
 */
export function swapBranchesInKifu(
  kifu: JKFData,
  q0: SwapQuery,
  cursor: KifuCursor | null,
): BranchEditResult {
  const q = normalizeRef(q0);
  const h = resolveBranchPoint(kifu, q);
  const candidates = readCandidates(h);

  assertBranchIndex(q.a, candidates.length);
  assertBranchIndex(q.b, candidates.length);
  if (q.a === q.b) return { changed: false, nextCursor: cursor };

  swapInPlace(candidates, q.a, q.b);
  writeCandidates(h, candidates);

  if (!cursor) return { changed: true, nextCursor: null };

  // cursor がこのstreamを辿っているなら te の pointer をpatch
  if (!sameStreamPrefix(cursor.forkPointers, q.forkPointers, q.te)) {
    return { changed: true, nextCursor: cursor };
  }

  const fps = patchForkPointersForSwap(cursor.forkPointers, q.te, q.a, q.b);
  const nextFps = normalizeForkPointers(fps);
  const next: KifuCursor = {
    tesuu: cursor.tesuu,
    forkPointers: nextFps,
    tesuuPointer: buildTesuuPointer(cursor.tesuu, nextFps),
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
 * @throws {Error} `te` が1以上の手を指していないとき、`target` が候補の範囲外のとき、
 *   `forkPointers` が実在しない変化を指すとき
 */
export function deleteBranchInKifu(
  kifu: JKFData,
  q0: DeleteQuery,
  cursor: KifuCursor | null,
): BranchEditResult {
  const q = normalizeRef(q0);
  const h = resolveBranchPoint(kifu, q);
  const candidatesBefore = readCandidates(h);

  assertBranchIndex(q.target, candidatesBefore.length);

  const candidatesAfter = deleteCandidate(candidatesBefore, q.target);
  writeCandidates(h, candidatesAfter);

  if (!cursor) return { changed: true, nextCursor: null };

  // cursor が別streamなら何もしない
  if (!sameStreamPrefix(cursor.forkPointers, q.forkPointers, q.te)) {
    return { changed: true, nextCursor: cursor };
  }

  const chosen = getChosenBranchIndex(cursor.forkPointers, q.te);

  // 削除された候補の中にいて、かつ te 以降にいるなら退避
  if (chosen === q.target) {
    if (cursor.tesuu >= q.te) {
      return {
        changed: true,
        nextCursor: relocateCursorOnDelete(cursor, q, q.target, candidatesAfter),
      };
    }

    // 予定していた選択が消えた
    const fps = setBranchIndex(cursor.forkPointers, q.te, MAIN_LINE);
    const nextFps = normalizeForkPointers(fps);
    return {
      changed: true,
      nextCursor: {
        tesuu: cursor.tesuu,
        forkPointers: nextFps,
        tesuuPointer: buildTesuuPointer(cursor.tesuu, nextFps),
      },
    };
  }

  // それ以外は pointer の詰めだけ
  const fps = patchForkPointersForDeleteNonReloc(cursor.forkPointers, q.te, q.target);
  const nextFps = normalizeForkPointers(fps);
  const next: KifuCursor = {
    tesuu: cursor.tesuu,
    forkPointers: nextFps,
    tesuuPointer: buildTesuuPointer(cursor.tesuu, nextFps),
  };
  return { changed: true, nextCursor: next };
}
