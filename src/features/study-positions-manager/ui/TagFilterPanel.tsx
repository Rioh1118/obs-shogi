import { useState, useRef, useEffect } from "react";
import { X, Search } from "lucide-react";
import "./TagFilterPanel.scss";

interface Props {
  contextualTags: string[];
  frequentTags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onClose: () => void;
}

export default function TagFilterPanel({
  contextualTags,
  frequentTags,
  selectedTags,
  onToggleTag,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filterByQuery = (tags: string[]) => {
    if (!query) return tags;
    const q = query.toLowerCase();
    return tags.filter((t) => t.toLowerCase().includes(q));
  };

  const filteredContextual = filterByQuery(contextualTags);
  const filteredFrequent = filterByQuery(frequentTags.filter((t) => !contextualTags.includes(t)));

  const isSelected = (tag: string) => selectedTags.includes(tag);

  const renderChip = (tag: string) => (
    <button
      key={tag}
      type="button"
      className={`tag-panel__chip ${isSelected(tag) ? "tag-panel__chip--selected" : ""}`}
      onClick={() => onToggleTag(tag)}
    >
      {tag}
    </button>
  );

  return (
    <div className="tag-panel">
      <div className="tag-panel__header">
        <span className="tag-panel__title">{"タグで絞り込む"}</span>
        <button type="button" className="tag-panel__close" onClick={onClose} aria-label="閉じる">
          <X size={14} />
        </button>
      </div>

      <div className="tag-panel__search">
        <Search size={14} className="tag-panel__searchIcon" />
        <input
          ref={inputRef}
          type="text"
          className="tag-panel__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="タグを検索"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              if (query) setQuery("");
              else onClose();
            }
          }}
        />
      </div>

      {filteredContextual.length > 0 && (
        <div className="tag-panel__section">
          <div className="tag-panel__sectionLabel">{"現在の結果に多いタグ"}</div>
          <div className="tag-panel__chips">{filteredContextual.map(renderChip)}</div>
        </div>
      )}

      {filteredFrequent.length > 0 && (
        <div className="tag-panel__section">
          <div className="tag-panel__sectionLabel">{"よく使うタグ"}</div>
          <div className="tag-panel__chips">{filteredFrequent.map(renderChip)}</div>
        </div>
      )}

      {selectedTags.length > 0 && (
        <div className="tag-panel__section">
          <div className="tag-panel__sectionLabel">{"選択中"}</div>
          <div className="tag-panel__chips">{selectedTags.map(renderChip)}</div>
        </div>
      )}

      {filteredContextual.length === 0 &&
        filteredFrequent.length === 0 &&
        selectedTags.length === 0 && (
          <div className="tag-panel__empty">
            {query ? "一致するタグがありません" : "タグがまだありません"}
          </div>
        )}
    </div>
  );
}
