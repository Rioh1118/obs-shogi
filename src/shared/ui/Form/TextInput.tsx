interface TextInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  type?: "text" | "date" | "email";
}

function TextInput({ label, id, type = "text", ...props }: TextInputProps) {
  return (
    <div className="form__field">
      <label htmlFor={id} className="form__label">
        {label}
      </label>
      <input type={type} className="form__input" id={id} {...props} />
    </div>
  );
}

export default TextInput;
