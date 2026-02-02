import { useEffect, useRef, useState } from "react";

type InlineRenameProps = {
  isEditting: boolean;
  initialName: string;
  onCommit: (nextName: string) => void | Promise<void>;
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

  useEffect(() => {
    if (!isEditting) return;

    setDraft(initialName);

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

    await onCommit(next);
  };

  if (!isEditting) return null;

  return (
    <input
      ref={inputRef}
      className={className}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
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
  );
}

export default InlineNameEditor;
