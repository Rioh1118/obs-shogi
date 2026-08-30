import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
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
  const path = (cursor.forkPointers ?? []).map((p) => `${p.te}:${p.forkIndex}`).join("|");
  return `${cursor.tesuu}__${path}`;
}

export default function KifuCommentNote({ open, cursor, anchorEl, onClose }: Props) {
  const { getCommentsByCursor, setCommentsByCursor } = useGame();

  const [draft, setDraft] = useState("");
  const [baseText, setBaseText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const sourceText = useMemo(() => {
    if (!cursor) return "";
    return linesToEditorText(getCommentsByCursor(cursor));
  }, [cursor, getCommentsByCursor]);

  useEffect(() => {
    if (!open) return;
    setDraft(sourceText);
    setBaseText(sourceText);
    setSaveError(null);
  }, [open, sourceText]);

  const dirty = draft !== baseText;

  const stateRef = useRef({ cursor, draft, isSaving });
  useEffect(() => {
    stateRef.current = { cursor, draft, isSaving };
  });

  /**
   * 書けたときだけ `baseText` を進める。
   *
   * 失敗しても進めると `dirty` が落ちて、autosave も閉じるときの保存も
   * 二度と走らない。**画面には「保存済み」だけが出て、書いた本文はどこにも残らない。**
   *
   * @returns ディスクまで書けたか。書けていないなら呼び出し側はノートを閉じない
   */
  const doSave = useCallback(async () => {
    const { cursor, draft, isSaving } = stateRef.current;
    if (!cursor || isSaving) return false;

    setIsSaving(true);
    try {
      const res = await setCommentsByCursor(cursor, editorTextToLines(draft));
      if (!res.success) {
        setSaveError(res.error);
        return false;
      }

      setSaveError(null);
      setBaseText(draft);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
      return true;
    } finally {
      setIsSaving(false);
    }
  }, [setCommentsByCursor]);

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
  }, [draft]); // oxlint-disable-line react-hooks/exhaustive-deps

  const handleRequestClose = useCallback(async () => {
    if (isSaving) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    // 一度失敗を出したあとの close は、保存を諦めて閉じる。
    // ここで再試行し続けると、書き込めない場所に置いた棋譜ではノートを
    // 閉じる手段が1つも無くなる（失敗を伝えるより悪い行き止まり）。
    if (dirty && cursor && !saveError) {
      const saved = await doSave();
      if (!saved) return;
    }
    onClose();
  }, [cursor, dirty, doSave, isSaving, onClose, saveError]);

  const editorKey = cursorToStableKey(cursor);

  const moveLabel = cursor ? (cursor.tesuu === 0 ? "開始" : `${cursor.tesuu}手`) : "コメント";

  const title = (
    <div className="kifu-comment-note__titlebar">
      <span className="kifu-comment-note__pill kifu-comment-note__pill--label">
        <MessageSquareText size={12} strokeWidth={2.1} />
        <span>comment</span>
      </span>
      <span className="kifu-comment-note__pill kifu-comment-note__pill--meta">{moveLabel}</span>
    </div>
  );

  return (
    <FloatingNote
      open={open}
      anchorEl={anchorEl}
      onClose={() => void handleRequestClose()}
      title={title}
      width={400}
      className="kifu-comment-note"
    >
      <div className="kifu-comment-note__root">
        <LiveMarkdownNote
          key={editorKey}
          initialMarkdown={sourceText}
          placeholder="コメントを書く…  # 見出し / - リスト / > 引用"
          onMarkdownChange={setDraft}
          onSubmitShortcut={() => void handleRequestClose()}
        />
        {/* 領域は常設する（空でも DOM に置く）。中身と同時に入れると VoiceOver が
            live region の変化として読まない。面も宣言する。宣言しないと
            `contrastRatchet` が「面が決まらない」として測れない枠へ落とす */}
        <div className="kifu-comment-note__error" role="alert">
          {saveError && (
            <>
              <span className="kifu-comment-note__errorHead">
                保存できませんでした。書いた本文はこのまま残っています。
              </span>
              <span className="kifu-comment-note__errorCause">{saveError}</span>
              <span className="kifu-comment-note__errorHint">
                続けて書けば保存し直します。閉じると、この本文は失われます。
              </span>
            </>
          )}
        </div>
        {!saveError && (isSaving || savedFlash) && (
          <div className="kifu-comment-note__status">{isSaving ? "保存中" : "保存済み"}</div>
        )}
      </div>
    </FloatingNote>
  );
}
