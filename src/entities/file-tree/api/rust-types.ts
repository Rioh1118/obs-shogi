export interface RustFileTreeNode {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
  children?: RustFileTreeNode[];
  /** 走査を打ち切った。false のときは欄ごと出ない（Rust 側の `skip_serializing_if`） */
  truncated?: boolean;
  /** 更新時刻（unix 秒）。取れないと欄ごと出ない（Rust 側は `Option`） */
  lastModified?: number;
  size?: number;
  extension?: string;
}
