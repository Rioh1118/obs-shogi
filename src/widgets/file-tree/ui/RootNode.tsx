import { useState } from "react";
import NodeBox from "./NodeBox";
import DirectoryToggleIcon from "./DirectoryToggleIcon";
import TreeNode from "./TreeNode";
import "./RootNode.scss";
import TreeNodeActions from "./TreeNodeActions";
import InlineNameEditor from "./InlineNameEditor";
import FileIcon from "./FileIcon";
import { useAppConfig } from "@/entities/app-config";
import { useDroppable } from "@dnd-kit/core";
import { DROP_ID, type DropData } from "@/widgets/file-tree/lib/dnd";
import type { FileTreeNode } from "@/entities/file-tree/model/types";
import { useFileTree } from "@/entities/file-tree/model/useFileTree";

function computeRenamedPathKeepingParent(
  oldPath: string,
  nextName: string,
): string {
  const p = oldPath.replace(/[/\\]+$/, "");
  const lastSlash = p.lastIndexOf("/");
  const lastBack = p.lastIndexOf("\\");
  const idx = Math.max(lastSlash, lastBack);
  const sep: "/" | "\\" = lastBack > lastSlash ? "\\" : "/";
  const parent = idx >= 0 ? p.slice(0, idx) : "";
  return parent ? `${parent}${sep}${nextName}` : nextName;
}

function validateBasename(name: string): string {
  const next = name.trim();
  if (!next) throw new Error("空の名前にはできません");
  if (/[/\\]/.test(next)) throw new Error("名前に / や \\ は使えません");
  return next;
}

function RootNode({
  node,
  externalHoverDir,
}: {
  node: FileTreeNode;
  externalHoverDir?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  const { setRootDir } = useAppConfig();

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

  const handleCommitRename = async (nextNameRaw: string) => {
    cancelInlineRename();
    let nextName: string;
    try {
      nextName = validateBasename(nextNameRaw);
    } catch (e) {
      console.error(e);
      return;
    }

    if (nextName === node.name) return;

    const oldPath = node.path;
    const nextPath = computeRenamedPathKeepingParent(oldPath, nextName);
    try {
      await renameNode(node, nextName);
      await setRootDir(nextPath);
    } catch (err) {
      console.error("ルートディレクトリリネームに失敗しました:", err);
    }
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
