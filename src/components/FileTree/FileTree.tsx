import RootNode from "./RootNode";
import Spinner from "../Spinner";
import "./FileTree.scss";
import { useFileTree } from "@/contexts/FileTreeContext";
import ContextMenu from "./ContextMenu";
import { useAppConfig } from "@/contexts/AppConfigContext";

function FileTree() {
  const {
    fileTree,
    isLoading,
    menu,
    error,
    loadFileTree,
    deleteNode,
    closeContextMenu,
    startInlineRename,
  } = useFileTree();

  const { config } = useAppConfig();

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
    return (
      <div className="file-tree">
        <div className="error">
          <p>エラー: {error}</p>
          <button onClick={loadFileTree}>再読み込み</button>
        </div>
      </div>
    );
  }

  return (
    <div className="file-tree">
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
    </div>
  );
}

export default FileTree;
