import SInput from "../kit/SInput";
import type { UsiInputProps } from "./types";

export default function StringInput({ option, currentValue, onChange }: UsiInputProps) {
  const defaultStr = option.option_type.String?.default ?? option.default_value ?? "";

  return (
    <SInput
      type="text"
      value={currentValue ?? ""}
      placeholder={defaultStr}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
