import type { FileTreeNode } from "@/types/file-tree";
import NodeBox from "./NodeBox";
import FileIcon from "./FileIcon";
import { useFileTree } from "@/contexts/FileTreeContext";
import InlineNameEditor from "./InlineNameEditor";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { DROP_ID, parentDir, type DropData } from "@/utils/kifuDragDrop";
import { useRef } from "react";

function FileNode({ level, node }: { level: number; node: FileTreeNode }) {
  const {
    selectedNode,
    selectNode,
    openContextMenu,
    renamingNodeId,
    renameNode,
    cancelInlineRename,
  } = useFileTree();
  const isSelected = selectedNode?.id === node.id;
  const isRenaming = renamingNodeId === node.id;
  const nameRef = useRef<HTMLSpanElement | null>(null);

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({
    id: node.path,
    data: { kind: "tree-node", path: node.path, isDirectory: false },
    disabled: isRenaming,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: DROP_ID.file(node.path),
    data: {
      kind: "drop",
      destDir: parentDir(node.path),
      via: "file",
    } satisfies DropData,
  });

  const setNodeRef = (el: HTMLDivElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };

  const showNativeTooltip = () => {
    const el = nameRef.current;
    if (!el) return;

    const isOverflowing = el.scrollWidth > el.clientWidth + 1;
    if (!isOverflowing) return;

    const pop = document.getElementById("filetree-tooltip") as
      | (HTMLElement & {
          showPopover?: () => void;
          hidePopover?: () => void;
        })
      | null;
    if (!pop?.showPopover) return;

    pop.textContent = node.name;

    const r = el.getBoundingClientRect();
    const margin = 10;
    const left = Math.min(r.left, window.innerWidth - 320);
    const top = r.bottom + margin;

    pop.style.position = "fixed";
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.top = `${Math.max(8, top)}px`;

    pop.showPopover();
  };

  const hideNativeTooltip = () => {
    const pop = document.getElementById("filetree-tooltip");
    pop?.hidePopover?.();
  };

  const handleClick = () => {
    if (isRenaming || isDragging) return;
    if (node.isDirectory) return;

    if (isSelected) {
      selectNode(null);
    } else {
      selectNode(node);
    }
  };

  const onContextMenu: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(node, e.clientX, e.clientY);
  };

  const handleCommit = async (nextName: string) => {
    cancelInlineRename();
    await renameNode(node, nextName);
  };

  return (
    <NodeBox
      ref={setNodeRef}
      level={level}
      handleClick={handleClick}
      isSelected={isSelected}
      onContextMenu={onContextMenu}
      className={`${isOver ? "node-box__droppable-over" : ""} ${isDragging ? "node-box--drag-source" : ""}`}
      style={{
        transform: CSS.Translate.toString(transform),
      }}
      {...attributes}
      {...listeners}
    >
      <FileIcon type={node.displayInfo.iconType} />
      {isRenaming ? (
        <InlineNameEditor
          isEditting={isRenaming}
          initialName={node.name}
          selectMode="file"
          onCancel={cancelInlineRename}
          onCommit={handleCommit}
        />
      ) : (
        <span
          ref={nameRef}
          onPointerEnter={() => {
            if (isDragging) return;
            showNativeTooltip();
          }}
          onPointerLeave={hideNativeTooltip}
          onFocus={showNativeTooltip}
          onBlur={hideNativeTooltip}
          className="file-name"
        >
          {node.name}
        </span>
      )}
    </NodeBox>
  );
}

export default FileNode;
