import { FilePlus2, FolderPlus } from "lucide-react";
import IconButton from "@/shared/ui/IconButton";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { getParentPath } from "@/shared/lib/path";
import { useFileTree } from "@/entities/file-tree";
import type { MouseEvent } from "react";

type TreeNodeActionsProps = {
  nodePath: string;
  isDirectory: boolean;
};

function TreeNodeActions({ nodePath, isDirectory }: TreeNodeActionsProps) {
  const { startCreateDirectory } = useFileTree();
  const { openModal } = useURLParams();

  const handleCreateFile = (e: MouseEvent) => {
    e.stopPropagation();
    const targetDir = isDirectory ? nodePath : getParentPath(nodePath);
    openModal("create-file", { dir: targetDir }, { replace: false });
  };

  const handleCreateDirectory = (e: MouseEvent) => {
    e.stopPropagation();
    const targetDir = isDirectory ? nodePath : getParentPath(nodePath);
    startCreateDirectory(targetDir);
  };

  // **余分なコンテナを挟まない。** 並べ方を決めているのは `node-box__actions`
  return (
    <>
      <IconButton
        onClick={handleCreateFile}
        title="新しいファイルを作成"
        ariaLabel="新しいファイルを作成"
      >
        <FilePlus2 size={14} />
      </IconButton>
      <IconButton
        onClick={handleCreateDirectory}
        title="新しいフォルダを作成"
        ariaLabel="新しいフォルダを作成"
      >
        <FolderPlus size={14} />
      </IconButton>
    </>
  );
}

export default TreeNodeActions;
