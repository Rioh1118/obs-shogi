import { useEffect, useRef, useState } from "react";
import { describeFsError, type CommitOutcome, type FsError } from "@/entities/file-tree";

import "./InlineNameEditor.scss";

type InlineRenameProps = {
  isEditting: boolean;
  initialName: string;
  /**
   * 確定の結果。**成功と「失敗したがここには出さない」を型で分ける**（`CommitOutcome`）。
   * どちらも `undefined` にすると、送り直しを止める判断がこちらから消える。
   *
   * `shown` に載るのは名前を直せば通る失敗だけ。それ以外は provider が
   * 通知か衝突の対話へ振り分け、どちらも編集行を畳む。
   * 絞り込みは `entities/file-tree/lib/commitName` が持つ。
   */
  onCommit: (nextName: string) => Promise<CommitOutcome>;
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
      const outcome = await onCommit(next);
      // 通らなかったなら、ここに出さない失敗でも送り直さない
      rejectedRef.current = outcome.ok ? null : next;
      setError(outcome.ok ? null : (outcome.shown ?? null));
    } finally {
      inFlightRef.current = false;
    }
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
          rejectedRef.current = null;
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

          // 落ちた名前のまま外へ出たら編集を閉じる。残すと、失敗の箱が
          // 行の上に出たまま閉じる手段が無くなる（Escape は入力欄にしか届かない）
          if (draft.trim() === rejectedRef.current) {
            onCancel();
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
