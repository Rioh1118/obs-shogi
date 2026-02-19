import { type RustFileTreeNode } from "@/types/rust-types";
import type { FileTreeNode, KifuFormat } from "@/types";

export class RustFileTreeAdapter {
  /**
   * RustのFileTreeNodeをアプリケーション用FileTreeNodeに変換
   */
  static fromRust(rustNode: RustFileTreeNode): FileTreeNode {
    return {
      id: rustNode.id,
      name: rustNode.name,
      path: rustNode.path,
      isDirectory: rustNode.isDir,
      children: rustNode.children?.map((child) => this.fromRust(child)),
      lastModified: this.convertTimestamp(rustNode.lastModified),
      size: rustNode.size,

      // DisplayInfo部分
      displayInfo: {
        iconType: this.getIconType(rustNode.isDir, rustNode.extension),
        isExpanded: false,
        isSelected: false,
      },

      // KifuInfo部分
      kifuInfo: this.createKifuInfo(rustNode),
    };
  }

  /**
   * Unix timestampをdateオブジェクトに変換
   */
  private static convertTimestamp(timestamp?: number): Date | undefined {
    return timestamp ? new Date(timestamp * 1000) : undefined;
  }

  /**
   * アイコンタイプを決定
   */
  private static getIconType(
    isDir: boolean,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _extension?: string,
  ): "folder" | "kif-file" {
    if (isDir) return "folder";
    return "kif-file";
  }

  /**
   * 拡張子からKifuFormatを取得
   */
  private static getKifuFormat(extension?: string): KifuFormat | undefined {
    if (!extension) return undefined;

    switch (extension.toLowerCase()) {
      case "kif":
        return "kif";
      case "ki2":
        return "ki2";
      case "jkf":
        return "jkf";
      case "csa":
        return "csa";
      default:
        return undefined;
    }
  }

  /**
   * KifuFileInfo作成
   */
  private static createKifuInfo(rustNode: RustFileTreeNode) {
    if (rustNode.isDir) return undefined;

    const format = this.getKifuFormat(rustNode.extension);
    if (!format) return undefined;

    return {
      format,
    };
  }
}
