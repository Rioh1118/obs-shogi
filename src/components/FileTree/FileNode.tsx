import type { FileTreeNode } from "@/types/file-tree";
import NodeBox from "./NodeBox";
import FileIcon from "./FileIcon";
import { useFileTree } from "@/contexts/FileTreeContext";
import InlineNameEditor from "./InlineNameEditor";

function FileNode({ level, node }: { level: number; node: FileTreeNode }) {
  const {
    selectedNode,
    selectNode,
    loadSelectedKifu,
    openContextMenu,
    renamingNodeId,
    renameNode,
    cancelInlineRename,
  } = useFileTree();
  const isSelected = selectedNode?.id === node.id;
  const isRenaming = renamingNodeId === node.id;

  const handleClick = () => {
    if (isRenaming) return;
    if (!node.isDirectory) {
      selectNode(node);
      loadSelectedKifu();
    }
  };

  const onContextMenu: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(node, e.clientX, e.clientY);
  };

  const handleCommit = async (nextName: string) => {
    cancelInlineRename();
    await renameNode(node, nextName);
  };

  return (
    <NodeBox
      level={level}
      handleClick={handleClick}
      isSelected={isSelected}
      onContextMenu={onContextMenu}
    >
      <FileIcon type={node.displayInfo.iconType} />
      {isRenaming ? (
        <InlineNameEditor
          isEditting={isRenaming}
          initialName={node.name}
          selectMode="file"
          onCancel={cancelInlineRename}
          onCommit={handleCommit}
        />
      ) : (
        <span className="file-name">{node.name}</span>
      )}
    </NodeBox>
  );
}

export default FileNode;
