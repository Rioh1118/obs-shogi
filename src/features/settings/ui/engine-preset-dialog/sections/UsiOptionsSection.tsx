import { useMemo, useState } from "react";
import SSection from "../../kit/SSection";
import SInput from "../../kit/SInput";
import SButton from "../../kit/SButton";
import OptionRow from "../../usi-option-inputs/OptionRow";
import CheckInput from "../../usi-option-inputs/CheckInput";
import SpinInput from "../../usi-option-inputs/SpinInput";
import ComboInput from "../../usi-option-inputs/ComboInput";
import StringInput from "../../usi-option-inputs/StringInput";
import FilenameInput from "../../usi-option-inputs/FilenameInput";
import ThreadsAugment from "../../usi-option-inputs/ThreadsAugment";
import HashAugment from "../../usi-option-inputs/HashAugment";
import { useEngineOptions } from "@/entities/engine-options";
import type { EngineOption } from "@/entities/engine/api/rust-types";

import "./UsiOptionsSection.scss";

interface UsiOptionsSectionProps {
  enginePath: string | null;
  options: Record<string, string>;
  setOpt: (key: string, value: string) => void;
  onResetAll: () => void;
}

const SIMPLE_MODE_NAMES = ["MultiPV", "Threads", "USI_Hash"];

function inputFor(
  option: EngineOption,
  currentValue: string | undefined,
  onChange: (v: string) => void,
) {
  const ot = option.option_type;
  if (ot.Check)
    return <CheckInput option={option} currentValue={currentValue} onChange={onChange} />;
  if (ot.Spin) return <SpinInput option={option} currentValue={currentValue} onChange={onChange} />;
  if (ot.Combo)
    return <ComboInput option={option} currentValue={currentValue} onChange={onChange} />;
  if (ot.String)
    return <StringInput option={option} currentValue={currentValue} onChange={onChange} />;
  if (ot.Filename)
    return <FilenameInput option={option} currentValue={currentValue} onChange={onChange} />;
  // Button は preset 編集の文脈では中身がないので描画しない（呼び元で skip）
  return null;
}

function augmentFor(
  name: string,
  currentValue: string | undefined,
  defaultValue: string | undefined,
) {
  if (name === "Threads") {
    return <ThreadsAugment currentValue={currentValue} defaultValue={defaultValue} />;
  }
  if (name === "USI_Hash") {
    return <HashAugment currentValue={currentValue} defaultValue={defaultValue} />;
  }
  return null;
}

export default function UsiOptionsSection({
  enginePath,
  options,
  setOpt,
  onResetAll,
}: UsiOptionsSectionProps) {
  const { options: engineOptions, isLoading, error, rescan } = useEngineOptions(enginePath);
  const [detailMode, setDetailMode] = useState(false);
  const [search, setSearch] = useState("");

  const visibleOptions = useMemo<EngineOption[]>(() => {
    if (!engineOptions) return [];

    // Button は常に除外
    const usable = engineOptions.filter((o) => !o.option_type.Button);

    if (!detailMode) {
      // シンプル: MultiPV / Threads / USI_Hash の固定順
      const byName = new Map(usable.map((o) => [o.name, o]));
      return SIMPLE_MODE_NAMES.map((n) => byName.get(n)).filter((o): o is EngineOption => !!o);
    }

    // 詳細: エンジン申告順 + 検索フィルタ
    const q = search.trim().toLowerCase();
    if (!q) return usable;
    return usable.filter((o) => o.name.toLowerCase().includes(q));
  }, [engineOptions, detailMode, search]);

  return (
    <SSection
      title="USI オプション"
      description="エンジンが申告するオプションを直接編集します。シンプルでは MultiPV / Threads / USI_Hash のみ。"
    >
      <div className="usiOptSection">
        {!enginePath && (
          <div className="usiOptSection__placeholder">エンジンを選択してください。</div>
        )}

        {enginePath && (
          <>
            <div className="usiOptSection__toolbar">
              <label className="usiOptSection__toggle">
                <input
                  type="checkbox"
                  checked={detailMode}
                  onChange={(e) => setDetailMode(e.target.checked)}
                />
                <span>詳細</span>
              </label>

              {detailMode && (
                <>
                  <SInput
                    type="search"
                    placeholder="オプション名で検索"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="usiOptSection__search"
                  />
                  <SButton
                    variant="ghost"
                    size="sm"
                    onClick={rescan}
                    disabled={isLoading}
                    isLoading={isLoading}
                  >
                    再スキャン
                  </SButton>
                </>
              )}

              <SButton
                variant="ghost"
                size="sm"
                onClick={onResetAll}
                className="usiOptSection__resetAll"
              >
                すべて既定に戻す
              </SButton>
            </div>

            {isLoading && !engineOptions && (
              <div className="usiOptSection__status">エンジンを起動して option を取得中…</div>
            )}

            {error && (
              <div className="usiOptSection__error">オプションの取得に失敗しました: {error}</div>
            )}

            {engineOptions && visibleOptions.length === 0 && (
              <div className="usiOptSection__status">
                {detailMode && search
                  ? "該当するオプションがありません。"
                  : "オプションがありません。"}
              </div>
            )}

            <div className="usiOptSection__list">
              {visibleOptions.map((opt) => {
                const current = options[opt.name];
                const isOverridden = current !== undefined && current !== opt.default_value;
                return (
                  <OptionRow
                    key={opt.name}
                    name={opt.name}
                    defaultValue={opt.default_value}
                    isOverridden={isOverridden}
                    control={inputFor(opt, current, (v) => setOpt(opt.name, v))}
                    augment={augmentFor(opt.name, current, opt.default_value)}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </SSection>
  );
}
