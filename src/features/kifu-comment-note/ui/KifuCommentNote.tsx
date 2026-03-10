import { useCallback, useEffect, useMemo, useState } from "react";
import { useGame } from "@/entities/game";
import type { KifuCursor } from "@/entities/kifu/model/cursor";
import { editorTextToLines, linesToEditorText } from "../lib/commentText";
import FloatingNote from "@/shared/ui/floating-note/FloatingNote";
import LiveMarkdownNote from "@/shared/ui/live-markdown-note/LiveMarkdownNote";
import "./KifuCommentNote.scss";

type Props = {
  open: boolean;
  cursor: KifuCursor | null;
  anchorEl: HTMLButtonElement | null;
  onClose: () => void;
};

function cursorToStableKey(cursor: KifuCursor | null) {
  if (!cursor) return "no-cursor";
  const path = (cursor.forkPointers ?? [])
    .map((p) => `${p.te}:${p.forkIndex}`)
    .join("|");

  return `${cursor.tesuu}__${path}`;
}

export default function KifuCommentNote({
  open,
  cursor,
  anchorEl,
  onClose,
}: Props) {
  const { state, getCommentsByCursor, setCommentsByCursor } = useGame();

  const [draft, setDraft] = useState("");
  const [baseText, setBaseText] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const sourceText = useMemo(() => {
    if (!cursor) return "";
    return linesToEditorText(getCommentsByCursor(cursor));
  }, [cursor, getCommentsByCursor]);

  useEffect(() => {
    if (!open) return;
    setDraft(sourceText);
    setBaseText(sourceText);
  }, [open, sourceText]);

  const dirty = draft !== baseText;

  const handleSave = useCallback(async () => {
    if (!cursor || isSaving) return;

    try {
      setIsSaving(true);
      await setCommentsByCursor(cursor, editorTextToLines(draft));
      setBaseText(draft);
    } finally {
      setIsSaving(false);
    }
  }, [cursor, draft, isSaving, setCommentsByCursor]);

  const handleRequestClose = useCallback(async () => {
    if (isSaving) return;

    if (dirty && cursor) {
      await handleSave();
    }

    onClose();
  }, [cursor, dirty, handleSave, isSaving, onClose]);

  const title = cursor ? `コメント · ${cursor.tesuu}手目` : "コメント";
  const editorKey = `${cursorToStableKey(cursor)}::${sourceText}`;

  return (
    <FloatingNote
      open={open}
      anchorEl={anchorEl}
      onClose={() => {
        void handleRequestClose();
      }}
      title={title}
      width={520}
      className="kifu-comment-note"
    >
      <div className="kifu-comment-note__root">
        <div className="kifu-comment-note__tips">
          <span className="kifu-comment-note__tip">
            <kbd>#</kbd>
            <span>Space</span>
            <em>見出し</em>
          </span>
          <span className="kifu-comment-note__tip">
            <kbd>-</kbd>
            <span>Space</span>
            <em>箇条書き</em>
          </span>
          <span className="kifu-comment-note__tip">
            <kbd>&gt;</kbd>
            <span>Space</span>
            <em>引用</em>
          </span>
          <span className="kifu-comment-note__tip">
            <kbd>⌘/Ctrl</kbd>
            <span>Enter</span>
            <em>保存</em>
          </span>
        </div>

        <LiveMarkdownNote
          key={editorKey}
          initialMarkdown={sourceText}
          onMarkdownChange={setDraft}
          onSubmitShortcut={() => {
            void handleSave();
          }}
        />

        <div className="kifu-comment-note__footer">
          <div className="kifu-comment-note__status">
            {state.isLoading || isSaving
              ? "保存中..."
              : dirty
                ? "未保存の変更あり"
                : "保存済み"}
          </div>

          <div className="kifu-comment-note__actions">
            <button
              type="button"
              className="kifu-comment-note__btn kifu-comment-note__btn--ghost"
              onClick={() => {
                void handleRequestClose();
              }}
              disabled={isSaving}
            >
              閉じる
            </button>

            <button
              type="button"
              className="kifu-comment-note__btn kifu-comment-note__btn--primary"
              onClick={() => {
                void handleSave();
              }}
              disabled={isSaving || !cursor}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </FloatingNote>
  );
}
