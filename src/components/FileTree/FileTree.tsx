import RootNode from "./RootNode";
import Spinner from "../Spinner";
import "./FileTree.scss";
import { useFileTree } from "@/contexts/FileTreeContext";
import ContextMenu from "./ContextMenu";
import { useAppConfig } from "@/contexts/AppConfigContext";
import { useMemo, useState } from "react";
import {
  buildNodeMap,
  DROP_ID,
  isDescendantDir,
  normPath,
  parentDir,
  type DropData,
} from "@/utils/kifuDragDrop";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import ScrollDropZone from "./ScrollDropZone";

const collisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);

  if (collisions.length > 1) {
    const withoutBlank = collisions.filter((c) => c.id !== DROP_ID.blank);
    if (withoutBlank.length) return withoutBlank;
  }

  return collisions.length ? collisions : closestCenter(args);
};

function FileTree() {
  const {
    fileTree,
    isLoading,
    menu,
    error,
    deleteNode,
    moveNode,
    closeContextMenu,
    startInlineRename,
  } = useFileTree();

  const { config } = useAppConfig();

  const nodeMap = useMemo(() => buildNodeMap(fileTree), [fileTree]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const [activePath, setActivePath] = useState<string | null>(null);

  const onDragStart = (e: DragStartEvent) => {
    setActivePath(String(e.active.id));
  };

  const onDragCancel = () => {
    setActivePath(null);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    try {
      const srcPath = String(e.active.id);

      const overData = e.over?.data.current as DropData | undefined;
      const destDir = overData?.destDir ?? fileTree?.path;
      if (!destDir) return;

      const node = nodeMap.get(srcPath);
      if (!node) return;

      const srcNorm = normPath(node.path);
      const destNorm = normPath(destDir);

      if (node.isDirectory && srcNorm === destNorm) return;

      const currentParent = parentDir(node.path);
      if (normPath(currentParent) === destNorm) return;

      if (node.isDirectory && isDescendantDir(node.path, destDir)) return;

      await moveNode(node, destDir);
    } finally {
      setActivePath(null);
    }
  };

  const isRoot = !!(
    menu &&
    config?.root_dir &&
    menu.node.path === config.root_dir
  );

  const items = menu
    ? [
        { label: "Rename", onClick: () => startInlineRename(menu.node) },
        ...(isRoot
          ? []
          : [
              {
                label: "Delete",
                danger: true,
                onClick: () => deleteNode(menu.node),
              },
            ]),
      ]
    : [];

  if (error) {
    console.error("再読み込み", error);
    return;
  }

  return (
    <div className={`file-tree ${activePath ? "file-tree--dragging" : ""}`}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
      >
        <ScrollDropZone rootPath={fileTree?.path ?? null}>
          {isLoading ? (
            <Spinner />
          ) : !fileTree ? (
            <div className="empty">
              <p>ファイルツリーがありません</p>
              <p>設定でルートディレクトリを選択してください</p>
            </div>
          ) : (
            <RootNode key={"root"} node={fileTree} />
          )}
          {menu && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={items}
              onClose={closeContextMenu}
            />
          )}
        </ScrollDropZone>
      </DndContext>
    </div>
  );
}

export default FileTree;
