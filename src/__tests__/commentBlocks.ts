/**
 * ソースを、行頭で始まるコメントの塊へ切り分ける。
 *
 * **行の先頭から始まるものだけを読む。** 文字列の中の `//`（URL など）をコメントと
 * 取り違えないため。行末コメントは読まないので、塊の形を問う検査にだけ使う。
 *
 * 語を探すだけの走査は `commentHistory.test.ts` の `SLASH_COMMENT` を使う。あちらは
 * 行末も拾う代わりに文字列の中も拾い、人が結果を見て直す前提で書かれている。
 */

/** 1つの塊。`text` は印（`///` や `*`）を落とした本文 */
export interface CommentBlock {
  /** 1始まりの行番号 */
  line: number;
  /** 呼び手が読む説明か。`/**`、`///`、`//!` が真、`//` と `/*` が偽 */
  doc: boolean;
  text: string;
}

const LINE_MARKER = /^\s*(\/\/\/|\/\/!|\/\/)/;

/** 同じ印の `//` 行が続く範囲を1つの塊にする。印が変わったら別の塊 */
function lineBlockAt(lines: string[], start: number): { block: CommentBlock; next: number } {
  const marker = LINE_MARKER.exec(lines[start])?.[1] ?? "";
  const body: string[] = [];
  let at = start;
  while (at < lines.length && LINE_MARKER.exec(lines[at])?.[1] === marker) {
    body.push(lines[at].trim().slice(marker.length).trim());
    at += 1;
  }
  return {
    block: { line: start + 1, doc: marker !== "//", text: body.join("\n").trim() },
    next: at,
  };
}

/** `/*` で始まる行から `*\/` のある行までを1つの塊にする */
function starBlockAt(lines: string[], start: number): { block: CommentBlock; next: number } {
  let end = start;
  while (end < lines.length - 1 && !lines[end].includes("*/")) end += 1;

  const text = lines
    .slice(start, end + 1)
    .join("\n")
    .replace(/^\s*\/\*+/, "")
    .replace(/\*+\/[\s\S]*$/, "")
    .split("\n")
    .map((line) => line.trim().replace(/^\*\s?/, ""))
    .join("\n")
    .trim();

  return {
    block: { line: start + 1, doc: lines[start].trim().startsWith("/**"), text },
    next: end + 1,
  };
}

/** `source` の中の、行頭で始まるコメントの塊を上から順に返す */
export function commentBlocks(source: string): CommentBlock[] {
  const lines = source.split("\n");
  const blocks: CommentBlock[] = [];

  let at = 0;
  while (at < lines.length) {
    const head = lines[at].trim();
    if (!head.startsWith("//") && !head.startsWith("/*")) {
      at += 1;
      continue;
    }
    const { block, next } = head.startsWith("//")
      ? lineBlockAt(lines, at)
      : starBlockAt(lines, at);
    blocks.push(block);
    at = next;
  }
  return blocks;
}
