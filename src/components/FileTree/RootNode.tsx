import type { FileTreeNode } from "@/types/file-tree";
import { useState } from "react";
import NodeBox from "./NodeBox";
import DirectoryToggleIcon from "./DirectoryToggleIcon";
import TreeNode from "./TreeNode";
import "./RootNode.scss";
import TreeNodeActions from "./TreeNodeActions";
import { useFileTree } from "@/contexts/FileTreeContext";
import InlineNameEditor from "./InlineNameEditor";
import FileIcon from "./FileIcon";

function RootNode({ node }: { node: FileTreeNode }) {
  const [isOpen, setIsOpen] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  const {
    openContextMenu,
    renamingNodeId,
    renameNode,
    cancelInlineRename,
    creatingDirParentPath,
    cancelCreateDirectory,
    createNewDirectory,
  } = useFileTree();

  const isRenaming = renamingNodeId === node.id;

  const showCreateRow =
    isOpen && creatingDirParentPath === node.path && !isRenaming;

  const onContextMenu: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(node, e.clientX, e.clientY);
  };

  const handleCommitRename = async (nextName: string) => {
    cancelInlineRename();
    await renameNode(node, nextName);
  };

  const handleCommitCreate = async (name: string) => {
    const next = name.trim();
    cancelCreateDirectory();
    if (!next) return;
    await createNewDirectory(node.path, next);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  const handleClick = () => {
    setIsOpen(!isOpen);
  };

  return (
    <>
      <NodeBox
        level={0}
        handleClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={onContextMenu}
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
        {isRenaming ? (
          <InlineNameEditor
            isEditting={isRenaming}
            initialName={node.name}
            selectMode="all"
            onCancel={cancelInlineRename}
            onCommit={handleCommitRename}
          />
        ) : (
          <span className="file-tree__rootdir--name">{node.name}</span>
        )}
      </NodeBox>
      {!isOpen ? null : (
        <>
          {showCreateRow && (
            <NodeBox level={1} handleClick={() => {}}>
              <FileIcon type="folder" />
              <InlineNameEditor
                isEditting
                initialName=""
                selectMode="all"
                onCancel={cancelCreateDirectory}
                onCommit={handleCommitCreate}
              />
            </NodeBox>
          )}
          {!node.children?.length
            ? null
            : node.children?.map((child) => (
                <TreeNode key={child.path} node={child} level={1} />
              ))}
        </>
      )}
    </>
  );
}

export default RootNode;
