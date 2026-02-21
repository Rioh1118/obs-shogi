import type { FileTreeNode } from "@/types/file-tree";
import NodeBox from "./NodeBox";
import FileIcon from "./FileIcon";
import { useFileTree } from "@/contexts/FileTreeContext";
import InlineNameEditor from "./InlineNameEditor";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { DROP_ID, parentDir, type DropData } from "@/utils/kifuDragDrop";

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

  const handleClick = () => {
    if (isRenaming || isDragging) return;
    if (!node.isDirectory) {
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
        <span className="file-name">{node.name}</span>
      )}
    </NodeBox>
  );
}

export default FileNode;
