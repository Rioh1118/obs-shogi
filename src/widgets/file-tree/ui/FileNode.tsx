import { keepInViewport } from "@/shared/lib/keepInViewport";
import NodeBox from "./NodeBox";
import FileIcon from "./FileIcon";
import InlineNameEditor from "./InlineNameEditor";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { DROP_ID, parentDir, type DropData } from "@/widgets/file-tree/lib/dnd";
import { useRef } from "react";
import type { FileTreeNode } from "@/entities/file-tree";
import { commitName, isOpenedInTree, useFileTree } from "@/entities/file-tree";
import { useLoadedKifuPath } from "@/entities/game";

function FileNode({ level, node }: { level: number; node: FileTreeNode }) {
  const {
    openKifuNode,
    activeKifuPath,
    jkfData,
    kifuFormat,
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
  const isSelected = selectedNode?.id === node.id;
  /**
   * 開き直しを省いてよいのは、**ツリーと盤の両方がこの棋譜を指しているとき**だけ。
   *
   * 2つはずれる（それぞれの意味は `activeKifuPath` と `loadedAbsPath` の doc）。
   * 片方だけで判定すると、ずれている間の押し直しが片側ずつ効かなくなる。
   *
   * - **ツリーだけ**を見ると、載せられなかった棋譜が「開いている」ことになって押し直せない
   * - **盤だけ**を見ると、その前に開いていた棋譜へ戻れない。盤は既にそれを出しているので
   *   戻れたように見えるが、`activeKifuPath` は載せられなかったほうを指したままなので、
   *   `persistIfPossible` の門番が以降の書き込みを全部止める
   */
  const canSkipReopen =
    isOpenedInTree({ activeKifuPath, jkfData, kifuFormat }, node) && loadedAbsPath === node.path;
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
    pop.style.position = "fixed";
    pop.showPopover();

    // 大きさが決まってから丸める。下端の行では行の下が画面外になり、
    // `popover` は top layer にいて何にもクリップされないので、
    // 丸めないと名前を確かめる手段がその行だけ無くなる
    const box = keepInViewport(
      { x: r.left, y: r.bottom + 10 },
      { width: pop.offsetWidth, height: pop.offsetHeight },
    );
    pop.style.left = `${box.left}px`;
    pop.style.top = `${box.top}px`;
  };

  const hideNativeTooltip = () => {
    const pop = document.getElementById("filetree-tooltip");
    pop?.hidePopover?.();
  };

  const handleClick = () => {
    if (isRenaming || isDragging) return;
    if (node.isDirectory) return;

    selectNode(node);

    if (!canSkipReopen) {
      void openKifuNode(node); // async-result-ignored: openKifuNode が kifuError に積む
    }
  };

  const onContextMenu: React.MouseEventHandler<HTMLDivElement> = (e) => {
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
          initialName={node.name}
          selectMode="file"
          onCancel={cancelInlineRename}
          onCommit={handleCommitRename}
          onUnshowable={pushError}
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
