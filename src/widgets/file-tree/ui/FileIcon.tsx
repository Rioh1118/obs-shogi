import "./FileIcon.scss";
import { Folder, FolderOpen } from "lucide-react";
import { SENTE_GLYPH } from "@/shared/lib/turn";

interface FileIconProps {
  type: "folder" | "kif-file";
  isOpen?: boolean;
}

export default function FileIcon({ type, isOpen }: FileIconProps) {
  function getIcon() {
    switch (type) {
      case "folder":
        return isOpen ? <FolderOpen size={14} /> : <Folder size={14} />;
      case "kif-file":
        // 先手の意味ではなく、棋譜ファイルを表す将棋の駒として使う
        return SENTE_GLYPH;
    }
  }
  return (
    <span className="file-icon" role="img" aria-hidden="true">
      {getIcon()}
    </span>
  );
}
