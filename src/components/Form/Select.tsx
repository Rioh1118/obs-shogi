import { ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import "./Select.scss";

interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  label: string;
  id: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

function Select({
  label,
  id,
  options,
  value,
  onChange,
  placeholder,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedLabel =
    options.find((o) => o.value === value)?.label ||
    placeholder ||
    "選択してください";

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
  );
}

export default Select;
