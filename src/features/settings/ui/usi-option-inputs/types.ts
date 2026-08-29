import type { EngineOption } from "@/entities/engine/api/rust-types";

export interface UsiInputProps {
  option: EngineOption;
  /** draft.options[name] が存在しなければ undefined（= デフォルト未上書き状態） */
  currentValue: string | undefined;
  onChange: (value: string) => void;
}
