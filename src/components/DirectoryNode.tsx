import type { FileTreeNode } from "@/types/file-tree";
import NodeBox from "./NodeBox";
import FileIcon from "./FileIcon";
import { useState } from "react";
import TreeNode from "./TreeNode";
import DirectoryToggleIcon from "./DirectoryToggleIcon";

function DirectoryNode({ level, node }: { level: number; node: FileTreeNode }) {
  const [isOpen, setIsOpen] = useState(false);
  function handleClick() {
    return setIsOpen(!isOpen);
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
            <TreeNode level={level + 1} node={child} />
          ))}
    </>
  );
}

export default DirectoryNode;
