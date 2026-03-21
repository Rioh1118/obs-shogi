import { useCallback, useEffect, useMemo, useState } from "react";
import { JKFPlayer } from "json-kifu-format";
import type { Kind } from "shogi.js";

import Modal from "@/shared/ui/Modal";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { usePositionSync } from "@/app/providers/bridges/position-sync";
import { useGame } from "@/entities/game";
import { useStudyPositions } from "@/entities/study-positions/model/useStudyPositions";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
import PreviewPane from "@/entities/position/ui/PositionPreviewPane";
import type { StudyPositionState } from "@/entities/study-positions/model/types";

import TextInput from "@/shared/ui/Form/TextInput";
import { TagsInput } from "@/shared/ui/Form/TagsInput";
import Textarea from "@/shared/ui/Form/Textarea";
import Button from "@/shared/ui/Form/Button";

import StudyPositionStateSegment from "./StudyPositionStateSegment";

import "./StudyPositionSaveModal.scss";

export default function StudyPositionSaveModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "study-position-save";

  const { currentSfen } = usePositionSync();
  const { state: gameState, getCurrentMoveIndex } = useGame();

  const { findBySfen, addPosition, updatePosition, deletePosition } =
    useStudyPositions();

  const sfen = currentSfen;
  const existing = useMemo(
    () => (isOpen ? findBySfen(sfen) : null),
    [isOpen, findBySfen, sfen],
  );
  const isEdit = !!existing;

  // --- form state ---
  const [label, setLabel] = useState("");
  const [spState, setSpState] = useState<StudyPositionState>("inbox");
  const [tags, setTags] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // reset form when modal opens or existing changes
  useEffect(() => {
    if (!isOpen) return;
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

  const toKan = useMemo(
    () => (k: string) => JKFPlayer.kindToKan(k as Kind) ?? k,
    [],
  );

  const previewData = useMemo(() => {
    if (!isOpen || !sfen) return null;
    return buildPreviewDataFromSfen(sfen);
  }, [isOpen, sfen]);

  // context info
  const tesuu = getCurrentMoveIndex();
  const turnLabel = previewData ? (previewData.turn === 0 ? "先手番" : "後手番") : null;
  const fileName = useMemo(() => {
    const absPath = gameState.loadedAbsPath;
    if (!absPath) return null;
    const parts = absPath.split("/");
    return parts[parts.length - 1] ?? null;
  }, [gameState.loadedAbsPath]);

  const handleSave = useCallback(async () => {
    if (!sfen || isSaving) return;
    setIsSaving(true);
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
    try {
      await deletePosition(existing.id);
      closeModal();
    } catch (e) {
      console.error("[StudyPositionSaveModal] delete failed:", e);
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
      theme="dark"
      variant="workspace"
      size="xl"
      chrome="card"
      padding="none"
      scroll="none"
      closeOnEsc
      closeOnOverlay
      showCloseButton
    >
      <div className="sp-save" onKeyDown={handleKeyDown}>
        <header className="sp-save__header">
          <h2 className="sp-save__title">
            {isEdit ? "課題局面を編集" : "課題局面に登録"}
          </h2>
          {isEdit && (
            <p className="sp-save__subtitle">
              {"この局面はすでに登録されています"}
            </p>
          )}
        </header>

        <div className="sp-save__body">
          <aside className="sp-save__left">
            <div className="sp-save__preview">
              <PreviewPane previewData={previewData} toKan={toKan} />
            </div>
            <div className="sp-save__context">
              {turnLabel && (
                <span className="sp-save__contextItem">{turnLabel}</span>
              )}
              <span className="sp-save__contextItem">
                {`${tesuu}手目`}
              </span>
              {fileName && (
                <span className="sp-save__contextItem sp-save__contextItem--file">
                  {fileName}
                </span>
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

        <footer className="sp-save__footer">
          <div className="sp-save__footerLeft">
            {isEdit && (
              <span className="sp-save__deleteWrap">
                <Button
                  variant="ghost"
                  onClick={handleDelete}
                  disabled={isSaving}
                >
                  {"削除"}
                </Button>
              </span>
            )}
          </div>
          <div className="sp-save__footerRight">
            <Button variant="ghost" onClick={closeModal} disabled={isSaving}>
              {"キャンセル"}
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!sfen || isSaving}
            >
              {saveLabel}
            </Button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
