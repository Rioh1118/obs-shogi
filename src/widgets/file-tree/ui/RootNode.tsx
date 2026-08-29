import { useState } from "react";
import NodeBox from "./NodeBox";
import DirectoryToggleIcon from "./DirectoryToggleIcon";
import TreeNode from "./TreeNode";
import "./RootNode.scss";
import TreeNodeActions from "./TreeNodeActions";
import InlineNameEditor from "./InlineNameEditor";
import FileIcon from "./FileIcon";
import { useDroppable } from "@dnd-kit/core";
import { DROP_ID, type DropData } from "@/widgets/file-tree/lib/dnd";
import type { FileTreeNode } from "@/entities/file-tree/model/types";
import { useFileTree } from "@/entities/file-tree/model/useFileTree";
import { validateBasename } from "@/entities/file-tree/lib/validateBasename";

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

  // 名前を直せば通る失敗は返す。入力欄がその場に残り、打った文字列も残る
  const handleCommitRename = async (nextNameRaw: string) => {
    const validated = validateBasename(nextNameRaw);
    if (!validated.success) return validated.error;
    const nextName = validated.data;

    if (nextName === node.name) {
      cancelInlineRename();
      return;
    }

    const res = await renameNode(node, nextName);
    if (!res.success) return res.error;

    cancelInlineRename();
  };

  const handleCommitCreate = async (name: string) => {
    const next = name.trim();
    if (!next) return;

    const res = await createNewDirectory(node.path, next);
    if (!res.success) return res.error;

    cancelCreateDirectory();
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
            : node.children.map((child) => <TreeNode key={child.path} node={child} level={1} />)}
        </>
      )}
    </>
  );
}

export default RootNode;
