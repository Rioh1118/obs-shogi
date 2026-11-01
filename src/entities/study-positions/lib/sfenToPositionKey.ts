/**
 * SFEN から比較用の局面キー（`"board side hand"`）を返す。4語に満たない SFEN は空文字を返す。
 *
 * 手数を落とす。課題局面は棋譜をまたいで同じ局面を1つに扱うので、手数が違っても同じ局面と読む。
 */
export function sfenToPositionKey(sfen: string): string {
  const tokens = sfen.trim().split(/\s+/);
  if (tokens.length < 4) return "";
  return `${tokens[0]} ${tokens[1]} ${tokens[2]}`;
}
