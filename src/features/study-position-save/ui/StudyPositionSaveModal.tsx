import { useCallback, useMemo, useState, type KeyboardEvent } from "react";

import Modal from "@/shared/ui/Modal";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useGame } from "@/entities/game";
import { useStudyPositions } from "@/entities/study-positions/model/useStudyPositions";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
import PositionPreviewPane from "@/entities/position/ui/PositionPreviewPane";
import type { StudyPosition, StudyPositionState } from "@/entities/study-positions/model/types";

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
  const [label, setLabel] = useState("");
  const [studyState, setStudyState] = useState<StudyPositionState>("inbox");
  const [tags, setTags] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** フォームを詰めたときの記録。保存中に一覧が先に差し替わっても、題と保存の宛先を動かさない */
  const [existing, setExisting] = useState<StudyPosition | null>(null);
  const [filledOpen, setFilledOpen] = useState(false);

  const sfen = params.sfen ?? currentSfen;
  // 描くたびに引く。`findBySfen` は一覧を ref から読むので同一性が動かず、
  // memo にすると開いた後に届いた一覧を拾わない
  const listed = isOpen ? findBySfen(sfen) : null;
  const isEdit = !!existing;
  const isPristine =
    label === "" && studyState === "inbox" && tags.length === 0 && description === "";

  const fillForm = (record: StudyPosition | null) => {
    setExisting(record);
    setIsSaving(false);
    setConfirmDelete(false);
    setErrorMsg(null);
    setLabel(record?.label ?? "");
    setStudyState(record?.state ?? "inbox");
    setTags(record?.tags ?? []);
    setDescription(record?.description ?? "");
  };

  // 開くたびにフォームを詰め直す。`AppModalLayer` が常にマウントしているので、詰め直さないと
  // 前回の入力が残る。開いた後に記録が変わったら、保存中を除いて詰め直す。
  // 記録が後から届いたときは、何も打っていない間だけ詰める。打った値を記録で上書きすると、
  // 読み直しで保存済みと分かった保存の失敗で、打った値が消える。
  //
  // 保存と削除が通ったときは `isSaving` を解かずに閉じ、開き直したときに `fillForm` が解く。
  // `closeModal` は router の transition を通るので、解くと閉じる前の描画でここが詰め直し、
  // 見出しが一瞬入れ替わる
  if (isOpen !== filledOpen) {
    setFilledOpen(isOpen);
    if (isOpen) fillForm(listed);
  } else if (
    isOpen &&
    !isSaving &&
    listed?.id !== existing?.id &&
    (existing !== null || isPristine)
  ) {
    fillForm(listed);
  }

  const previewData = useMemo(() => {
    if (!isOpen || !sfen) return null;
    return buildPreviewDataFromSfen(sfen);
  }, [isOpen, sfen]);

  // URL に `sfen` があるとき（課題局面の一覧から開いたとき）は、手数とファイル名を出さない。
  // 盤に載っている棋譜は、保存しようとしている局面とは別の棋譜なので
  const isFromGameContext = !params.sfen;
  const tesuu = isFromGameContext ? getCurrentMoveIndex() : null;
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
          state: studyState,
          tags,
          description,
        });
      } else {
        await addPosition({
          sfen,
          label,
          state: studyState,
          tags,
          description,
        });
      }
      closeModal();
    } catch (e) {
      console.error("[StudyPositionSaveModal] save failed:", e);
      setErrorMsg(e instanceof Error ? e.message : "保存に失敗しました");
      setIsSaving(false);
    }
  }, [
    sfen,
    isSaving,
    existing,
    label,
    studyState,
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
      setIsSaving(false);
    }
  }, [existing, isSaving, deletePosition, closeModal]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave],
  );

  if (!isOpen) return null;

  const saveLabel = isSaving ? "保存中…" : isEdit ? "保存する" : "保存";

  return (
    <Modal
      onClose={closeModal}
      label={isEdit ? "課題局面を編集" : "局面を保存"}
      variant="workspace"
      size="xl"
      scroll="none"
      closeOnEsc
      closeOnOverlay
      showCloseButton
    >
      <div className="sp-save" onKeyDown={handleKeyDown}>
        <header className="sp-save__header">
          <h2 className="sp-save__title">{isEdit ? "課題局面を編集" : "局面を保存"}</h2>
          {isEdit && <p className="sp-save__subtitle">{"この局面はすでに保存されています"}</p>}
        </header>

        <div className="sp-save__body">
          <aside className="sp-save__left">
            <div className="sp-save__preview">
              <PositionPreviewPane previewData={previewData} />
            </div>
            <div className="sp-save__context">
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
                value={studyState}
                onChange={setStudyState}
                disabled={isSaving}
              />
            </div>

            <div className="sp-save__field">
              <TagsInput
                label="タグ"
                id="sp-save-tags"
                tags={tags}
                onChange={setTags}
                placeholder="戦法や戦型を入力…"
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
                placeholder="この局面についてのメモ…"
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
