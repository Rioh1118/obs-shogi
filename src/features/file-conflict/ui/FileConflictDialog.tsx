import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Modal from "@/shared/ui/Modal";

import type { FileConflictDialogProps } from "../model/types";
import { getConflictCopy } from "../lib/getConflictCopy";
import { getRequestedName } from "../lib/getRequestedName";
import ConflictMeta from "./ConflictMeta";

import "./FileConflictDialog.scss";

function getSelectionEnd(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

function FileConflictDialog({
  conflict,
  onCancel,
  onSubmitRename,
}: FileConflictDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draftName, setDraftName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!conflict) return;

    const requestedName = getRequestedName(conflict);
    setDraftName(requestedName);

    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(0, getSelectionEnd(requestedName));
    });
  }, [conflict]);

  if (!conflict) return null;

  const copy = getConflictCopy(conflict);
  const requestedName = getRequestedName(conflict);
  const trimmed = draftName.trim();

  const canSubmit =
    copy.canRename &&
    !isSubmitting &&
    trimmed.length > 0 &&
    trimmed !== requestedName;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    try {
      setIsSubmitting(true);
      await onSubmitRename(trimmed);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      onClose={onCancel}
      theme="light"
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

        {copy.canRename && (
          <section className="file-conflict__editor">
            <label
              className="file-conflict__editorLabel"
              htmlFor="file-conflict-name"
            >
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
              disabled={isSubmitting}
            />

            <p className="file-conflict__hint">
              同じ場所で重複しない名前を入力してください。
            </p>
          </section>
        )}

        <div className="file-conflict__actions">
          <button
            type="button"
            className="file-conflict__button file-conflict__button--ghost"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {copy.cancelLabel}
          </button>

          {copy.canRename && (
            <button
              type="submit"
              className="file-conflict__button file-conflict__button--primary"
              disabled={!canSubmit}
            >
              {copy.renameLabel}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

export default FileConflictDialog;
