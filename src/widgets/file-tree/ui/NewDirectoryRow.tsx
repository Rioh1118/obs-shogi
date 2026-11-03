import NodeBox from "./NodeBox";
import FileIcon from "./FileIcon";
import InlineNameEditor from "./InlineNameEditor";
import { commitName, useFileTree } from "@/entities/file-tree";

/** フォルダの作成で、名前を打つ行。`parentPath` の直下に作る */
function NewDirectoryRow({ parentPath, level }: { parentPath: string; level: number }) {
  const { cancelCreateDirectory, createNewDirectory, pushError } = useFileTree();

  const handleCommit = (nextName: string) =>
    commitName(nextName, (name) => createNewDirectory(parentPath, name), cancelCreateDirectory);

  return (
    <NodeBox level={level}>
      <FileIcon type="folder" />
      <InlineNameEditor
        initialName=""
        selectMode="all"
        onCancel={cancelCreateDirectory}
        onCommit={handleCommit}
        onUnshowable={pushError}
      />
    </NodeBox>
  );
}

export default NewDirectoryRow;
