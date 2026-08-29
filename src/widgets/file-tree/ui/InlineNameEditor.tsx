import { useEffect, useRef, useState } from "react";
import { describeFsError, type FsError } from "@/entities/file-tree";
import "./InlineNameEditor.scss";

type InlineRenameProps = {
  isEditting: boolean;
  initialName: string;
  /**
   * 名前を直せば通る失敗（`invalid_name_*`）は、通知に積まずここへ返す。
   * 返された失敗は入力欄の下に出し、**打った文字列は残す**。
   * 通知に積むと reducer が編集行ごと畳み、直すための入力欄まで消える。
   */
  onCommit: (nextName: string) => void | Promise<FsError | void>;
  onCancel: () => void;
  className?: string;

  // "file" なら拡張子手前まで選択、"all" なら全文選択
  selectMode?: "file" | "all";
};

function InlineNameEditor({
  isEditting,
  initialName,
  onCommit,
  onCancel,
  className = "file-name__input",
  selectMode = "all",
}: InlineRenameProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelRef = useRef(false);
  const [draft, setDraft] = useState(initialName);
  const [error, setError] = useState<FsError | null>(null);

  useEffect(() => {
    if (!isEditting) return;

    setDraft(initialName);
    setError(null);

    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();

      if (selectMode === "file") {
        const dot = initialName.lastIndexOf(".");
        if (dot > 0) el.setSelectionRange(0, dot);
        else el.select();
      } else {
        el.select();
      }
    });
  }, [isEditting, initialName, selectMode]);

  const commit = async () => {
    const next = draft.trim();

    // 親側で renaming を終了させたいので、ここでは onCancel は呼ばない
    // （renameNode の中で refresh したりするので UI状態管理は親に寄せる）
    cancelRef.current = false;

    if (!next || next === initialName) {
      onCancel();
      return;
    }

    setError((await onCommit(next)) ?? null);
  };

  if (!isEditting) return null;

  return (
    <span className="inline-name-editor">
      <input
        ref={inputRef}
        className={className}
        value={draft}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            cancelRef.current = true;
            onCancel();
          }
        }}
        onBlur={() => {
          if (cancelRef.current) {
            cancelRef.current = false;
            return;
          }
          void commit();
        }}
      />
      {/* 行の高さを変えずに重ねる。ずらすと入力欄の位置が失敗のたびに動く */}
      {error && (
        <span className="inline-name-editor__error" role="alert">
          {describeFsError(error.code)}
        </span>
      )}
    </span>
  );
}

export default InlineNameEditor;
