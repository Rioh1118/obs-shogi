import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import type { CursorPath } from "@/entities/kifu/model/cursor";
import { resolveLine } from "./resolveLine";

function shallowEqualStringArray(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * JKF comments は 1要素 = 1行。
 * 万一 1要素に改行が混ざっても、壊れた JKF を保存しないよう分解する。
 */
function normalizeCommentLines(comments: string[]): string[] {
  return comments.flatMap((line) =>
    String(line ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n"),
  );
}

/**
 * cursor が指す現在ノードを解決する。届かなければ `null`。
 *
 * `uptoTe` に `tesuu + 1` を渡すのは、`resolveLine` が `uptoTe` の分岐そのものは
 * 降りないため。`tesuu` を渡すと、いま入っている変化の1つ手前の線で止まる。
 *
 * `cursor.forkPointers` は `tesuu` より先の計画を含みうるが、`resolveLine` の中の
 * `normalizeForkPointers` が落とす。
 */
function getMoveByCursor(jkf: JKFData, cursor: CursorPath | null): JKFMove | null {
  if (!cursor) return null;

  try {
    const { line, startTe } = resolveLine(jkf, cursor.forkPointers, cursor.tesuu + 1);
    return line[cursor.tesuu - startTe] ?? null;
  } catch {
    // 実在しない変化を指すカーソル。書き込み側は { ok: false } になり、読み出し側は空。
    return null;
  }
}

export function getCommentsByCursor(jkf: JKFData, cursor: CursorPath | null): string[] {
  const move = getMoveByCursor(jkf, cursor);
  if (!move?.comments) return [];
  return normalizeCommentLines(move.comments);
}

export function setCommentsByCursorInJkf(
  jkf: JKFData,
  cursor: CursorPath,
  comments: string[],
): { ok: boolean; changed: boolean } {
  const move = getMoveByCursor(jkf, cursor);
  if (!move) return { ok: false, changed: false };

  const nextComments = normalizeCommentLines(comments);
  const prevComments = normalizeCommentLines(move.comments ?? []);

  if (shallowEqualStringArray(prevComments, nextComments)) {
    return { ok: true, changed: false };
  }

  if (nextComments.length === 0) {
    delete move.comments;
  } else {
    move.comments = nextComments;
  }

  return { ok: true, changed: true };
}
