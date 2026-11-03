import { useRef } from "react";
import { Search, X } from "lucide-react";

type Props = {
  query: string;
  onChange: (query: string) => void;
};

/** 課題局面の一覧の本文の検索欄。見た目は `StudyPositionsManagerModal.scss` が持つ */
export default function SearchBox({ query, onChange }: Props) {
  const searchRef = useRef<HTMLInputElement>(null);

  const handleClearQuery = () => {
    onChange("");
    searchRef.current?.focus();
  };

  return (
    <div className="sp-manager__searchBox">
      <Search size={14} className="sp-manager__searchIcon" />
      <input
        ref={searchRef}
        type="text"
        className="sp-manager__searchInput"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ラベル・メモを検索"
        onKeyDown={(e) => {
          // 消すものがあるときだけ消費する。`stopPropagation()` にすると
          // `document` まで届かず、消すものが無いときの Escape で対話が閉じない
          if (e.key === "Escape" && query) {
            e.preventDefault();
            onChange("");
          }
        }}
      />
      {query && (
        <button
          type="button"
          className="sp-manager__searchClear"
          onClick={handleClearQuery}
          aria-label="検索クリア"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
