import RootNode from "./RootNode";
import Spinner from "./Spinner";
import "./FileTree.scss";
import { useFileTree } from "../contexts/FileTreeContext";

function FileTree() {
  const { fileTree, isLoading, error, loadFileTree } = useFileTree();

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
        <RootNode node={fileTree} />
      )}
    </div>
  );
}

export default FileTree;
