import { useCallback, useEffect, useMemo, useState } from "react";
import { turnText } from "@/shared/lib/turn";

import Modal from "@/shared/ui/Modal";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useGame } from "@/entities/game";
import { useStudyPositions } from "@/entities/study-positions/model/useStudyPositions";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
import PreviewPane from "@/entities/position/ui/PositionPreviewPane";
import type { StudyPositionState } from "@/entities/study-positions/model/types";

import TextInput from "@/shared/ui/Form/TextInput";
import { TagsInput } from "@/shared/ui/Form/TagsInput";
import Textarea from "@/shared/ui/Form/Textarea";
import Button from "@/shared/ui/Button/Button";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { getBaseName } from "@/shared/lib/path";

import StudyPositionStateSegment from "./StudyPositionStateSegment";

import "./StudyPositionSaveModal.scss";

export default function StudyPositionSaveModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "study-position-save";

  const { state: gameState, view: gameView, getCurrentMoveIndex } = useGame();
  const currentSfen = gameView.currentSfen;

  const { findBySfen, addPosition, updatePosition, deletePosition } = useStudyPositions();

  const [confirmDelete, setConfirmDelete] = useState(false);

  const sfen = params.sfen ?? currentSfen;
  const existing = useMemo(() => (isOpen ? findBySfen(sfen) : null), [isOpen, findBySfen, sfen]);
  const isEdit = !!existing;

  // --- form state ---
  const [label, setLabel] = useState("");
  const [spState, setSpState] = useState<StudyPositionState>("inbox");
  const [tags, setTags] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // reset form when modal opens or existing changes
  useEffect(() => {
    if (!isOpen) return;
    setConfirmDelete(false);
    setErrorMsg(null);
    if (existing) {
      setLabel(existing.label);
      setSpState(existing.state);
      setTags(existing.tags);
      setDescription(existing.description);
    } else {
      setLabel("");
      setSpState("inbox");
      setTags([]);
      setDescription("");
    }
  }, [isOpen, existing]);

  const previewData = useMemo(() => {
    if (!isOpen || !sfen) return null;
    return buildPreviewDataFromSfen(sfen);
  }, [isOpen, sfen]);

  // context info
  // params.sfen が明示されている場合（マネージャー等から開かれた場合）は
  // 現在対局の tesuu / fileName は別の棋譜のものになるため表示しない
  const isFromGameContext = !params.sfen;
  const tesuu = isFromGameContext ? getCurrentMoveIndex() : null;
  const turnBadge = previewData ? turnText(previewData.turn) : null;
  const fileName = useMemo(() => {
    if (!isFromGameContext) return null;
    const absPath = gameState.loadedAbsPath;
    if (!absPath) return null;
    return getBaseName(absPath);
  }, [isFromGameContext, gameState.loadedAbsPath]);

  const handleSave = useCallback(async () => {
    if (!sfen || isSaving) return;
    setIsSaving(true);
    setErrorMsg(null);
    try {
      if (existing) {
        await updatePosition({
          id: existing.id,
          label,
          state: spState,
          tags,
          description,
        });
      } else {
        await addPosition({
          sfen,
          label,
          state: spState,
          tags,
          description,
        });
      }
      closeModal();
    } catch (e) {
      console.error("[StudyPositionSaveModal] save failed:", e);
      setErrorMsg(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setIsSaving(false);
    }
  }, [
    sfen,
    isSaving,
    existing,
    label,
    spState,
    tags,
    description,
    addPosition,
    updatePosition,
    closeModal,
  ]);

  const handleDelete = useCallback(async () => {
    if (!existing || isSaving) return;
    setIsSaving(true);
    setErrorMsg(null);
    try {
      await deletePosition(existing.id);
      closeModal();
    } catch (e) {
      console.error("[StudyPositionSaveModal] delete failed:", e);
      setErrorMsg(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setIsSaving(false);
    }
  }, [existing, isSaving, deletePosition, closeModal]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  if (!isOpen) return null;

  const saveLabel = isSaving ? "保存中..." : isEdit ? "保存する" : "登録する";

  return (
    <Modal
      onClose={closeModal}
      label={isEdit ? "課題局面を編集" : "課題局面に登録"}
      theme="dark"
      variant="workspace"
      size="xl"
      chrome="card"
      scroll="none"
      closeOnEsc
      closeOnOverlay
      showCloseButton
    >
      <div className="sp-save" onKeyDown={handleKeyDown}>
        <header className="sp-save__header">
          <h2 className="sp-save__title">{isEdit ? "課題局面を編集" : "課題局面に登録"}</h2>
          {isEdit && <p className="sp-save__subtitle">{"この局面はすでに登録されています"}</p>}
        </header>

        <div className="sp-save__body">
          <aside className="sp-save__left">
            <div className="sp-save__preview">
              <PreviewPane previewData={previewData} />
            </div>
            <div className="sp-save__context">
              {turnBadge && <span className="sp-save__contextItem">{turnBadge}</span>}
              {tesuu !== null && <span className="sp-save__contextItem">{`${tesuu}手目`}</span>}
              {fileName && (
                <span className="sp-save__contextItem sp-save__contextItem--file">{fileName}</span>
              )}
            </div>
          </aside>

          <div className="sp-save__right">
            <div className="sp-save__field">
              <TextInput
                label="タイトル"
                id="sp-save-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="例: 角換わり腰掛銀の重要局面"
                disabled={isSaving}
              />
            </div>

            <div className="sp-save__field">
              <label className="sp-save__label">{"研究状態"}</label>
              <StudyPositionStateSegment
                value={spState}
                onChange={setSpState}
                disabled={isSaving}
              />
            </div>

            <div className="sp-save__field">
              <TagsInput
                label="タグ"
                id="sp-save-tags"
                tags={tags}
                onChange={setTags}
                placeholder="戦法や戦型を入力..."
                disabled={isSaving}
                variant="compact"
              />
            </div>

            <div className="sp-save__field">
              <Textarea
                label="メモ"
                id="sp-save-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="この局面についてのメモ..."
                rows={3}
                disabled={isSaving}
              />
            </div>
          </div>
        </div>

        {errorMsg && <div className="sp-save__error">{errorMsg}</div>}

        <footer className="sp-save__footer">
          <div className="sp-save__footerLeft">
            {isEdit && (
              <Button tone="danger" onClick={() => setConfirmDelete(true)} disabled={isSaving}>
                {"削除"}
              </Button>
            )}
          </div>
          <div className="sp-save__footerRight">
            <Button onClick={() => closeModal()} disabled={isSaving}>
              {"キャンセル"}
            </Button>
            <Button tone="primary" onClick={handleSave} disabled={!sfen || isSaving}>
              {saveLabel}
            </Button>
          </div>
        </footer>

        {confirmDelete && existing && (
          <ConfirmDialog
            title={`「${existing.label || "（タイトルなし）"}」を削除しますか？`}
            subtitle="この操作は取り消せません"
            onConfirm={handleDelete}
            onCancel={() => setConfirmDelete(false)}
            isLoading={isSaving}
          />
        )}
      </div>
    </Modal>
  );
}
