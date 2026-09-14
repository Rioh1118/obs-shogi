import { FilePlus2, FolderPlus, Swords } from "lucide-react";
import IconButton from "@/shared/ui/IconButton";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { getParentPath } from "@/shared/lib/path";
import { useFileTree } from "@/entities/file-tree";

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

  /**
   * 対局も**ファイルを1枚作る操作**なので、ここに並ぶ。
   * 進行を見るのはドックの対局タブで、始めるのはツリーの側
   * （→ `docs/spec/screens/play-view.md`）。
   */
  const handleStartGame = (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetDir = isDirectory ? nodePath : getParentPath(nodePath);
    openModal("game-start", { dir: targetDir }, { replace: false });
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
        handleClick={handleStartGame}
        size="small"
        variant="ghost"
        title="ここに対局の棋譜を作って始める"
        ariaLabel="対局を始める"
      >
        <Swords size={14} />
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
