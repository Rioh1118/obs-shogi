import type { FileTreeNode } from "@/types/file-tree";
import NodeBox from "./NodeBox";
import FileIcon from "./FileIcon";
import { useFileTree } from "@/contexts/FileTreeContext";

function FileNode({ level, node }: { level: number; node: FileTreeNode }) {
  const { selectedNode, selectNode, loadSelectedKifu } = useFileTree();
  const isSelected = selectedNode?.id === node.id;

  const handleClick = () => {
    if (!node.isDirectory) {
      selectNode(node);
      loadSelectedKifu();
    }
  };

  return (
    <NodeBox level={level} handleClick={handleClick} isSelected={isSelected}>
      <FileIcon type={node.displayInfo.iconType} />
      <span className="file-name">{node.name}</span>
    </NodeBox>
  );
}

export default FileNode;
