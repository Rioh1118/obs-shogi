import type { FileTreeNode } from "@/types/file-tree";
import NodeBox from "./NodeBox";
import FileIcon from "./FileIcon";

function FileNode({ level, node }: { level: number; node: FileTreeNode }) {
  return (
    <NodeBox level={level}>
      {node.meta?.iconType && <FileIcon type={node.meta.iconType} />}
      <span className="file-name">{node.name}</span>
    </NodeBox>
  );
}

export default FileNode;
