import { isNameInputError, type FsError } from "@/entities/file-tree/api/error";
import { validateBasename } from "@/entities/file-tree/lib/validateBasename";
import type { AsyncResult } from "@/shared/lib/result";

export type CommitOutcome =
  /** 通った。編集行を閉じてよい */
  | { ok: true }
  /** 通らなかった。編集行は残す。`shown` があれば入力欄の下に出す */
  | { ok: false; shown?: FsError };

/**
 * インライン編集の確定。**`InlineNameEditor` を使う経路はすべてこれを通る。**
 *
 * 通す理由は2つ。
 *
 * 1. **手前の検証を1箇所に置く。** `validateBasename` は Rust と同じ4規則を持つが、
 *    呼ぶ場所が経路ごとに違うと、規則を足したとき経路によって挙動が変わる。
 *    モーダル側のファイル名欄はまだ通っていない → issue #224
 * 2. **入力欄に出す失敗を絞る。** 名前を直せば通る失敗だけを `shown` に載せる。
 *    それ以外は provider が振り分ける（`already_exists` は衝突の対話、残りは通知）。
 *    どちらも編集行を畳むので、ここでも出すと同じ失敗が2つの形で同時に出る
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
