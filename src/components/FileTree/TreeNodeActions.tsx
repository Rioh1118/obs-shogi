import { useNavigate } from "react-router";
import { FilePlus2, FolderPlus } from "lucide-react";
import IconButton from "../IconButton";

interface TreeNodeActionsProps {
  nodePath: string;
  isDirectory: boolean;
}

const getParentPath = (path: string) => {
  const parts = path.split("/");
  return parts.slice(0, -1).join("/") || "/";
};

function TreeNodeActions({ nodePath, isDirectory }: TreeNodeActionsProps) {
  const navigate = useNavigate();

  const handleCreateFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetDir = isDirectory ? nodePath : getParentPath(nodePath);
    navigate(`?action=create-file&dir=${targetDir}`, {
      replace: true,
    });
  };

  const handleCreateDirectory = (e: React.MouseEvent) => {
    e.stopPropagation();
    const targetDir = isDirectory ? nodePath : getParentPath(nodePath);
    navigate(`?action=create-directory&dir=${targetDir}`, {
      replace: true,
    });
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
