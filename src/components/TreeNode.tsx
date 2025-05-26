import type { FileTreeNode } from "@/types/file-tree";
import DirectoryNode from "./DirectoryNode";
import FileNode from "./FileNode";

function TreeNode({ node, level }: { node: FileTreeNode; level: number }) {
  return (
    <>
      {node.isDir ? (
        <DirectoryNode node={node} level={level} />
      ) : (
        <FileNode node={node} level={level} />
      )}
    </>
  );
}

export default TreeNode;
