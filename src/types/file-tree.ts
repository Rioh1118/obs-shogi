import type { KifuFormat } from "./kifu";

// kifファイルとディレクトリのみなので、シンプルになる
export interface FileSystemNode {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileSystemNode[];
  lastModified?: Date;
  size?: number;
}

export interface FileTreeDisplayInfo {
  iconType: "folder" | "kif-file"; // document は不要
  isExpanded?: boolean;
  isSelected?: boolean;
}

export interface KifuFileInfo {
  format: KifuFormat; // kifファイルなら必須
  moveCount?: number;
  hasBranches?: boolean;
  gameInfo?: {
    black?: string;
    white?: string;
    date?: string;
  };
}

export type FileTreeNode = FileSystemNode & {
  displayInfo: FileTreeDisplayInfo;
  kifuInfo?: KifuFileInfo; // ファイルの場合は必須、ディレクトリの場合はundefined
};
