import type { FileTreeNode } from "@/entities/file-tree";
import DirectoryNode from "./DirectoryNode";
import FileNode from "./FileNode";

// 木の再帰はここだけで閉じる。
function TreeNode({ node, level }: { node: FileTreeNode; level: number }) {
  return (
    <>
      {node.isDirectory ? (
        <DirectoryNode
          key={node.path}
          node={node}
          level={level}
          renderChild={(child, childLevel) => (
            <TreeNode key={child.id} node={child} level={childLevel} />
          )}
        />
      ) : (
        <FileNode key={node.path} node={node} level={level} />
      )}
    </>
  );
}

export default TreeNode;
