import { open } from "@tauri-apps/plugin-dialog";
import SButton from "../kit/SButton";
import SInput from "../kit/SInput";
import type { UsiInputProps } from "./types";
import "./FilenameInput.scss";

export default function FilenameInput({ option, currentValue, onChange }: UsiInputProps) {
  const defaultStr = option.option_type.Filename?.default ?? option.default_value ?? "";

  const handlePick = async () => {
    try {
      const selected = await open({ multiple: false, directory: false });
      if (typeof selected === "string" && selected.length > 0) {
        onChange(selected);
      }
    } catch {
      // ユーザーキャンセル等は無視
    }
  };

  return (
    <div className="usiOptFilename">
      <SInput
        type="text"
        value={currentValue ?? ""}
        placeholder={defaultStr}
        onChange={(e) => onChange(e.target.value)}
        className="usiOptFilename__input"
      />
      <SButton variant="ghost" size="sm" onClick={handlePick}>
        選択…
      </SButton>
    </div>
  );
}
