import { useState } from "react";

import Button from "@/shared/ui/Button/Button";
import { pickFile } from "@/shared/api/picker/pickFile";
import { SField, SInput, SSection, SSelect } from "@/features/settings/ui/kit";
import { parseSpinValue } from "@/entities/engine-presets/lib/fitValues";
import { optionRows, type OptionRow } from "@/features/settings/lib/optionRows";
import type { EnginePreset } from "@/entities/engine-presets/model/types";

/** 読み取り専用の欄に添える理由 */
const RESERVED_NOTE = "アプリが決めます（評価関数・定跡の欄か、解析の方針）";

/** check の既定値の表示 */
function onOff(v: string | null): string {
  return v === "true" ? "ON" : v === "false" ? "OFF" : (v ?? "");
}

function defaultLabel(row: OptionRow): string {
  const text = row.def.type === "check" ? onOff(row.defaultText) : row.defaultText;
  return text ? `エンジン既定（${text}）` : "エンジン既定";
}

/**
 * spin の入力を確定する。整数でなければ入力前の値に戻し、範囲の外は丸める（送る側と同じ規則）。
 * 空ならエンジン既定
 */
function commitSpin(row: OptionRow & { def: { type: "spin" } }, raw: string): string | null {
  if (raw.trim() === "") return null;
  const n = parseSpinValue(raw);
  if (n == null) return row.value;
  const lo = row.def.min == null ? null : BigInt(row.def.min);
  const hi = row.def.max == null ? null : BigInt(row.def.max);
  const clamped = lo != null && n < lo ? lo : hi != null && n > hi ? hi : n;
  return String(clamped);
}

function OptionInput(props: {
  row: OptionRow;
  setOpt: (name: string, value: string | null) => void;
}) {
  const { row, setOpt } = props;
  const { def } = row;
  const set = (value: string | null) => setOpt(def.name, value);

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
            // 選択肢に無い保存済みの値も選択として残す（送る側は送らない。外すかは利用者が決める）
            ...(row.value != null && !def.vars.includes(row.value)
              ? [{ value: row.value, label: `${row.value}（選択肢に無い）` }]
              : []),
            ...def.vars.map((v) => ({ value: v, label: v })),
          ]}
        />
      );
    case "spin":
      return <SpinInput row={row as OptionRow & { def: { type: "spin" } }} set={set} />;
    case "string":
      return (
        <SInput
          value={row.value ?? ""}
          placeholder={defaultLabel(row)}
          onChange={(e) => set(e.target.value === "" ? null : e.target.value)}
        />
      );
    case "filename":
      return (
        <div className="presetDialog__inline">
          <SInput
            value={row.value ?? ""}
            placeholder={defaultLabel(row)}
            onChange={(e) => set(e.target.value === "" ? null : e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => {
              void pickFile(`${def.name} のファイルを選択`).then((path) => {
                if (path) set(path);
              });
            }}
          >
            選択…
          </Button>
        </div>
      );
  }
}

/** 打っている間は文字のまま持ち、欄を離れたときに確定する（途中の「-」で丸めない） */
function SpinInput(props: {
  row: OptionRow & { def: { type: "spin" } };
  set: (value: string | null) => void;
}) {
  const { row, set } = props;
  const [text, setText] = useState<string | null>(null);
  const range =
    row.def.min != null || row.def.max != null
      ? `${row.def.min ?? ""}〜${row.def.max ?? ""}`
      : null;
  return (
    <SInput
      inputMode="numeric"
      value={text ?? row.value ?? ""}
      placeholder={range ? `${defaultLabel(row)}　範囲 ${range}` : defaultLabel(row)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text == null) return;
        set(commitSpin(row, text));
        setText(null);
      }}
    />
  );
}

/**
 * エンジンが申告した全部のオプション（`optionRows`）。**定義を取得したエンジンのときだけ**欄を出す。
 * 値を持たない欄はエンジン既定（送らない）。アプリが決める名前は読み取り専用
 */
export default function UsiOptionsSection(props: {
  draft: EnginePreset;
  setOpt: (name: string, value: string | null) => void;
  /** 値を全部消す（すべてエンジン既定） */
  clearOptions: () => void;
}) {
  const { draft, setOpt, clearOptions } = props;
  const [query, setQuery] = useState("");
  const all = optionRows(draft);
  const rows = optionRows(draft, query);

  if (all.length === 0) return null;

  return (
    <SSection
      title="すべてのオプション"
      description="エンジンが申告した全部の欄。値の無い欄は送らず、エンジンが自分の既定で動きます。"
    >
      <details className="presetDialog__details">
        <summary className="presetDialog__summary">
          {all.length} 件（変えた値 {all.filter((r) => r.value != null).length} 件）
        </summary>
        <div className="presetDialog__detailsBody">
          <div className="presetDialog__inline" style={{ marginBottom: 12 }}>
            <SInput
              value={query}
              placeholder="名前で絞り込む"
              aria-label="オプションを名前で絞り込む"
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button size="sm" onClick={clearOptions}>
              すべてエンジン既定に戻す
            </Button>
          </div>

          <div className="presetDialog__stack">
            {rows.map((row) => (
              <SField
                key={row.def.name}
                label={row.changed ? <b>{row.def.name}</b> : row.def.name}
                description={row.reserved ? RESERVED_NOTE : undefined}
              >
                {row.reserved ? (
                  <div className="presetDialog__hintMuted">{row.value ?? defaultLabel(row)}</div>
                ) : (
                  <OptionInput row={row} setOpt={setOpt} />
                )}
              </SField>
            ))}
            {rows.length === 0 && (
              <div className="presetDialog__hintMuted">
                「{query}」に当たるオプションはありません
              </div>
            )}
          </div>
        </div>
      </details>
    </SSection>
  );
}
