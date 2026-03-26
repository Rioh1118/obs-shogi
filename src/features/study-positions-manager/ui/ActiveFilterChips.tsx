import { X } from "lucide-react";
import "./ActiveFilterChips.scss";

interface Props {
  tags: string[];
  onRemoveTag: (tag: string) => void;
  onClearAll: () => void;
}

export default function ActiveFilterChips({ tags, onRemoveTag, onClearAll }: Props) {
  if (tags.length === 0) return null;

  return (
    <div className="active-chips">
      {tags.map((tag) => (
        <span key={tag} className="active-chips__chip">
          <span className="active-chips__text">#{tag}</span>
          <button
            type="button"
            className="active-chips__remove"
            onClick={() => onRemoveTag(tag)}
            aria-label={`${tag}を解除`}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <button type="button" className="active-chips__clearAll" onClick={onClearAll}>
        {"クリア"}
      </button>
    </div>
  );
}
