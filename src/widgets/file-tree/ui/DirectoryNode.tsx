import NodeBox from "./NodeBox";
import FileIcon from "./FileIcon";
import DirectoryToggleIcon from "./DirectoryToggleIcon";
import { useState, type MouseEventHandler, type ReactNode } from "react";
import TreeNodeActions from "./TreeNodeActions";
import InlineNameEditor from "./InlineNameEditor";
import NewDirectoryRow from "./NewDirectoryRow";
import TruncatedNotice from "./TruncatedNotice";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { DROP_ID, type DragData, type DropData } from "@/widgets/file-tree/lib/dnd";
import type { FileTreeNode } from "@/entities/file-tree";
import { commitName, useFileTree } from "@/entities/file-tree";

// TreeNode を import し返すと import/no-cycle に落ちる。子の描画は renderChild で受ける。
function DirectoryNode({
  level,
  node,
  renderChild,
}: {
  level: number;
  node: FileTreeNode;
  /** 子ノードの描画。返す要素には key を付けること（ここでは付けない）。 */
  renderChild: (child: FileTreeNode, level: number) => ReactNode;
}) {
  const {
    toggleNode,
    isNodeExpanded,
    openContextMenu,
    creatingDirParentPath,
    renamingNodeId,
    renameNode,
    cancelInlineRename,
    pushError,
  } = useFileTree();

  const [isHovered, setIsHovered] = useState(false);
  const isOpen = isNodeExpanded(node.path);
  const isRenaming = renamingNodeId === node.id;

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({
    id: node.path,
    data: {
      kind: "tree-node",
      path: node.path,
      isDirectory: true,
    } satisfies DragData,
    disabled: isRenaming,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: DROP_ID.dir(node.path),
    data: { kind: "drop", destDir: node.path, via: "dir" } satisfies DropData,
  });

  const setNodeRef = (el: HTMLDivElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };

  const showCreateRow = isOpen && creatingDirParentPath === node.path && !isRenaming;

  const handleClick = () => {
    if (isRenaming) return;
    toggleNode(node.path);
  };

  const handleContextMenu: MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(node, e.clientX, e.clientY);
  };

  const handleCommitRename = (nextName: string) =>
    commitName(nextName, (name) => renameNode(node, name), cancelInlineRename);

  return (
    <>
      <NodeBox
        ref={setNodeRef}
        level={level}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onContextMenu={handleContextMenu}
        className={isOver ? "node-box__droppable-over" : ""}
        style={{
          transform: CSS.Translate.toString(transform),
          opacity: isDragging ? 0.5 : undefined,
        }}
        {...attributes}
        {...listeners}
        action={
          isHovered ? (
            <TreeNodeActions nodePath={node.path} isDirectory={node.isDirectory} />
          ) : undefined
        }
      >
        <DirectoryToggleIcon isExpanded={isOpen} />
        <FileIcon type="folder" isOpen={isOpen} />
        {isRenaming ? (
          <InlineNameEditor
            initialName={node.name}
            selectMode="all"
            onCancel={cancelInlineRename}
            onCommit={handleCommitRename}
            onUnshowable={pushError}
          />
        ) : (
          <span>{node.name}</span>
        )}
      </NodeBox>
      {isOpen && (
        <>
          {showCreateRow && <NewDirectoryRow parentPath={node.path} level={level + 1} />}
          {node.children?.map((child) => renderChild(child, level + 1))}
          {node.truncated && <TruncatedNotice level={level + 1} />}
        </>
      )}
    </>
  );
}

export default DirectoryNode;
