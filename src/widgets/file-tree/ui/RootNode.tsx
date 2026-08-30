import { useState } from "react";
import NodeBox from "./NodeBox";
import DirectoryToggleIcon from "./DirectoryToggleIcon";
import TreeNode from "./TreeNode";
import "./RootNode.scss";
import TreeNodeActions from "./TreeNodeActions";
import InlineNameEditor from "./InlineNameEditor";
import TruncatedNotice from "./TruncatedNotice";
import FileIcon from "./FileIcon";
import { useDroppable } from "@dnd-kit/core";
import { DROP_ID, type DropData } from "@/widgets/file-tree/lib/dnd";
import type { FileTreeNode } from "@/entities/file-tree";
import { commitName, useFileTree } from "@/entities/file-tree";

function RootNode({
  node,
  externalHoverDir,
}: {
  node: FileTreeNode;
  externalHoverDir?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  const {
    openContextMenu,
    renamingNodeId,
    renameNode,
    cancelInlineRename,
    pushError,
    creatingDirParentPath,
    cancelCreateDirectory,
    createNewDirectory,
  } = useFileTree();

  const isRenaming = renamingNodeId === node.id;

  const showCreateRow = isOpen && creatingDirParentPath === node.path && !isRenaming;

  const onContextMenu: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(node, e.clientX, e.clientY);
  };

  const handleCommitRename = (nextName: string) =>
    commitName(nextName, (name) => renameNode(node, name), cancelInlineRename);

  const handleCommitCreate = (nextName: string) =>
    commitName(nextName, (name) => createNewDirectory(node.path, name), cancelCreateDirectory);

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  const handleClick = () => {
    // 改名中は畳まない。失敗の箱は行を押し広げて出るので、その文を読もうとした
    // クリックがここに来る。畳むと打った名前と理由が同時に消える
    if (isRenaming) return;
    setIsOpen(!isOpen);
  };

  const { setNodeRef, isOver } = useDroppable({
    id: DROP_ID.root(node.path),
    data: { kind: "drop", destDir: node.path, via: "root" } satisfies DropData,
  });

  const isExternalOver = externalHoverDir && externalHoverDir === node.path;

  return (
    <>
      <NodeBox
        ref={setNodeRef}
        level={0}
        data-drop-dir={node.path}
        className={isOver || isExternalOver ? "node-box__droppable-over" : ""}
        handleClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={onContextMenu}
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

      {!isOpen ? null : (
        <>
          {showCreateRow && (
            <NodeBox level={1} handleClick={() => {}}>
              <FileIcon type="folder" />
              <InlineNameEditor
                initialName=""
                selectMode="all"
                onCancel={cancelCreateDirectory}
                onCommit={handleCommitCreate}
                onUnshowable={pushError}
              />
            </NodeBox>
          )}

          {!node.children?.length
            ? null
            : node.children.map((child) => <TreeNode key={child.path} node={child} level={1} />)}
          {node.truncated && <TruncatedNotice level={1} />}
        </>
      )}
    </>
  );
}

export default RootNode;
