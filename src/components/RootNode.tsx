import type { FileTreeNode } from "@/types/file-tree";
import { useState } from "react";
import NodeBox from "./NodeBox";
import DirectoryToggleIcon from "./DirectoryToggleIcon";
import TreeNode from "./TreeNode";
import "./RootNode.scss";

function RootNode({ node }: { node: FileTreeNode }) {
  const [isOpen, setIsOpen] = useState(true);
  function handleClick() {
    setIsOpen(!isOpen);
  }

  return (
    <>
      <NodeBox level={0} handleClick={handleClick}>
        <DirectoryToggleIcon isExpanded={isOpen} />
        <span className="file-tree__rootdir--name">{node.name}</span>
      </NodeBox>
      {!isOpen || !node.children?.length
        ? null
        : node.children?.map((child) => (
            <TreeNode key={child.id} node={child} level={1} />
          ))}
    </>
  );
}

export default RootNode;
