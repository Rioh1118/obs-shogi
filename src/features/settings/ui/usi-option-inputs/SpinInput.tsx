import { useEffect, useState } from "react";
import SInput from "../kit/SInput";
import type { UsiInputProps } from "./types";

function clamp(n: number, min: number | undefined, max: number | undefined): number {
  let r = n;
  if (min !== undefined) r = Math.max(r, min);
  if (max !== undefined) r = Math.min(r, max);
  return r;
}

export default function SpinInput({ option, currentValue, onChange }: UsiInputProps) {
  const spin = option.option_type.Spin;
  const min = spin?.min;
  const max = spin?.max;
  const defaultStr =
    spin?.default !== undefined ? String(spin.default) : (option.default_value ?? "");

  // 入力途中の "1" → "10" → "100" を許すためローカル状態。blur で clamp する。
  const [raw, setRaw] = useState<string>(currentValue ?? "");

  useEffect(() => {
    setRaw(currentValue ?? "");
  }, [currentValue]);

  const handleBlur = () => {
    if (raw === "") {
      // 空欄 = デフォルトに戻す
      onChange("");
      return;
    }
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) {
      // 数値として読めない場合は元に戻す
      setRaw(currentValue ?? "");
      return;
    }
    const clamped = clamp(n, min, max);
    const str = String(clamped);
    setRaw(str);
    if (str !== currentValue) {
      onChange(str);
    }
  };

  return (
    <SInput
      type="number"
      inputMode="numeric"
      value={raw}
      min={min}
      max={max}
      placeholder={defaultStr}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={handleBlur}
    />
  );
}
