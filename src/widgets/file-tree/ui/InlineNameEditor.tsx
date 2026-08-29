import { useEffect, useRef, useState } from "react";
import { describeFsError, type FsError } from "@/entities/file-tree";
import "./InlineNameEditor.scss";

type InlineRenameProps = {
  isEditting: boolean;
  initialName: string;
  /**
   * 名前を直せば通る失敗（`invalid_name_*`）だけを返す。返された失敗は
   * 入力欄の下に出し、**打った文字列は残す**。
   *
   * それ以外の失敗は返さない。通知へ積まれ、その時点で reducer が
   * 編集行を畳む（`entities/file-tree/model/reducer.ts` の `error`）。
   * ここへも返すと、畳むのをやめた瞬間に同じ失敗が2つの形で同時に出る。
   * 絞り込みは `widgets/file-tree/lib/commitName` が持つ。
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
  // 送信中と、直前に落ちた名前。blur でも確定するので、この2つが無いと
  // 外をクリックするたびに同じ名前が送り直され、同じ失敗が出続けて閉じられない
  const inFlightRef = useRef(false);
  const rejectedRef = useRef<string | null>(null);
  const [draft, setDraft] = useState(initialName);
  const [error, setError] = useState<FsError | null>(null);

  useEffect(() => {
    if (!isEditting) return;

    setDraft(initialName);
    setError(null);
    rejectedRef.current = null;

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

    // Escape で立てた印を戻す。ここへ来たということは取り消しではない
    cancelRef.current = false;

    // 空欄と同名は送っても何も変わらない。編集を閉じるだけにする
    if (!next || next === initialName) {
      onCancel();
      return;
    }

    // 一度落ちた名前を blur のたびに送り直すと、同じ失敗が出続けて閉じられない
    if (inFlightRef.current || next === rejectedRef.current) return;

    inFlightRef.current = true;
    try {
      const failure = (await onCommit(next)) ?? null;
      rejectedRef.current = failure ? next : null;
      setError(failure);
    } finally {
      inFlightRef.current = false;
    }
  };

  if (!isEditting) return null;

  const cancel = () => {
    cancelRef.current = true;
    onCancel();
  };

  return (
    // Escape は span で拾う。input の上だけに置くと、失敗を出したあとに
    // フォーカスを外した利用者が閉じる手段を失う
    <span
      className="inline-name-editor"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        cancel();
      }}
    >
      <input
        ref={inputRef}
        className={className}
        value={draft}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
          rejectedRef.current = null;
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Escape は span 側で拾う。ここで止めると届かない
          if (e.key !== "Escape") e.stopPropagation();
          if (e.key === "Enter") void commit();
        }}
        onBlur={() => {
          if (cancelRef.current) {
            cancelRef.current = false;
            return;
          }
          void commit();
        }}
      />
      {/*
        行の高さを変えずに重ねる。ずらすと入力欄の位置が失敗のたびに動く。
        重ねる以上、下の行のクリックを奪わないよう pointer-events は切る（SCSS 側）
      */}
      {error && (
        <span className="inline-name-editor__error" role="alert">
          {describeFsError(error.code)}
        </span>
      )}
    </span>
  );
}

export default InlineNameEditor;
