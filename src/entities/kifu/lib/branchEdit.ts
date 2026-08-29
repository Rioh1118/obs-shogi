import type { IMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { JKFData } from "@/entities/kifu/model/jkf";
import {
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
import { cloneJkf } from "./cloneJkf";

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
 * 中身は `readCandidates` が作った私有のコピーで、元の棋譜とは何も共有しない。
 * だから持ち替えるだけでよく、書き戻すときに複製し直さない。
 */
type Candidates = IMoveFormat[][];

/**
 * 分岐点を候補配列に正規化する
 * - candidates[0] = mainの tail（te から末尾まで）
 * - candidates[1..] = 兄弟候補（forks）
 * - さらに「候補の先頭が forks を持つ」場合は “同じteの代替” なので持ち上げてフラット化
 */
function readCandidates(h: BranchPointHandle): Candidates {
  const tail = cloneJkf(h.line.slice(h.index)); // 本譜側の tail
  if (tail.length === 0) throw new Error("main tail is empty");

  const head = tail[0];
  const forks = head.forks ?? [];
  delete head.forks;

  const candidates: Candidates = [tail, ...forks];

  // 同じteのforksを持ち上げ（固定点まで）
  let changed = true;
  while (changed) {
    changed = false;
    const extra: IMoveFormat[][] = [];
    for (const seg of candidates) {
      const segHead = seg[0];
      if (segHead?.forks?.length) {
        extra.push(...segHead.forks);
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
  if (main.length === 0) {
    h.line.splice(h.index);
    return;
  }

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
  const idx = target; // candidates は BranchIndex と同じ座標（0=本譜）
  if (idx < 0 || idx >= c.length) throw new Error("target out of range");
  const next = c.slice();
  next.splice(idx, 1);
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

/** deleteで “削除された枝の中にいた” ときの退避 */
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

/** 公開: swap */
export function swapBranchesInKifu(
  kifu: JKFData,
  q0: SwapQuery,
  cursor: KifuCursor | null,
): BranchEditResult {
  const q = normalizeRef(q0);
  const h = resolveBranchPoint(kifu, q);
  const candidates = readCandidates(h);

  if (q.a < 0 || q.b < 0 || q.a >= candidates.length || q.b >= candidates.length) {
    throw new Error("swap indices out of range");
  }
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

/** 公開: delete */
export function deleteBranchInKifu(
  kifu: JKFData,
  q0: DeleteQuery,
  cursor: KifuCursor | null,
): BranchEditResult {
  const q = normalizeRef(q0);
  const h = resolveBranchPoint(kifu, q);
  const candidatesBefore = readCandidates(h);

  if (q.target < 0 || q.target >= candidatesBefore.length) {
    throw new Error("delete target out of range");
  }

  const candidatesAfter = deleteCandidate(candidatesBefore, q.target);
  writeCandidates(h, candidatesAfter);

  if (!cursor) return { changed: true, nextCursor: null };

  // cursor が別streamなら何もしない
  if (!sameStreamPrefix(cursor.forkPointers, q.forkPointers, q.te)) {
    return { changed: true, nextCursor: cursor };
  }

  const chosen = getChosenBranchIndex(cursor.forkPointers, q.te);

  // “削除された枝の中にいて”、かつ te 以降にいるなら退避
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
