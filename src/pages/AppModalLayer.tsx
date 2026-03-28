import { useFileTree } from "@/entities/file-tree";
import CreateFileModal from "@/features/create-file/ui/CreateFileModal";
import SfenKifuCreateModal from "@/features/create-file/ui/SfenKifuCreateModal";
import FileConflictDialog from "@/features/file-conflict/ui/FileConflictDialog";
import { KifuReadErrorDialog } from "@/features/kifu-read-error";
import PositionNavigationModal from "@/features/position-navigation/ui/PositionNavigationModal";
import PositionSearchModal from "@/features/position-search/ui/PositionSearchModal";
import SettingsModal from "@/features/settings/ui/SettingsModal";
import StudyPositionSaveModal from "@/features/study-position-save/ui/StudyPositionSaveModal";
import StudyPositionsManagerModal from "@/features/study-positions-manager/ui/StudyPositionsManagerModal";
import FileSearchModal from "@/widgets/file-search/FileSearchModal";

export default function AppModalLayer() {
  const {
    conflict,
    kifuError,
    closeConflict,
    resolveConflictByRename,
    clearKifuError,
    files,
    openFile,
  } = useFileTree();

  return (
    <>
      <CreateFileModal />
      <SfenKifuCreateModal />
      <PositionNavigationModal />
      <SettingsModal />
      <PositionSearchModal />
      <StudyPositionSaveModal />
      <StudyPositionsManagerModal />
      <FileSearchModal
        files={files ?? []}
        onClose={() => {}}
        onSelect={(file) => {
          openFile?.(file);
        }}
      />
      <FileConflictDialog
        conflict={conflict}
        onCancel={closeConflict}
        onSubmitRename={resolveConflictByRename}
      />
      <KifuReadErrorDialog error={kifuError} onDismiss={clearKifuError} />
    </>
  );
}
