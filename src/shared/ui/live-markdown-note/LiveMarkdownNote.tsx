import { useCallback, useMemo } from "react";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";

import { LIVE_MARKDOWN_TRANSFORMERS } from "./model/transformers";
import { liveMarkdownTheme } from "./model/theme";
import "./LiveMarkdownNote.scss";

type Props = {
  initialMarkdown?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  onMarkdownChange?: (markdown: string) => void;
  onSubmitShortcut?: () => void;
};

function Placeholder({ text }: { text: string }) {
  return <div className="live-md__placeholder">{text}</div>;
}

export default function LiveMarkdownNote({
  initialMarkdown = "",
  placeholder = "# 方針\n- 狙い\n- 候補手\n\n考察を書く...",
  autoFocus = true,
  className,
  onMarkdownChange,
  onSubmitShortcut,
}: Props) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        onSubmitShortcut?.();
      }
    },
    [onSubmitShortcut],
  );

  const initialConfig = useMemo(
    () => ({
      namespace: "ObsShogiLiveMarkdownNote",
      theme: liveMarkdownTheme,
      onError(error: Error) {
        console.error("[LiveMarkdownNote]", error);
      },
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode],
      editorState: () => {
        if (!initialMarkdown.trim()) return;
        $convertFromMarkdownString(
          initialMarkdown,
          LIVE_MARKDOWN_TRANSFORMERS,
          undefined,
          true,
        );
      },
    }),
    [initialMarkdown],
  );

  return (
    <div className={["live-md", className ?? ""].filter(Boolean).join(" ")}>
      <LexicalComposer initialConfig={initialConfig}>
        <div className="live-md__shell">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="live-md__editor"
                spellCheck={false}
                onKeyDown={handleKeyDown}
              />
            }
            placeholder={<Placeholder text={placeholder} />}
            ErrorBoundary={LexicalErrorBoundary}
          />

          <HistoryPlugin />
          <ListPlugin />
          <MarkdownShortcutPlugin transformers={LIVE_MARKDOWN_TRANSFORMERS} />
          {autoFocus ? <AutoFocusPlugin /> : null}

          <OnChangePlugin
            ignoreSelectionChange
            onChange={(editorState) => {
              editorState.read(() => {
                const markdown = $convertToMarkdownString(
                  LIVE_MARKDOWN_TRANSFORMERS,
                  undefined,
                  true,
                );
                onMarkdownChange?.(markdown);
              });
            }}
          />
        </div>
      </LexicalComposer>
    </div>
  );
}
