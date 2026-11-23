import { useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";
import { X, Plus, Tag } from "lucide-react";
import "./TagsInput.scss";

type TagsInputProps = {
  label: string;
  id: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  disabled?: boolean;
};

export function TagsInput({
  label,
  id,
  tags,
  onChange,
  placeholder = "戦法や戦型を入力…",
  maxTags = 10,
  disabled = false,
}: TagsInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (tagText: string) => {
    const trimmedTag = tagText.trim();

    if (!trimmedTag || tags.includes(trimmedTag) || tags.length >= maxTags) {
      return false;
    }

    onChange([...tags, trimmedTag]);
    setInputValue("");
    return true;
  };

  const removeTag = (indexToRemove: number) => {
    onChange(tags.filter((_, index) => index !== indexToRemove));
    inputRef.current?.focus();
  };

  const handleRemoveClick = (e: MouseEvent, index: number) => {
    e.stopPropagation();
    removeTag(index);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    } else if (e.key === "Escape" && inputValue) {
      // 打ちかけの文字を消すのが先。消すものが無いときは止めないので、
      // そのまま上のモーダルまで届いて閉じる。
      //
      // **blur しない。** ここで抜けると `Modal` の閉じ込めが外へ出た焦点を
      // カード内の先頭の要素へ引き戻すので、キャレットが別の入力欄へ飛ぶ
      e.preventDefault();
      setInputValue("");
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    if (value.includes(",") || value.includes("、")) {
      const separator = value.includes(",") ? "," : "、";
      const newTags = value
        .split(separator)
        .map((tag) => tag.trim())
        .filter(Boolean);
      let hasAdded = false;
      newTags.forEach((tag) => {
        if (addTag(tag)) hasAdded = true;
      });
      if (!hasAdded && newTags.length > 0) {
        setInputValue(newTags[newTags.length - 1]);
      }
      return;
    }

    setInputValue(value);
  };

  const handleAddButtonClick = () => {
    if (addTag(inputValue)) {
      inputRef.current?.focus();
    }
  };

  const handleContainerClick = () => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  };

  return (
    <div className="tags-input-wrapper">
      <label htmlFor={id} className="tags-input__label">
        <Tag size={14} aria-hidden="true" />
        {label}
        {tags.length > 0 && (
          <span className="tags-input__count">
            {tags.length}/{maxTags}
          </span>
        )}
      </label>

      <div
        className={`tags-input ${isFocused ? "tags-input--focused" : ""}`}
        onClick={handleContainerClick}
      >
        <div className="tags-input__content">
          {tags.length > 0 && (
            <div className="tags-input__tags">
              {tags.map((tag, index) => (
                <div key={`${tag}-${index}`} className="tag" data-tag={tag}>
                  <span className="tag__text">{tag}</span>
                  <button
                    type="button"
                    className="tag__remove"
                    onClick={(e) => handleRemoveClick(e, index)}
                    disabled={disabled}
                    aria-label={`${tag}を削除`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="tags-input__input-area">
            <input
              ref={inputRef}
              type="text"
              id={id}
              className="tags-input__input"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder={tags.length >= maxTags ? "最大タグ数に達しました" : placeholder}
              disabled={disabled || tags.length >= maxTags}
            />

            {inputValue && !disabled && tags.length < maxTags && (
              <button
                type="button"
                className="tags-input__add-btn"
                onClick={handleAddButtonClick}
                aria-label="タグを追加"
              >
                <Plus size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="tags-input__help">
        <span>Enter</span>や<span>カンマ</span>で区切って複数追加可能
      </div>
    </div>
  );
}
