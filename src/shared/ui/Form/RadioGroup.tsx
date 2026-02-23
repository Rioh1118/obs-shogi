interface RadioOption {
  value: string;
  label: string;
}
interface RadioGroupProps {
  name: string;
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  title?: string;
  gridLayout?: boolean;
}

function RadioGroup({
  name,
  options,
  value,
  onChange,
  title,
  gridLayout = false,
}: RadioGroupProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  return (
    <>
      <h3 className="form__subheading">{title}</h3>
      <div
        className={gridLayout ? "form__radio-grid" : "form__radio-container"}
      >
        {options.map((option) => (
          <div key={option.value} className="form__radio-group">
            <input
              type="radio"
              className="form__radio-input"
              id={`${name}-${option.value}`}
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={handleChange}
            />
            <label
              htmlFor={`${name}-${option.value}`}
              className="form__radio-label"
            >
              <span className="form__radio-button"></span>
              {option.label}
            </label>
          </div>
        ))}
      </div>
    </>
  );
}

export default RadioGroup;
