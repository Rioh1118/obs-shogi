export interface RustFileTreeNode {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
  children?: RustFileTreeNode[];
  lastModified?: number; // Unix timestamp
  size?: number;
  extension?: string;
}
