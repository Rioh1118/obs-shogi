export interface RustFileTreeNode {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
  children?: RustFileTreeNode[];
  /** 走査を打ち切った。false のときは欄ごと出ない（Rust 側の `skip_serializing_if`） */
  truncated?: boolean;
  /** 走査を打ち切った。false のときは欄ごと出ない（Rust 側の `skip_serializing_if`） */
  lastModified?: number; // unix timestamp(sec)
  size?: number;
  extension?: string;
}
