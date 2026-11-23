import NodeBox from "./NodeBox";
import DirectoryToggleIcon from "./DirectoryToggleIcon";
import FileIcon from "./FileIcon";
import InlineNameEditor from "./InlineNameEditor";
import NodeName from "./NodeName";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { DROP_ID, parentDir, type DragData, type DropData } from "@/widgets/file-tree/lib/dnd";
import type { MouseEventHandler } from "react";
import type { FileTreeNode } from "@/entities/file-tree";
import { commitName, useFileTree } from "@/entities/file-tree";
import { useLoadedKifuPath } from "@/entities/game";

function FileNode({ level, node }: { level: number; node: FileTreeNode }) {
  const {
    openKifuNode,
    activeKifuPath,
    selectedNode,
    selectNode,
    openContextMenu,
    renamingNodeId,
    renameNode,
    cancelInlineRename,
    pushError,
  } = useFileTree();
  // **`useGame()` を読まない。** 行の数だけ盤の state を購読することになり、
  // 盤を1手動かすだけでツリーの全行が描き直される（ツリーは仮想化されていない）
  const loadedAbsPath = useLoadedKifuPath();
  // `id` で比べない。走査のたびに振り直され、読み直しは `selectedNode` を張り替えない
  const isSelected = selectedNode?.path === node.path;
  /**
   * 開き直しを省いてよいのは、**ツリーと盤の両方がこの棋譜を指しているとき**だけ。
   *
   * 2つはずれる（それぞれの意味は `activeKifuPath` と `loadedAbsPath` の doc）。
   * 片方だけで判定すると、ずれている間の押し直しが片側ずつ効かなくなる。
   *
   * - ツリーだけを見ると、載せられなかった棋譜が「開いている」ことになって押し直せない
   * - 盤だけを見ると、その前に開いていた棋譜へ戻れない。盤は既にそれを出しているので
   *   戻れたように見えるが、`activeKifuPath` は載せられなかったほうを指したままなので、
   *   `persistIfPossible` の検査が以降の書き込みを全部止める
   */
  const canSkipReopen = activeKifuPath === node.path && loadedAbsPath === node.path;
  const isRenaming = renamingNodeId === node.id;

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({
    id: node.path,
    data: { kind: "tree-node", path: node.path, isDirectory: false } satisfies DragData,
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
    if (node.isDirectory) return;

    selectNode(node);

    if (!canSkipReopen) {
      void openKifuNode(node); // async-result-ignored: openKifuNode が kifuError に積む
    }
  };

  const handleContextMenu: MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(node, e.clientX, e.clientY);
  };

  const handleCommitRename = (nextName: string) =>
    commitName(nextName, (name) => renameNode(node, name), cancelInlineRename);

  return (
    <NodeBox
      ref={setNodeRef}
      level={level}
      onClick={handleClick}
      isSelected={isSelected}
      onContextMenu={handleContextMenu}
      className={`${isOver ? "node-box__droppable-over" : ""} ${isDragging ? "node-box--drag-source" : ""}`}
      style={{
        transform: CSS.Translate.toString(transform),
      }}
      {...attributes}
      {...listeners}
    >
      <DirectoryToggleIcon />
      <FileIcon type="kif-file" />
      {isRenaming ? (
        <InlineNameEditor
          initialName={node.name}
          selectMode="file"
          onCancel={cancelInlineRename}
          onCommit={handleCommitRename}
          onUnshowable={pushError}
        />
      ) : (
        <NodeName name={node.name} isFile isDragging={isDragging} />
      )}
    </NodeBox>
  );
}

export default FileNode;
