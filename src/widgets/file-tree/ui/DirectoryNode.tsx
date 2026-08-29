import NodeBox from "./NodeBox";
import FileIcon from "./FileIcon";
import DirectoryToggleIcon from "./DirectoryToggleIcon";
import { useState, type ReactNode } from "react";
import TreeNodeActions from "./TreeNodeActions";
import InlineNameEditor from "./InlineNameEditor";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { DROP_ID, type DragData, type DropData } from "@/widgets/file-tree/lib/dnd";
import type { FileTreeNode } from "@/entities/file-tree/model/types";
import { useFileTree } from "@/entities/file-tree/model/useFileTree";

// TreeNode を import し返すと import/no-cycle に落ちる。子の描画は renderChild で受ける。
function DirectoryNode({
  level,
  node,
  externalHoverDir,
  renderChild,
}: {
  level: number;
  node: FileTreeNode;
  externalHoverDir?: string | null;
  /** 子ノードの描画。返す要素には key を付けること（ここでは付けない）。 */
  renderChild: (child: FileTreeNode, level: number) => ReactNode;
}) {
  const {
    toggleNode,
    isNodeExpanded,
    openContextMenu,
    creatingDirParentPath,
    cancelCreateDirectory,
    renamingNodeId,
    renameNode,
    cancelInlineRename,
    createNewDirectory,
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

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  function handleClick() {
    if (isRenaming) return;
    toggleNode(node.path);
  }

  const onContextMenu: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(node, e.clientX, e.clientY);
  };

  const handleCommit = async (nextName: string) => {
    const res = await renameNode(node, nextName);
    if (res.success) {
      cancelInlineRename();
    }
  };

  const handleCommitCreate = async (name: string) => {
    const next = name.trim();
    cancelCreateDirectory();
    if (!next) return;
    await createNewDirectory(node.path, next);
  };

  const isExternalOver = externalHoverDir && externalHoverDir === node.path;

  return (
    <>
      <NodeBox
        ref={setNodeRef}
        level={level}
        handleClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={onContextMenu}
        data-drop-dir={node.path}
        className={isOver || isExternalOver ? "node-box__droppable-over" : ""}
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
        <FileIcon isOpen={isOpen} type={node.displayInfo.iconType} />
        {isRenaming ? (
          <InlineNameEditor
            isEditting={isRenaming}
            initialName={node.name}
            selectMode="all"
            onCancel={cancelInlineRename}
            onCommit={handleCommit}
          />
        ) : (
          <span>{node.name}</span>
        )}
      </NodeBox>
      {!isOpen ? null : (
        <>
          {showCreateRow && (
            <NodeBox level={level + 1} handleClick={() => {}}>
              <FileIcon type="folder" />
              <InlineNameEditor
                isEditting={showCreateRow}
                initialName=""
                selectMode="all"
                onCancel={cancelCreateDirectory}
                onCommit={handleCommitCreate}
              />
            </NodeBox>
          )}
          {!node.children?.length
            ? null
            : node.children.map((child) => renderChild(child, level + 1))}
        </>
      )}
    </>
  );
}

export default DirectoryNode;
