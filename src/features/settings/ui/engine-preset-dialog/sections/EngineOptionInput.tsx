import { useState } from "react";

import type { OptionRow } from "@/features/settings/lib/optionRows";
import { engineDefaultLabel } from "@/features/settings/lib/presetOptionValues";
import { commitSpinInput, type SpinDef } from "@/features/settings/lib/spinInput";
import { SInput, SSelect } from "@/features/settings/ui/kit";
import { pickFile } from "@/shared/api/picker/pickFile";
import Button from "@/shared/ui/Button/Button";

function onOff(v: string | null): string {
  return v === "true" ? "ON" : v === "false" ? "OFF" : (v ?? "");
}

function defaultLabel(row: OptionRow): string {
  return engineDefaultLabel(
    (row.def.type === "check" ? onOff(row.defaultText) : row.defaultText) || null,
  );
}

type SetValue = (value: string | null) => void;

/** 打っている間は文字のまま持ち、欄を離れたときに確定する。途中の「-」で丸めない。 */
function SpinInput({ def, row, set }: { def: SpinDef; row: OptionRow; set: SetValue }) {
  const [text, setText] = useState<string | null>(null);
  const range = def.min != null || def.max != null ? `${def.min ?? ""}〜${def.max ?? ""}` : null;

  const handleBlur = () => {
    if (text == null) return;
    const next = commitSpinInput(def, row.value, text);
    if (next !== undefined) set(next);
    setText(null);
  };

  return (
    <SInput
      inputMode="numeric"
      value={text ?? row.value ?? ""}
      placeholder={range ? `${defaultLabel(row)} 範囲 ${range}` : defaultLabel(row)}
      onChange={(e) => setText(e.target.value)}
      onBlur={handleBlur}
    />
  );
}

/** パスの欄と、ファイルを選ぶボタン。選ぶ画面を開けなければ、直接の入力へ誘う。 */
function FilenameInput({ row, set }: { row: OptionRow; set: SetValue }) {
  const [pickError, setPickError] = useState<string | null>(null);

  const handlePick = () => {
    setPickError(null);
    pickFile(`${row.def.name} のファイルを選択`).then(
      (path) => {
        if (path) set(path);
      },
      (e: unknown) =>
        setPickError(
          `ファイルを選択する画面を開けませんでした（${String(e)}）。欄にパスを直接入力してください`,
        ),
    );
  };

  // 1つの箱に入れる。行は名前と入力の2列の grid なので、子を並べて返すと失敗の文言が名前の列へ回る
  return (
    <div>
      <div className="presetDialog__inputRow">
        <SInput
          value={row.value ?? ""}
          placeholder={defaultLabel(row)}
          onChange={(e) => set(e.target.value === "" ? null : e.target.value)}
        />
        <Button size="sm" onClick={handlePick}>
          選択…
        </Button>
      </div>
      {pickError && (
        <div className="presetDialog__hintWarn" role="alert">
          {pickError}
        </div>
      )}
    </div>
  );
}

/** オプションの型に合った入力の欄。空は値を消す。 */
export default function EngineOptionInput({
  row,
  setOption,
}: {
  row: OptionRow;
  setOption: (name: string, value: string | null) => void;
}) {
  const { def } = row;
  const set: SetValue = (value) => setOption(def.name, value);

  switch (def.type) {
    case "check":
      return (
        <SSelect
          value={row.value ?? ""}
          onChange={(e) => set(e.target.value || null)}
          options={[
            { value: "", label: defaultLabel(row) },
            { value: "true", label: "ON" },
            { value: "false", label: "OFF" },
          ]}
        />
      );
    case "combo":
      return (
        <SSelect
          value={row.value ?? ""}
          onChange={(e) => set(e.target.value || null)}
          options={[
            { value: "", label: defaultLabel(row) },
            // 選択肢に無い保存済みの値も残す。送る側は送らず、外すかは利用者が決める
            ...(row.value != null && !def.vars.includes(row.value)
              ? [{ value: row.value, label: `${row.value}（選択肢に無い）` }]
              : []),
            ...def.vars.map((v) => ({ value: v, label: v })),
          ]}
        />
      );
    case "spin":
      return <SpinInput def={def} row={row} set={set} />;
    case "string":
      return (
        <SInput
          value={row.value ?? ""}
          placeholder={defaultLabel(row)}
          onChange={(e) => set(e.target.value === "" ? null : e.target.value)}
        />
      );
    case "filename":
      return <FilenameInput row={row} set={set} />;
  }
}
