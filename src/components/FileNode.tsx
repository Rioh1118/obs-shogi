import type { FileTreeNode } from "@/types/file-tree";
import NodeBox from "./NodeBox";
import FileIcon from "./FileIcon";
import { useFileTree } from "../contexts/FileTreeContext";

function FileNode({ level, node }: { level: number; node: FileTreeNode }) {
  const { selectedNode, selectNode, loadFileContent } = useFileTree();

  const isSelected = selectedNode?.id === node.id;

  const handleClick = () => {
    if (!node.isDir) {
      selectNode(node);
      loadFileContent(node.path);
    }
  };

  return (
    <NodeBox level={level} handleClick={handleClick} isSelected={isSelected}>
      {node.meta?.iconType && <FileIcon type={node.meta.iconType} />}
      <span className="file-name">{node.name}</span>
    </NodeBox>
  );
}

export default FileNode;
