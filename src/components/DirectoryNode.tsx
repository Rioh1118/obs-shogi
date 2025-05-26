import type { FileTreeNode } from "@/types/file-tree";
import NodeBox from "./NodeBox";
import FileIcon from "./FileIcon";
import { useFileTree } from "../contexts/FileTreeContext";
import TreeNode from "./TreeNode";
import DirectoryToggleIcon from "./DirectoryToggleIcon";

function DirectoryNode({ level, node }: { level: number; node: FileTreeNode }) {
  const { toggleNode, isNodeExpanded } = useFileTree();

  const isOpen = isNodeExpanded(node.id);

  function handleClick() {
    toggleNode(node.id);
  }

  return (
    <>
      <NodeBox level={level} handleClick={handleClick}>
        <DirectoryToggleIcon isExpanded={isOpen} />
        <FileIcon
          isOpen={isOpen}
          type={!node.meta?.iconType ? "document" : node.meta.iconType}
        />
        <span>{node.name}</span>
      </NodeBox>
      {!isOpen || !node.children?.length
        ? null
        : node.children?.map((child) => (
            <TreeNode key={child.id} level={level + 1} node={child} />
          ))}
    </>
  );
}

export default DirectoryNode;
