import { isNameInputError, validateBasename, type FsError } from "@/entities/file-tree";
import type { AsyncResult } from "@/shared/lib/result";

export type CommitOutcome =
  /** 通った。編集行を閉じてよい */
  | { ok: true }
  /** 通らなかった。編集行は残す。`shown` があれば入力欄の下に出す */
  | { ok: false; shown?: FsError };

/**
 * インライン編集の確定。**5つある入力欄がすべてこれを通る。**
 *
 * 通す理由は2つ。
 *
 * 1. **手前の検証を1箇所に置く。** `validateBasename` は Rust と同じ4規則を持つが、
 *    呼ぶ場所が経路ごとに違うと、規則を足したとき経路によって挙動が変わる
 * 2. **入力欄に返す失敗を絞る。** 名前を直せば通る失敗だけを返す。
 *    それ以外は provider が通知へ積み、reducer が編集行ごと畳むので、
 *    ここで返すと（畳むのをやめた瞬間に）同じ失敗が2つの形で同時に出る
 */
export async function commitName(
  raw: string,
  run: (name: string) => AsyncResult<void, FsError>,
): Promise<CommitOutcome> {
  const validated = validateBasename(raw);
  if (!validated.success) return { ok: false, shown: validated.error };

  const res = await run(validated.data);
  if (res.success) return { ok: true };

  return { ok: false, shown: isNameInputError(res.error.code) ? res.error : undefined };
}
