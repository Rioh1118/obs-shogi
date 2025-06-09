import type { FileTreeNode } from "@/types";
import NodeBox from "./NodeBox";
import FileIcon from "./FileIcon";
import { useFileTree } from "@/contexts/FileTreeContext";
import TreeNode from "./TreeNode";
import DirectoryToggleIcon from "./DirectoryToggleIcon";
import { useState } from "react";
import TreeNodeActions from "./TreeNodeActions";

function DirectoryNode({ level, node }: { level: number; node: FileTreeNode }) {
  const { toggleNode, isNodeExpanded } = useFileTree();
  const [isHovered, setIsHovered] = useState(false);
  const isOpen = isNodeExpanded(node.id);

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  function handleClick() {
    toggleNode(node.id);
  }

  return (
    <>
      <NodeBox
        level={level}
        handleClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        action={
          isHovered ? (
            <TreeNodeActions
              nodePath={node.path}
              isDirectory={node.isDirectory}
            />
          ) : undefined
        }
      >
        <DirectoryToggleIcon isExpanded={isOpen} />
        <FileIcon isOpen={isOpen} type={node.displayInfo.iconType} />
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
