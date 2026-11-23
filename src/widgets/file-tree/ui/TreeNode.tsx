import type { FileTreeNode } from "@/entities/file-tree";
import DirectoryNode from "./DirectoryNode";
import FileNode from "./FileNode";

// 木の再帰はここだけで閉じる。
//
// 行の key はパス。`id` は走査のたびに振り直されるので、key にすると取り直すたびに
// 行が作り直され、改名の入力欄に打っている文字が消える。
function TreeNode({ node, level }: { node: FileTreeNode; level: number }) {
  return (
    <>
      {node.isDirectory ? (
        <DirectoryNode
          key={node.path}
          node={node}
          level={level}
          renderChild={(child, childLevel) => (
            <TreeNode key={child.path} node={child} level={childLevel} />
          )}
        />
      ) : (
        <FileNode key={node.path} node={node} level={level} />
      )}
    </>
  );
}

export default TreeNode;
