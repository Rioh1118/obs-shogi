// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { createEditor } from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { LIVE_MARKDOWN_TRANSFORMERS } from "../model/transformers";

/**
 * コメント欄を開いて閉じたときに、棋譜に保存される文字列。
 *
 * `LiveMarkdownNote` は取り込み（`$convertFromMarkdownString`）と書き出し
 * （`$convertToMarkdownString`）を、どちらも改行を保つモード（最後の引数 `true`）で呼ぶ。
 * 書き出した文字列は `onMarkdownChange` を通って棋譜のコメントになるので、
 * **1往復で変わる文字列は、開いて閉じるたびに棋譜を書き換える。**
 * ノードの並びと引数は `LiveMarkdownNote.tsx` の `initialConfig` に揃えてある。
 */
function roundTrip(markdown: string): string {
  const editor = createEditor({
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => $convertFromMarkdownString(markdown, LIVE_MARKDOWN_TRANSFORMERS, undefined, true),
    { discrete: true },
  );
  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(LIVE_MARKDOWN_TRANSFORMERS, undefined, true));
}

describe("コメントの Markdown の往復", () => {
  test.each([
    ["指し手を並べた行", "☗７六歩\n☖３四歩"],
    ["段落の間の空行", "p1\n\np2"],
    ["行末の空白", "line  "],
    ["見出し", "# 見出し"],
    ["引用", "> 引用"],
    ["箇条", "- x\n- y"],
    ["番号つき箇条", "1. one\n2. two"],
    ["太字", "**太字**"],
    ["コード", "`code`"],
    ["書式でない記号", "a < b & c"],
  ])("%s は1往復で変わらない", (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  /**
   * lexical 0.41 は、改行を保つモードでも `\` を `\\` に書き出していた。
   * **コメント欄を開いて閉じただけで、利用者の書いた `\` が `\\` に書き換わった。**
   */
  test("`\\` は往復しても増えない", () => {
    expect(roundTrip("a\\b")).toBe("a\\b");
    expect(roundTrip(roundTrip("a\\b"))).toBe("a\\b");
  });

  /**
   * 書式にならない `*` `_` `~` は、書き出しでエスケープが付く。付いた後は
   * 何度往復しても変わらないので、棋譜が書き換わるのは最初の1回だけ。
   */
  test.each([
    ["*x*", "\\*x\\*"],
    ["~x~", "\\~x\\~"],
    ["a_b_c", "a\\_b\\_c"],
    ["__b__", "**b**"],
  ])("%s は1回目だけ %s に変わり、その後は変わらない", (markdown, settled) => {
    expect(roundTrip(markdown)).toBe(settled);
    expect(roundTrip(settled)).toBe(settled);
  });
});
