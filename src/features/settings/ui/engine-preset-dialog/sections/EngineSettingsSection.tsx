import { useState } from "react";

import Button from "@/shared/ui/Button/Button";
import { pickFile } from "@/shared/api/picker/pickFile";
import { SInput, SSection, SSelect } from "@/features/settings/ui/kit";
import { commitSpinInput } from "@/features/settings/lib/spinInput";
import { engineDefaultLabel } from "@/features/settings/lib/quickOptions";
import { optionRows, type OptionRow } from "@/features/settings/lib/optionRows";
import { fitNoteLines, type FitNote } from "@/features/settings/lib/fitNote";
import { hasCurrentDefinitions } from "@/entities/engine-presets/lib/withDefinitions";
import { bookInUse, type EnginePreset } from "@/entities/engine-presets/model/types";

/** check の既定値の表示 */
function onOff(v: string | null): string {
  return v === "true" ? "ON" : v === "false" ? "OFF" : (v ?? "");
}

function defaultLabel(row: OptionRow): string {
  return engineDefaultLabel(
    (row.def.type === "check" ? onOff(row.defaultText) : row.defaultText) || null,
  );
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
  // 1つの箱に入れる。行は名前と入力の2列の grid なので、子を並べて返すと失敗の文言が名前の列へ回る
  return (
    <div>
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
    </div>
  );
}

/**
 * エンジンの設定（エンジンが申告したオプション）。**1つのリスト**: 先頭にスレッド数とハッシュ、続けて申告の順
 * （`optionRows`）。名前は日本語（辞書に無ければエンジンの綴り）で、綴りを下に小さく添える。
 *
 * 定義が無いあいだ（読み込み中・読めなかった）は行を出さない。読めない理由はエンジンの欄の下に出る
 */
export default function EngineSettingsSection(props: {
  draft: EnginePreset;
  setOpt: (name: string, value: string | null) => void;
  /** 挙げた名前の値を消す（初期値に戻す） */
  clearOptions: (names: string[]) => void;
  probing: boolean;
  /** 読み込んだ定義に当てて変えた値 */
  fitNote: FitNote | null;
}) {
  const { draft, setOpt, clearOptions, probing, fitNote } = props;
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const bookUsed = bookInUse(draft);
  const rows = optionRows(draft, { query, changedOnly, bookUsed });
  const total = optionRows(draft, { bookUsed }).length;
  // 戻せるのは、画面に出ていて値を持つ行だけ（絞り込みで見えない行は消さない）
  const clearable = rows.filter((r) => r.value != null).map((r) => r.def.name);
  const fitLines = fitNoteLines(fitNote, draft.enginePath);

  if (!hasCurrentDefinitions(draft)) {
    return (
      <SSection title="エンジンの設定">
        <div className="presetDialog__hintMuted">
          {probing
            ? "読み込みが終わると、ここに設定が並びます"
            : draft.enginePath
              ? "エンジンを読み込めると、ここに設定が並びます"
              : "エンジンを選ぶと、ここに設定が並びます"}
        </div>
      </SSection>
    );
  }

  return (
    <SSection title="エンジンの設定" description="空欄は初期値のままで、エンジンへは送りません。">
      <div className="presetDialog__stack">
        {fitLines.length > 0 && (
          <details className="presetDialog__details">
            <summary className="presetDialog__summary">
              このエンジンに合わせて {fitLines.length} 件の値を変えました（保存すると確定します）
            </summary>
            <ul className="presetDialog__detailsBody">
              {fitLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        )}

        <div className="presetDialog__inputRow">
          <SInput
            value={query}
            placeholder={`項目を探す（全 ${total} 件）`}
            aria-label="エンジンの設定を探す"
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button size="sm" aria-pressed={changedOnly} onClick={() => setChangedOnly(!changedOnly)}>
            {changedOnly ? "すべて表示" : "変えた値だけ"}
          </Button>
          <Button
            size="sm"
            onClick={() => clearOptions(clearable)}
            disabled={clearable.length === 0}
          >
            {query.trim() || changedOnly
              ? `表示中の ${clearable.length} 件を初期値に戻す`
              : "すべて初期値に戻す"}
          </Button>
        </div>

        <div className="presetDialog__optionList">
          {rows.map((row) => (
            <div key={row.def.name} className="presetDialog__optionRow">
              <div className="presetDialog__optionName">
                <span>
                  {row.changed && <span aria-label="初期値と違う">● </span>}
                  {row.label ?? row.def.name}
                </span>
                {row.label && <span className="presetDialog__optionId">{row.def.name}</span>}
              </div>
              <OptionInput row={row} setOpt={setOpt} />
            </div>
          ))}
          {rows.length === 0 && (
            <div className="presetDialog__hintMuted">当てはまる項目はありません</div>
          )}
        </div>
      </div>
    </SSection>
  );
}
