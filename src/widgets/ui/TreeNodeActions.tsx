import { FilePlus2, FolderPlus } from "lucide-react";
import IconButton from "../../shared/ui/IconButton";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { getParentPath } from "@/shared/lib/path";
import { useFileTree } from "@/entities/file-tree/model/useFileTree";

interface TreeNodeActionsProps {
  nodePath: string;
  isDirectory: boolean;
}

function TreeNodeActions({ nodePath, isDirectory }: TreeNodeActionsProps) {
  const { startCreateDirectory } = useFileTree();
  const { openModal } = useURLParams();

  const handleCreateFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetDir = isDirectory ? nodePath : getParentPath(nodePath);
    openModal("create-file", { dir: targetDir }, { replace: false });
  };

  const handleCreateDirectory = (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetDir = isDirectory ? nodePath : getParentPath(nodePath);
    startCreateDirectory(targetDir);
  };

  return (
    <div className="tree-node-actions">
      <IconButton
        handleClick={handleCreateFile}
        size="small"
        variant="ghost"
        title="新しいファイルを作成"
        ariaLabel="新しいファイルを作成"
      >
        <FilePlus2 size={14} />
      </IconButton>
      <IconButton
        handleClick={handleCreateDirectory}
        size="small"
        variant="ghost"
        title="新しいフォルダを作成"
        ariaLabel="新しいフォルダを作成"
      >
        <FolderPlus size={14} />
      </IconButton>
    </div>
  );
}

export default TreeNodeActions;
