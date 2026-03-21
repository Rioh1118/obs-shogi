import { useCallback, useMemo, useState } from "react";
import { JKFPlayer } from "json-kifu-format";
import type { Kind } from "shogi.js";

import PreviewPane from "@/entities/position/ui/PositionPreviewPane";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
import Button from "@/shared/ui/Form/Button";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { formatDate } from "@/shared/lib/date";
import type { StudyPosition } from "@/entities/study-positions/model/types";
import "./PositionDetail.scss";

const STATE_LABELS: Record<string, string> = {
  inbox: "未整理",
  active: "研究中",
  reference: "資料",
  done: "完了",
};

interface Props {
  position: StudyPosition | null;
  onSearch: (sfen: string) => void;
  onEdit: (sfen: string) => void;
  onCreateKifu: (sfen: string) => void;
  onDelete: (id: string) => Promise<void>;
}

export default function PositionDetail({
  position,
  onSearch,
  onEdit,
  onCreateKifu,
  onDelete,
}: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const toKan = useMemo(
    () => (k: string) => JKFPlayer.kindToKan(k as Kind) ?? k,
    [],
  );

  const previewData = useMemo(() => {
    if (!position) return null;
    return buildPreviewDataFromSfen(position.sfen);
  }, [position]);

  const turnLabel = previewData
    ? previewData.turn === 0
      ? "先手番"
      : "後手番"
    : null;

  const handleDelete = useCallback(async () => {
    if (!position || isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete(position.id);
      setConfirmDelete(false);
    } catch (e) {
      console.error("[PositionDetail] delete failed:", e);
    } finally {
      setIsDeleting(false);
    }
  }, [position, isDeleting, onDelete]);

  // Reset confirm state when position changes
  const posId = position?.id;
  const [prevPosId, setPrevPosId] = useState<string | undefined>(posId);
  if (posId !== prevPosId) {
    setPrevPosId(posId);
    setConfirmDelete(false);
  }

  if (!position) {
    return (
      <div className="sp-detail sp-detail--empty">
        <p className="sp-detail__emptyText">{"局面を選択してください"}</p>
      </div>
    );
  }

  const displayLabel = position.label || "（タイトルなし）";

  return (
    <div className="sp-detail">
      <div className="sp-detail__preview">
        <PreviewPane previewData={previewData} toKan={toKan} />
      </div>

      <div className="sp-detail__meta">
        <h3 className="sp-detail__label">{displayLabel}</h3>
        <div className="sp-detail__metaRow">
          <span className={`sp-detail__state sp-detail__state--${position.state}`}>
            {STATE_LABELS[position.state] ?? position.state}
          </span>
          {position.tags.map((tag) => (
            <span key={tag} className="sp-detail__tag">
              #{tag}
            </span>
          ))}
        </div>
        <div className="sp-detail__metaSub">
          {turnLabel && <span>{turnLabel}</span>}
          <span>{formatDate(position.updatedAt)} 更新</span>
        </div>
        {position.description && (
          <div className="sp-detail__memo">{position.description}</div>
        )}
      </div>

      <div className="sp-detail__actions">
        <div className="sp-detail__actionsLeft">
          <button
            type="button"
            className="sp-detail__deleteBtn"
            onClick={() => setConfirmDelete(true)}
          >
            {"削除"}
          </button>
        </div>
        <div className="sp-detail__actionsRight">
          <Button variant="ghost" onClick={() => onEdit(position.sfen)}>
            {"編集"}
          </Button>
          <Button variant="ghost" onClick={() => onCreateKifu(position.sfen)}>
            {"棋譜作成"}
          </Button>
          <Button variant="primary" onClick={() => onSearch(position.sfen)}>
            {"局面検索"}
          </Button>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`「${displayLabel}」を削除しますか？`}
          subtitle="この操作は取り消せません"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
          isLoading={isDeleting}
        />
      )}
    </div>
  );
}
