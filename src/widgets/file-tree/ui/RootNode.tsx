import { useState, type MouseEventHandler } from "react";
import NodeBox from "./NodeBox";
import DirectoryToggleIcon from "./DirectoryToggleIcon";
import TreeNode from "./TreeNode";
import "./RootNode.scss";
import TreeNodeActions from "./TreeNodeActions";
import InlineNameEditor from "./InlineNameEditor";
import NewDirectoryRow from "./NewDirectoryRow";
import TruncatedNotice from "./TruncatedNotice";
import { useDroppable } from "@dnd-kit/core";
import { DROP_ID, type DropData } from "@/widgets/file-tree/lib/dnd";
import type { FileTreeNode } from "@/entities/file-tree";
import { commitName, useFileTree } from "@/entities/file-tree";

function RootNode({ node }: { node: FileTreeNode }) {
  const {
    openContextMenu,
    renamingNodeId,
    renameNode,
    cancelInlineRename,
    pushError,
    creatingDirParentPath,
  } = useFileTree();
  const { setNodeRef, isOver } = useDroppable({
    id: DROP_ID.root(node.path),
    data: { kind: "drop", destDir: node.path, via: "root" } satisfies DropData,
  });

  const [isOpen, setIsOpen] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  const isRenaming = renamingNodeId === node.id;

  const showCreateRow = isOpen && creatingDirParentPath === node.path && !isRenaming;

  const handleContextMenu: MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(node, e.clientX, e.clientY);
  };

  const handleCommitRename = (nextName: string) =>
    commitName(nextName, (name) => renameNode(node, name), cancelInlineRename);

  const handleClick = () => {
    // 改名中は畳まない。失敗の箱は行を押し広げて出るので、その文を読もうとした
    // クリックがここに来る。畳むと打った名前と理由が同時に消える
    if (isRenaming) return;
    setIsOpen(!isOpen);
  };

  return (
    <>
      <NodeBox
        ref={setNodeRef}
        level={0}
        className={isOver ? "node-box__droppable-over" : ""}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onContextMenu={handleContextMenu}
        action={
          isHovered ? (
            <TreeNodeActions nodePath={node.path} isDirectory={node.isDirectory} />
          ) : undefined
        }
      >
        <DirectoryToggleIcon isExpanded={isOpen} />
        {isRenaming ? (
          <InlineNameEditor
            initialName={node.name}
            selectMode="all"
            onCancel={cancelInlineRename}
            onCommit={handleCommitRename}
            onUnshowable={pushError}
          />
        ) : (
          <span className="file-tree__rootdir--name">{node.name}</span>
        )}
      </NodeBox>

      {isOpen && (
        <>
          {showCreateRow && <NewDirectoryRow parentPath={node.path} level={1} />}
          {node.children?.map((child) => (
            <TreeNode key={child.path} node={child} level={1} />
          ))}
          {node.truncated && <TruncatedNotice level={1} />}
        </>
      )}
    </>
  );
}

export default RootNode;
