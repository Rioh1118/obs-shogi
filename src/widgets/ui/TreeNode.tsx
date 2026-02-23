import type { FileTreeNode } from "@/entities/file-tree";
import DirectoryNode from "./DirectoryNode";
import FileNode from "./FileNode";

function TreeNode({ node, level }: { node: FileTreeNode; level: number }) {
  return (
    <>
      {node.isDirectory ? (
        <DirectoryNode key={node.path} node={node} level={level} />
      ) : (
        <FileNode key={node.path} node={node} level={level} />
      )}
    </>
  );
}

export default TreeNode;
