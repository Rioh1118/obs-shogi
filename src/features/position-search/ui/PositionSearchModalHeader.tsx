import { Search, Loader2 } from "lucide-react";
import "./PositionSearchModalHeader.scss";

type Props = {
  title: string;
  isSearching: boolean;
};

export default function PositionSearchModalHeader({
  title,
  isSearching,
}: Props) {
  return (
    <header className="pos-search__header">
      <div className="pos-search__title">
        <Search size={16} />
        <span>{title}</span>
      </div>

      <div className="pos-search__headerRight" aria-label="状態">
        {isSearching && (
          <span
            className="pos-search__spinner"
            title="検索中"
            aria-live="polite"
          >
            <Loader2 size={16} className="pos-search__spinIcon" />
          </span>
        )}
      </div>
    </header>
  );
}
