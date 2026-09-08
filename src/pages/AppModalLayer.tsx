import { useCallback } from "react";
import { useFileTree } from "@/entities/file-tree";
import { isRaisedFromModal } from "@/features/file-conflict/lib/isRaisedFromModal";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import CreateFileModal from "@/features/create-file/ui/CreateFileModal";
import SfenKifuCreateModal from "@/features/create-file/ui/SfenKifuCreateModal";
import FileConflictDialog from "@/features/file-conflict/ui/FileConflictDialog";
import { KifuReadErrorDialog } from "@/features/kifu-read-error";
import PositionNavigationModal from "@/features/position-navigation/ui/PositionNavigationModal";
import PositionSearchModal from "@/features/position-search/ui/PositionSearchModal";
import SettingsModal from "@/features/settings/ui/SettingsModal";
import StudyPositionSaveModal from "@/features/study-position-save/ui/StudyPositionSaveModal";
import StudyPositionsManagerModal from "@/features/study-positions-manager/ui/StudyPositionsManagerModal";

/**
 * この層を包む境界に渡す鍵。**この層が読む入力を全部並べる。**
 *
 * ここに置くのは、入力を読むのと同じ場所で数えるため。包む側（`AppLayout`）が数え直すと、
 * 入力が増えたときに黙って穴が開く —— **`modal` だけを見ていた間は、URL で開かない2枚
 * （`FileConflictDialog` / `KifuReadErrorDialog`）が鍵の外に居た。** その2枚が落ちると
 * 鍵は動かず、原因を消す口（`clearKifuError` / `closeConflict`）も畳まれた側に居るので、
 * **そのセッションではどのモーダルも二度と出ない。**
 */
export function useModalLayerResetKeys(): readonly unknown[] {
  const { conflict, kifuError } = useFileTree();
  const { params } = useURLParams();
  return [params.modal, conflict, kifuError];
}

export default function AppModalLayer() {
  const { conflict, kifuError, closeConflict, resolveConflictByRename, clearKifuError } =
    useFileTree();
  const { closeModal } = useURLParams();

  const fromModal = conflict ? isRaisedFromModal(conflict.request) : false; // 依存を真偽に落とす

  /**
   * 衝突を別名で解決したら、発端のモーダルも閉じる。
   *
   * 閉じないと、ファイルは作られたのに**入力がそのまま残ったフォーム**が下から
   * 出てくる。成功も失敗も出ていないので作られたことに気づけず、もう一度押すと
   * 同じ棋譜の2本目ができる。
   */
  const submitRename = useCallback(
    async (nextName: string) => {
      const res = await resolveConflictByRename(nextName);
      if (res.success && fromModal) closeModal();
      return res;
    },
    [fromModal, resolveConflictByRename, closeModal],
  );

  return (
    <>
      <CreateFileModal />
      <SfenKifuCreateModal />
      <PositionNavigationModal />
      <SettingsModal />
      <PositionSearchModal />
      <StudyPositionSaveModal />
      <StudyPositionsManagerModal />
      <FileConflictDialog
        conflict={conflict}
        onCancel={closeConflict}
        onSubmitRename={submitRename}
      />
      <KifuReadErrorDialog error={kifuError} onDismiss={clearKifuError} />
    </>
  );
}
