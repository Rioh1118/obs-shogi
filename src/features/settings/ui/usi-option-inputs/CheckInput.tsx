import SRadioGroup from "../kit/SRadioGroup";
import type { UsiInputProps } from "./types";

const OPTIONS = [
  { value: "true", label: "ON" },
  { value: "false", label: "OFF" },
];

export default function CheckInput({ option, currentValue, onChange }: UsiInputProps) {
  const defaultValue = option.option_type.Check?.default;
  const defaultStr = defaultValue === undefined ? "false" : String(defaultValue);

  // currentValue 未設定時はエンジン申告の default 位置を表示。
  // ユーザーがクリックして初めて draft.options に書き込まれる。
  const displayValue = currentValue ?? defaultStr;

  return (
    <SRadioGroup
      name={`usi-opt-${option.name}`}
      options={OPTIONS}
      value={displayValue}
      onChange={onChange}
      layout="list"
    />
  );
}
