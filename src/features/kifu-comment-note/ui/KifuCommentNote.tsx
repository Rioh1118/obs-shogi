import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const { getCommentsByCursor, setCommentsByCursor } = useGame();

  const [draft, setDraft] = useState("");
  const [baseText, setBaseText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const sourceText = useMemo(() => {
    if (!cursor) return "";
    return linesToEditorText(getCommentsByCursor(cursor));
  }, [cursor, getCommentsByCursor]);

  // Reset editor when cursor changes or note opens
  useEffect(() => {
    if (!open) return;
    setDraft(sourceText);
    setBaseText(sourceText);
  }, [open, sourceText]);

  const dirty = draft !== baseText;

  // Stable refs for auto-save closure
  const stateRef = useRef({ cursor, draft, isSaving });
  useEffect(() => {
    stateRef.current = { cursor, draft, isSaving };
  });

  const doSave = useCallback(async () => {
    const { cursor, draft, isSaving } = stateRef.current;
    if (!cursor || isSaving) return;
    setIsSaving(true);
    try {
      await setCommentsByCursor(cursor, editorTextToLines(draft));
      setBaseText(draft);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
    } finally {
      setIsSaving(false);
    }
  }, [setCommentsByCursor]);

  // Auto-save: 900ms debounce after last edit
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      return;
    }
    autoSaveTimerRef.current = setTimeout(() => void doSave(), 900);
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush on close
  const handleRequestClose = useCallback(async () => {
    if (isSaving) return;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (dirty && cursor) await doSave();
    onClose();
  }, [cursor, dirty, doSave, isSaving, onClose]);

  const editorKey = cursorToStableKey(cursor);

  const title = cursor
    ? cursor.tesuu === 0
      ? "コメント · 開始"
      : `コメント · ${cursor.tesuu}手目`
    : "コメント";

  const headerRight = (
    <div className="kifu-comment-note__hints">
      <span title="見出し: # スペース">#</span>
      <span title="リスト: - スペース">–</span>
      <span title="引用: &gt; スペース">&gt;</span>
      <span title="閉じる" className="kifu-comment-note__hint-close">⌘↵</span>
    </div>
  );

  return (
    <FloatingNote
      open={open}
      anchorEl={anchorEl}
      onClose={() => void handleRequestClose()}
      title={title}
      headerRight={headerRight}
      width={400}
      className="kifu-comment-note"
    >
      <div className="kifu-comment-note__root">
        <LiveMarkdownNote
          key={editorKey}
          initialMarkdown={sourceText}
          onMarkdownChange={setDraft}
          onSubmitShortcut={() => void handleRequestClose()}
        />
        {(isSaving || savedFlash) && (
          <div className="kifu-comment-note__status">
            {isSaving ? "保存中" : "保存済み"}
          </div>
        )}
      </div>
    </FloatingNote>
  );
}
