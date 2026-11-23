import { ChevronDown, ChevronRight } from "lucide-react";
import "./DirectoryToggleIcon.scss";

/** 開閉の記号。開かない行（棋譜、打っている途中のフォルダ）は、揃えるための幅だけを取る */
function DirectoryToggleIcon({ isExpanded }: { isExpanded?: boolean }) {
  return (
    <span className="node-toggle" aria-hidden="true">
      {isExpanded === true && <ChevronDown size={14} />}
      {isExpanded === false && <ChevronRight size={14} />}
    </span>
  );
}
export default DirectoryToggleIcon;
