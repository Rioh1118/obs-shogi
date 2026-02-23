export interface RustFileTreeNode {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
  children?: RustFileTreeNode[];
  lastModified?: number; // unix timestamp(sec)
  size?: number;
  extension?: string;
}
