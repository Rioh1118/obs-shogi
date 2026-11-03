import { useState } from "react";

import { hasCurrentDefinitions } from "@/entities/engine-presets/lib/withDefinitions";
import { bookInUse, type EnginePreset } from "@/entities/engine-presets/model/types";
import { fitNoteLines, type FitNote } from "@/features/settings/lib/fitNote";
import { optionRows } from "@/features/settings/lib/optionRows";
import { SInput, SSection } from "@/features/settings/ui/kit";
import Button from "@/shared/ui/Button/Button";
import EngineOptionInput from "./EngineOptionInput";

type Props = {
  draft: EnginePreset;
  setOption: (name: string, value: string | null) => void;
  /** 挙げた名前の値を消す */
  clearOptions: (names: string[]) => void;
  probing: boolean;
  fitNote: FitNote | null;
};

/**
 * 「エンジン設定」の節。エンジンが申告したオプションを1つのリストで編集する。
 * いまのエンジンの定義が無いあいだは行を出さない。読めない理由はエンジンの欄の下に出る。
 */
export default function EngineSettingsSection({
  draft,
  setOption,
  clearOptions,
  probing,
  fitNote,
}: Props) {
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);

  if (!hasCurrentDefinitions(draft)) {
    return (
      <SSection title="エンジン設定">
        <div className="presetDialog__hintMuted">
          {probing
            ? "読み込みが終わると、ここに設定が並びます"
            : draft.enginePath
              ? "エンジンを読み込めると、ここに設定が並びます"
              : "エンジンを選択すると、ここに設定が並びます"}
        </div>
      </SSection>
    );
  }

  const bookUsed = bookInUse(draft);
  const rows = optionRows(draft, { query, changedOnly, bookUsed });
  const total = optionRows(draft, { bookUsed }).length;
  // 絞り込みで見えない行は消さない
  const clearable = rows.filter((r) => r.value != null).map((r) => r.def.name);
  const fitLines = fitNoteLines(fitNote, draft.enginePath);

  return (
    <SSection title="エンジン設定" description="空欄は初期値のままで、エンジンへは送りません。">
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
            placeholder={`項目を検索（全 ${total} 件）`}
            aria-label="エンジン設定を検索"
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
              <EngineOptionInput row={row} setOption={setOption} />
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
