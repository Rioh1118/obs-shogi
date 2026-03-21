/**
 * SFEN から比較用の局面キー（"board side hand"）を生成する。
 *
 * 正式な SFEN は 4 トークン:
 *   "board side hand moveCount"
 *
 * 課題局面の同一性判定では moveCount は不要なので除去する。
 * 不正な SFEN は空文字を返す。
 */
export function sfenToPositionKey(sfen: string): string {
  const tokens = sfen.trim().split(/\s+/);
  if (tokens.length < 4) return "";
  return `${tokens[0]} ${tokens[1]} ${tokens[2]}`;
}
