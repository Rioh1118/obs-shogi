import type { FileTreeNode } from "@/types/file-tree";
import { useState } from "react";
import NodeBox from "./NodeBox";
import DirectoryToggleIcon from "./DirectoryToggleIcon";
import TreeNode from "./TreeNode";
import "./RootNode.scss";
import TreeNodeActions from "./TreeNodeActions";

function RootNode({ node }: { node: FileTreeNode }) {
  const [isOpen, setIsOpen] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };
  function handleClick() {
    setIsOpen(!isOpen);
  }

  return (
    <>
      <NodeBox
        level={0}
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
        <span className="file-tree__rootdir--name">{node.name}</span>
      </NodeBox>
      {!isOpen || !node.children?.length
        ? null
        : node.children?.map((child) => (
            <TreeNode key={child.path} node={child} level={1} />
          ))}
    </>
  );
}

export default RootNode;
