import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Modal from "@/shared/ui/Modal";
import Button from "@/shared/ui/Button/Button";

import type { FileConflictDialogProps } from "../model/types";
import { describeFsError, type FsError } from "@/entities/file-tree";
import { getConflictCopy } from "../lib/getConflictCopy";
import { getConflictSessionKey } from "../lib/getConflictSessionKey";
import { getRequestedName } from "../lib/getRequestedName";
import ConflictMeta from "./ConflictMeta";

import "./FileConflictDialog.scss";

function getSelectionEnd(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

function FileConflictDialog({ conflict, onCancel, onSubmitRename }: FileConflictDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draftName, setDraftName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // 解決しようとして失敗したときの理由。ここで出さないと、このダイアログが
  // 開いている間の失敗は誰も出さない（reducer が state.error に積まない）
  const [submitError, setSubmitError] = useState<FsError | null>(null);

  // 初期化は対話が開いたとき1回だけ。conflict オブジェクトの同一性で回すと、
  // 別名でもう一度衝突したときに入力と失敗の理由がその場で消える
  const sessionKey = conflict ? getConflictSessionKey(conflict) : null;
  const requestedNameRef = useRef("");
  requestedNameRef.current = conflict ? getRequestedName(conflict) : "";

  useEffect(() => {
    if (!sessionKey) return;

    const requestedName = requestedNameRef.current;
    setDraftName(requestedName);
    setSubmitError(null);

    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(0, getSelectionEnd(requestedName));
    });
  }, [sessionKey]);

  if (!conflict) return null;

  const copy = getConflictCopy(conflict);
  const requestedName = getRequestedName(conflict);
  const trimmed = draftName.trim();

  // 名前として送れるか。**送信中かどうかは含めない。** `Button` は `isLoading` で
  // 自分を無効にするので、そこへ重ねると「送信中は押せない」が2箇所に分かれる
  const isNameSendable = trimmed.length > 0 && trimmed !== requestedName;

  const handleSubmit = async () => {
    if (!isNameSendable || isSubmitting) return;

    try {
      setIsSubmitting(true);
      setSubmitError(null);
      const res = await onSubmitRename(trimmed);
      if (!res.success) setSubmitError(res.error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      onClose={onCancel}
      label={copy.title}
      theme="dark"
      variant="dialog"
      size="sm"
      scroll="content"
      closeOnEsc={!isSubmitting}
      closeOnOverlay={!isSubmitting}
    >
      <form
        className="file-conflict"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <header className="file-conflict__header">
          <div className="file-conflict__iconWrap" aria-hidden="true">
            <AlertTriangle size={18} />
          </div>

          <div className="file-conflict__headingBlock">
            <h2 className="file-conflict__title">{copy.title}</h2>
            <p className="file-conflict__description">{copy.description}</p>
          </div>
        </header>

        <ConflictMeta conflict={conflict} />

        <section className="file-conflict__editor">
          <label className="file-conflict__editorLabel" htmlFor="file-conflict-name">
            新しい名前
          </label>

          <input
            id="file-conflict-name"
            ref={inputRef}
            className="file-conflict__input"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            // **`disabled` にしない。** 送信中はボタンも `isLoading` で押せなくなるので、
            // ここまで無効にするとカードの中に Tab で辿れる要素が0になり、
            // `Modal` の閉じ込めがカードの `div` へ落ちる。別名を何度も試す対話なので、
            // 失敗して戻ったときに欄へ戻れないのが一番困る
            readOnly={isSubmitting}
          />

          {submitError ? (
            <p className="file-conflict__error" role="alert">
              {describeFsError(submitError.code)}
            </p>
          ) : (
            <p className="file-conflict__hint">同じ場所で重複しない名前を入力してください。</p>
          )}
        </section>

        <div className="file-conflict__actions">
          <Button onClick={onCancel} disabled={isSubmitting}>
            {copy.cancelLabel}
          </Button>

          {/* 処理中は isLoading で示す（ADR-0005 決定1）。`Button` は isLoading で
              disabled も立てるので、ここで重ねて渡さない */}
          <Button type="submit" tone="primary" isLoading={isSubmitting} disabled={!isNameSendable}>
            {copy.renameLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default FileConflictDialog;
