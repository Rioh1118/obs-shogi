interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

function Textarea({ label, id, ...props }: TextareaProps) {
  return (
    <div className="form__field">
      <label htmlFor={id} className="form__label">
        {label}
      </label>
      <textarea className="form__textarea" id={id} {...props} />
    </div>
  );
}

export default Textarea;
