import type { FileTreeNode } from "../model/types";
import type { KifuFormat } from "@/entities/kifu";
import type { RustFileTreeNode } from "./rust-types";

export class RustFileTreeAdapter {
  static fromRust(r: RustFileTreeNode): FileTreeNode {
    return {
      id: r.id,
      name: r.name,
      path: r.path,
      isDirectory: r.isDir,
      children: r.children?.map((c) => this.fromRust(c)),
      lastModified:
        typeof r.lastModified === "number"
          ? new Date(r.lastModified * 1000)
          : undefined,
      size: r.size,
      displayInfo: {
        iconType: r.isDir ? "folder" : "kif-file",
        isExpanded: false,
        isSelected: false,
      },
      kifuInfo: this.kifuInfo(r),
    };
  }

  private static kifuInfo(r: RustFileTreeNode) {
    if (r.isDir) return undefined;
    const fmt = this.kifuFormat(r.extension);
    return fmt ? { format: fmt } : undefined;
  }

  private static kifuFormat(ext?: string): KifuFormat | undefined {
    if (!ext) return undefined;
    const e = ext.toLowerCase();
    if (e === "kif") return "kif";
    if (e === "ki2") return "ki2";
    if (e === "jkf") return "jkf";
    if (e === "csa") return "csa";
    return undefined;
  }
}
