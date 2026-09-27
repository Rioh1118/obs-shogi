import { useState } from "react";

import Button from "@/shared/ui/Button/Button";
import { pickFile } from "@/shared/api/picker/pickFile";
import { SField, SInput, SSection, SSelect } from "@/features/settings/ui/kit";
import SettingsBadge from "@/features/settings/ui/kit/SettingsBadge";
import { commitSpinInput } from "@/features/settings/lib/spinInput";
import { optionRows, type OptionRow } from "@/features/settings/lib/optionRows";
import type { EnginePreset } from "@/entities/engine-presets/model/types";

/**
 * 読み取り専用の欄に出す文。**値も既定値も出さない**——アプリが決める名前は、送るのが評価関数・定跡の
 * 欄の値や解析の方針の値で、保存済みの値やエンジンの既定値ではない
 */
const RESERVED_NOTE = "アプリが決めます（評価関数・定跡の欄か、解析の方針）";

/** check の既定値の表示 */
function onOff(v: string | null): string {
  return v === "true" ? "ON" : v === "false" ? "OFF" : (v ?? "");
}

function defaultLabel(row: OptionRow): string {
  const text = row.def.type === "check" ? onOff(row.defaultText) : row.defaultText;
  return text ? `エンジン既定（${text}）` : "エンジン既定";
}

type SpinRow = OptionRow & { def: Extract<OptionRow["def"], { type: "spin" }> };

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
      return <SpinInput row={row as SpinRow} set={set} />;
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

/** 打っている間は文字のまま持ち、欄を離れたときに確定する（途中の「-」で丸めない。`commitSpinInput`） */
function SpinInput(props: { row: SpinRow; set: (value: string | null) => void }) {
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
      placeholder={range ? `${defaultLabel(row)} 範囲 ${range}` : defaultLabel(row)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text == null) return;
        const next = commitSpinInput(row.def, row.value, text);
        if (next !== undefined) set(next);
        setText(null);
      }}
    />
  );
}

/** 文字の欄と、ファイルを選ぶ画面。選ぶ画面を開けなければ、そう言って文字の欄へ誘う */
function FilenameInput(props: { row: OptionRow; set: (value: string | null) => void }) {
  const { row, set } = props;
  const [pickError, setPickError] = useState<string | null>(null);
  return (
    <>
      <div className="presetDialog__inputRow">
        <SInput
          value={row.value ?? ""}
          placeholder={defaultLabel(row)}
          onChange={(e) => set(e.target.value === "" ? null : e.target.value)}
        />
        <Button
          size="sm"
          onClick={() => {
            setPickError(null);
            pickFile(`${row.def.name} のファイルを選択`).then(
              (path) => {
                if (path) set(path);
              },
              (e: unknown) =>
                setPickError(
                  `ファイルを選ぶ画面を開けませんでした（${String(e)}）。欄にパスを直接入力してください`,
                ),
            );
          }}
        >
          選択…
        </Button>
      </div>
      {pickError && (
        <div className="presetDialog__hintWarn" role="alert">
          {pickError}
        </div>
      )}
    </>
  );
}

/**
 * エンジンが申告した全部のオプション（`optionRows`）。**定義を取得したエンジンのときだけ**欄を出す。
 * 値を持たない欄はエンジン既定（送らない）。アプリが決める名前は読み取り専用
 */
export default function UsiOptionsSection(props: {
  draft: EnginePreset;
  setOpt: (name: string, value: string | null) => void;
  /** 挙げた名前の値を消す（エンジン既定に戻す） */
  clearOptions: (names: string[]) => void;
}) {
  const { draft, setOpt, clearOptions } = props;
  const [query, setQuery] = useState("");
  const all = optionRows(draft);
  const rows = optionRows(draft, query);
  // 戻せるのは、画面に出ていて値を持つ編集できる行だけ
  const clearable = rows.filter((r) => !r.reserved && r.value != null).map((r) => r.def.name);

  if (all.length === 0) return null;

  return (
    <SSection
      title="すべてのオプション"
      description="エンジンが申告した全部の欄（MultiPV / Threads / USI_Hash は上の重要オプション）。値の無い欄は送らず、エンジンが自分の既定で動きます。"
    >
      <details className="presetDialog__details">
        <summary className="presetDialog__summary">
          {all.length} 件（既定と違う値 {all.filter((r) => r.changed).length} 件）
        </summary>
        <div className="presetDialog__detailsBody">
          <div className="presetDialog__inputRow presetDialog__searchRow">
            <SInput
              value={query}
              placeholder="名前で絞り込む"
              aria-label="オプションを名前で絞り込む"
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button
              size="sm"
              onClick={() => clearOptions(clearable)}
              disabled={clearable.length === 0}
            >
              {query.trim()
                ? `表示中の ${clearable.length} 件をエンジン既定に戻す`
                : `${clearable.length} 件をエンジン既定に戻す`}
            </Button>
          </div>

          <div className="presetDialog__stack">
            {rows.map((row) => (
              <SField
                key={row.def.name}
                label={row.def.name}
                right={
                  row.changed ? <SettingsBadge tone="accent">既定と違う</SettingsBadge> : undefined
                }
                description={row.reserved ? RESERVED_NOTE : undefined}
              >
                {!row.reserved && <OptionInput row={row} setOpt={setOpt} />}
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
