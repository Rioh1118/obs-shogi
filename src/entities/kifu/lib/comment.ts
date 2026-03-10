import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import {
  normalizeForkPointers,
  type KifuCursor,
} from "@/entities/kifu/model/cursor";

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
export function normalizeCommentLines(comments: string[]): string[] {
  return comments.flatMap((line) =>
    String(line ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n"),
  );
}

/**
 * cursor が指す現在ノードを解決する。
 *
 * 本譜なら:
 *   jkf.moves[tesuu]
 *
 * 分岐中なら:
 *   fork stream 側の該当 index
 *
 * 注意:
 * cursor.forkPointers には future plan が含まれうるので、
 * 現在 tesuu 以下だけを適用する。
 */
export function getMoveByCursor(
  jkf: JKFData,
  cursor: KifuCursor | null,
): JKFMove | null {
  if (!cursor) return null;

  let stream: JKFMove[] = jkf.moves;
  let streamStartTesuu = 0;

  const appliedForks = normalizeForkPointers(cursor.forkPointers, cursor.tesuu);

  for (const fp of appliedForks) {
    const localIndex = fp.te - streamStartTesuu;
    const baseMove = stream[localIndex];
    const forkStream = baseMove?.forks?.[fp.forkIndex];

    if (!baseMove || !forkStream) return null;

    stream = forkStream;
    streamStartTesuu = fp.te;
  }

  const localIndex = cursor.tesuu - streamStartTesuu;
  return stream[localIndex] ?? null;
}

export function getCommentsByCursor(
  jkf: JKFData,
  cursor: KifuCursor | null,
): string[] {
  const move = getMoveByCursor(jkf, cursor);
  if (!move?.comments) return [];
  return normalizeCommentLines(move.comments);
}

export function setCommentsByCursorInJkf(
  jkf: JKFData,
  cursor: KifuCursor,
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
