interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  /**
   * 中の `textarea` を掴む
   *
   * **`id` で引かせない。** 同じ器に面を2つ載せて片方を隠す作りがあるので、
   * `getElementById` は隠れているほうの欄を掴みうる。
   */
  ref?: React.Ref<HTMLTextAreaElement>;
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
