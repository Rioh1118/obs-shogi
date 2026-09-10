import { ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import "./Select.scss";

interface Option<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  label: string;
  id: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  placeholder?: string;
}

/**
 * 値の集合を `options` から受け継ぐ。
 *
 * `string` で受けると、呼び手は `onChange` で必ず `as` を書くことになる
 * （`value` の集合が限定されているという不変条件を型が1つも表せない）。
 * 総称にすると、選択肢に無い綴りを `value` へ渡した時点で tsc が落とす。
 */
function Select<T extends string>({
  label,
  id,
  options,
  value,
  onChange,
  placeholder,
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedLabel =
    options.find((o) => o.value === value)?.label || placeholder || "選択してください";

  // 外部クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="form__field" ref={ref}>
      <label htmlFor={id} className="form__label">
        {label}
      </label>
      <div className="form__select-wrap">
        <input type="hidden" name={id} value={value} />
        <button
          type="button"
          className="form__select-button"
          onClick={() => setIsOpen((prev) => !prev)}
          id={id}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          <span>{selectedLabel}</span>
          <ChevronDown className="form__select-icon" size={18} />
        </button>
        {isOpen && (
          <ul className="form__select-menu" role="listbox">
            {options.map((option) => (
              <li
                key={option.value}
                className={`form__select-option${option.value === value ? " is-selected" : ""}`}
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
              >
                {option.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default Select;
