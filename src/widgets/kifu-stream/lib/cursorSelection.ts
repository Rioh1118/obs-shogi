import {
  normalizeForkPointers,
  type ForkPointer,
  type KifuCursor,
  type PlannedCursor,
} from "@/entities/kifu/model/cursor";
import {
  branchIndexFromSelection,
  buildTesuuPointer,
  type BranchIndex,
} from "@/entities/kifu/model/branch";
import type { RowModel } from "../ui/KifuMoveCard";

export const branchIndexFromRow = (r: RowModel): BranchIndex => {
  return branchIndexFromSelection(r.selectedForkIndex);
};

/**
 * 分岐メニューで選ばれた項目を、局面を指すカーソルに変換する
 *
 * `te` 以降の計画は落とす。行を押した時点で、その先はもう一度選び直す対象になるため。
 * 戻り値は `te <= tesuu` に正規化済みで、そのまま `applyCursor` に渡してよい。
 *
 * ただし `te` より先の計画を消せるのはこの戻り値の中だけで、`state.branchPlan` に
 * 残っている分は `mergeBranchPlan` が復活させる。線を乗り換えても深い計画は残る。
 */
export function buildCursorWithForkSelection(
  base: PlannedCursor | null,
  te: number,
  forkIndex: number | null,
): KifuCursor {
  const prefix = (base?.forkPointers ?? []).filter((p) => p.te < te);
  const picked: ForkPointer[] = forkIndex == null ? prefix : [...prefix, { te, forkIndex }];
  // buildTesuuPointer は並びをそのまま文字列にする。正規化を通さないと、
  // 同じ局面が並び順の違いで別のキーになり、コメント欄の開閉判定が外れる。
  const forkPointers = normalizeForkPointers(picked, te);

  return { tesuu: te, forkPointers, tesuuPointer: buildTesuuPointer(te, forkPointers) };
}

/** 分岐メニューの選択に対して次に呼ぶ操作 */
export type ForkMenuAction =
  | { kind: "goToIndex"; te: number }
  | { kind: "applyCursor"; cursor: KifuCursor };

/**
 * 分岐メニューで選ばれた項目を、次に呼ぶ操作へ振り分ける
 *
 * 比較先は `PlannedCursor.forkPointers`（= `state.branchPlan`）から引く。
 * `state.cursor.forkPointers` は `cursorFromSource` が `te <= tesuu` に正規化して作るので
 * カーソルより先の選択を持たず、そちらと比べると先の行はどの項目も「選ばれていない」と
 * 読める。すると「本譜」を押したときだけ一致し、計画を積んだままの `goToIndex` へ落ちて
 * 本譜どころか変化が確定する。型で `KifuCursor` を弾いているのはそのため。
 *
 * 行のチェックは計画そのものではなく、`buildStreamRowsFromCursor` が**実際に降りた**
 * 分岐から出る。2つが食い違うのは計画が `forks` の範囲外だったときだけで、
 * そのとき行は「本譜」に ✓ を描き、ここは範囲外の値を読む。**その値はメニューの
 * 選択肢に無い**（選択肢も同じ `forks` から作られる）ので、どの項目を押しても
 * 一致せず `applyCursor` に落ちる。壊れた計画は押した時点で捨てられる。
 */
export function resolveForkSelection(
  planned: PlannedCursor,
  te: number,
  forkIndex: number | null,
): ForkMenuAction {
  const selected = planned.forkPointers.find((p) => p.te === te)?.forkIndex ?? null;
  if (selected === forkIndex) return { kind: "goToIndex", te };

  return { kind: "applyCursor", cursor: buildCursorWithForkSelection(planned, te, forkIndex) };
}
