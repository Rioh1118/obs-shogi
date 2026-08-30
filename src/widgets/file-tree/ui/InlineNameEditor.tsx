import { useEffect, useRef, useState } from "react";
import { describeFsError, type CommitOutcome, type FsError } from "@/entities/file-tree";

import "./InlineNameEditor.scss";

/**
 * **描かれている＝編集中。** 呼び出し側は5経路とも `isRenaming` /
 * `showCreateRow` で分岐して unmount するので、「閉じている」という状態を
 * この component は持たない（状態遷移表の E0）
 */
type InlineRenameProps = {
  initialName: string;
  /**
   * 確定の結果。**成功と「失敗したがここには出さない」を型で分ける**（`CommitOutcome`）。
   * どちらも `undefined` にすると、送り直しを止める判断がこちらから消える。
   *
   * `shown` に載るのは名前を直せば通る失敗だけ。それ以外は provider が
   * 通知（`state.error`）か衝突の対話（`state.conflict`）へ振り分け、
   * reducer はどちらでも編集行を畳む。
   * 絞り込みは `entities/file-tree/lib/commitName` が持つ。
   */
  onCommit: (nextName: string) => Promise<CommitOutcome>;
  onCancel: () => void;
  /**
   * 欄が **unmount されたあと**に失敗が返ったときの行き先。
   *
   * 確定の最中に呼び出し側が編集行を畳むと（reducer の `case "error"` など）、
   * 返ってきた失敗を出す場所が無い。名前の失敗は provider が通知へ積まない
   * （出す責任がここだけにある）ので、ここで捨てると**どの出口にも出ない**。
   *
   * 欄が残っているなら閉じずにその場へ出すので、ここへは来ない。
   * 判定は `inputRef.current` の有無で、「欄の外へ出たか」は見ない
   */
  onUnshowable: (error: FsError) => void;
  className?: string;

  // "file" なら拡張子手前まで選択、"all" なら全文選択
  selectMode?: "file" | "all";
};

function InlineNameEditor({
  initialName,
  onCommit,
  onCancel,
  onUnshowable,
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
  }, [initialName, selectMode]);

  /**
   * 打った名前を確定する。Enter と blur の両方から来る。
   *
   * **失敗しても閉じない。** 閉じると打った文字列ごと消え、「直すための入力欄が、
   * 直せという知らせに巻き込まれて消える」形になる（`isNameInputError` の TSDoc）。
   *
   * **焦点も動かさない。** blur を起こしたのが「別の行をクリックした」なら、
   * 確定は click より前のマイクロタスクで返るので、`focus()` は利用者が移った先から
   * 焦点を奪い返す。押した行は開くのにキーボードはここに残り、この欄は `onKeyDown` を
   * 全て `stopPropagation()` するので Escape が他の受け口にも届かなくなる。
   *
   * 閉じるのは、欄そのものが無くなったとき（呼び出し側が畳んだ）だけ。
   */
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

      // 欄がもう無い（呼び出し側が畳んだ）。名前の失敗は provider が通知へ積まない
      // ので、ここで捨てるとどの出口にも出ない
      if (!outcome.ok && outcome.shown && !inputRef.current) {
        onUnshowable(outcome.shown);
        onCancel();
        return;
      }

      // 通らなかったなら、ここに出さない失敗でも送り直さない
      rejectedRef.current = outcome.ok ? null : next;
      setError(outcome.ok ? null : (outcome.shown ?? null));
    } finally {
      inFlightRef.current = false;
    }
  };

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

          // 送信中なら確定し直さない。`inFlightRef` が握り潰すだけ
          if (inFlightRef.current) return;

          // 落ちた名前のまま外へ出たら編集を閉じる。残すと、失敗の箱が
          // 行の上に出たまま閉じる手段が無くなる（Escape は入力欄にしか届かない）
          if (draft.trim() === rejectedRef.current) {
            onCancel();
            return;
          }

          void commit();
        }}
      />
      {/* 行を押し広げて全文を出す。理由は docs/state-transitions/inline-name-editor.md */}
      {/* **領域は常設する。** 中身と同時に DOM へ入れると、VoiceOver は
          live region の変化として読まない。焦点を戻さない形にした以上、
          キーボードだけの利用者へはここからしか伝わらない */}
      <span className="inline-name-editor__error" role="alert">
        {error ? describeFsError(error.code) : ""}
      </span>
    </span>
  );
}

export default InlineNameEditor;
