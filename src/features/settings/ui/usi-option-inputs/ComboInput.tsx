import SSelect from "../kit/SSelect";
import type { UsiInputProps } from "./types";

export default function ComboInput({ option, currentValue, onChange }: UsiInputProps) {
  const combo = option.option_type.Combo;
  const vars = combo?.vars ?? [];
  const defaultStr = combo?.default ?? option.default_value ?? "";

  // 未設定時は default を選択表示するが draft には書き込まない（onChange は呼ばない）
  const displayValue = currentValue ?? defaultStr;

  const options = vars.map((v) => ({ value: v, label: v }));

  return (
    <SSelect value={displayValue} onChange={(e) => onChange(e.target.value)} options={options} />
  );
}
