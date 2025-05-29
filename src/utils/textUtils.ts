/**
 * 改行コードを統一する（LF に統一）
 */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * BOMを除去する
 */
export function removeBOM(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

/**
 * テキストファイルの前処理
 */
export function preprocessText(text: string): string {
  return normalizeLineEndings(removeBOM(text.trim()));
}
