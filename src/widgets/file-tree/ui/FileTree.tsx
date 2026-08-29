import RootNode from "./RootNode";
import "./FileTree.scss";
import ContextMenu from "./ContextMenu";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useCallback, useMemo, useState } from "react";
import {
  buildNodeMap,
  DROP_ID,
  isDescendantDir,
  normPath,
  parentDir,
  type DropData,
} from "@/widgets/file-tree/lib/dnd";
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
import { isProjectRoot, useFileTree } from "@/entities/file-tree";
import Spinner from "@/shared/ui/Spinner";
import Button from "@/shared/ui/Button/Button";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import Modal from "@/shared/ui/Modal";
import FileTreeErrorNotice from "./FileTreeErrorNotice";
import type { FileTreeFailure, FileTreeNode } from "@/entities/file-tree";

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
    clearError,
    refreshTree,
  } = useFileTree();

  const { openModal } = useURLParams();

  // ルートそのものが読めないとき、この widget の中に復帰路が無い。
  // 読み直しても同じ場所を見にいくだけなので、選び直せる場所へ送る
  const chooseWorkspace = useMemo(
    () => ({
      label: "ワークスペースを選び直す",
      run: () => openModal("settings", { tab: "workspace" }),
    }),
    [openModal],
  );

  const nodeMap = useMemo(() => buildNodeMap(fileTree), [fileTree]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const [activePath, setActivePath] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileTreeNode | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // 読み直しの引き金になった失敗。読み込みを始めると reducer が `error` を
  // 落とすので、これが無いと押した瞬間に通知が消えて何も伝わらないまま終わる。
  // `isLoading` では代用できない。ツリーはファイル操作のたびに読み直され、
  // そのすべてで通知を出すことになる
  const [retriedFrom, setRetriedFrom] = useState<FileTreeFailure | null>(null);

  // ツリーを読み直す。失敗した操作そのものはやり直さない。
  // 何をしようとしていたかは、失敗を積んだ側（provider）に残っていない
  const handleRetry = useCallback(async () => {
    setRetriedFrom(error);
    try {
      await refreshTree(); // async-result-ignored: 読み直しの失敗は loadFileTree が state.error に積む
    } finally {
      setRetriedFrom(null);
    }
  }, [error, refreshTree]);

  // 読み直しが終わって新しい失敗が来ていれば、そちらが今の状態
  const shownError = error ?? retriedFrom;

  // 閉じるときは引き金にした失敗も落とす。clearError だけだと、読み直しの最中は
  // retriedFrom が残って表示が閉じず、Escape とオーバーレイが黙って効かなくなる
  const dismissError = useCallback(() => {
    setRetriedFrom(null);
    clearError();
  }, [clearError]);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await deleteNode(pendingDelete); // async-result-ignored: 失敗は deleteNode が通知へ積む
    } finally {
      setIsDeleting(false);
      setPendingDelete(null);
    }
  }, [pendingDelete, deleteNode]);

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

      await moveNode(node, destDir); // async-result-ignored: 失敗は moveNode が通知へ積む
    } finally {
      setActivePath(null);
    }
  };

  const isRoot = !!menu && isProjectRoot(menu.node.path, fileTree);

  const items = menu
    ? [
        { label: "Rename", onClick: () => startInlineRename(menu.node) },
        ...(isRoot
          ? []
          : [
              {
                label: "Delete",
                danger: true,
                onClick: () => {
                  setPendingDelete(menu.node);
                },
              },
            ]),
      ]
    : [];

  // 失敗はツリーの取得とファイル操作の両方が同じ `error` に積まれる。
  // 見せ方を分けるのはツリーが残っているかどうかで、ツリーがあるなら
  // 消さずに残す。消すと、そこからの操作が全部できなくなって復帰路まで失う
  const hasTree = !!fileTree;

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
          {isLoading && !hasTree ? (
            <Spinner />
          ) : shownError && !hasTree ? (
            <FileTreeErrorNotice
              error={shownError.error}
              onRetry={handleRetry}
              isRetrying={isLoading}
              fallback={chooseWorkspace}
            />
          ) : !hasTree ? (
            <div className="file-tree__empty">
              <p>ファイルツリーがありません</p>
              <Button size="sm" onClick={chooseWorkspace.run}>
                {chooseWorkspace.label}
              </Button>
            </div>
          ) : (
            <RootNode key={"root"} node={fileTree} />
          )}
          {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={closeContextMenu} />}
        </ScrollDropZone>
      </DndContext>

      {shownError && hasTree && (
        <Modal
          label={
            shownError.from === "reload"
              ? "一覧を取り直せませんでした"
              : "ファイル操作に失敗しました"
          }
          theme="dark"
          size="sm"
          scroll="content"
          onClose={dismissError}
        >
          {/* 操作は通っていて一覧だけが古い場合、「失敗しました」とだけ出すと
              操作が失敗したと読める。何が起きたかを先に書く */}
          {shownError.from === "reload" && (
            <p className="file-tree__reloadNote">
              操作は完了しましたが、一覧を取り直せませんでした。
            </p>
          )}
          <FileTreeErrorNotice
            error={shownError.error}
            onRetry={handleRetry}
            onDismiss={dismissError}
            isRetrying={isLoading}
          />
        </Modal>
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={
            pendingDelete.isDirectory
              ? `「${pendingDelete.name}」フォルダを削除しますか？`
              : `「${pendingDelete.name}」を削除しますか？`
          }
          subtitle={
            pendingDelete.isDirectory
              ? "フォルダ内のファイルもすべて完全に削除されます。この操作は取り消せません。"
              : "ファイルは完全に削除されます。この操作は取り消せません。"
          }
          isLoading={isDeleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      <div id="filetree-tooltip" popover="manual" className="filetree-tooltip" role="tooltip" />
    </div>
  );
}

export default FileTree;
