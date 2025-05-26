export type FileTreeNode = {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
  isOpen: boolean;
  isRoot?: boolean;
  children?: FileTreeNode[];
  meta?: {
    fileType?: "kif" | "ki2" | "other";
    iconType?: "folder" | "document" | "kif-file";
  };
};
