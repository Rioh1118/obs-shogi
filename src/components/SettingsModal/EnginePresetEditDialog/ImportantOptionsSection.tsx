import type { EnginePreset } from "@/types/enginePresets";
import { DEFAULT_OPTIONS } from "@/commands/engine";
import type { SRadioOption } from "../ui/SRadioGroup";
import { SButton, SField, SInput, SRadioGroup, SSection, SSelect } from "../ui";
import {
  cx,
  HASH_CHOICES,
  MULTIPV_MAX,
  MULTIPV_MIN,
  parseIntSafe,
  QUICK_MULTIPV,
} from "@/utils/enginePresetDialog";

import "./ImportantOptionsSection.scss";
import type { HashMode, ThreadsMode } from "@/utils/engineSettings";

export default function ImportantOptionsSection(props: {
  draft: EnginePreset;
  setOpt: (k: string, v: string) => void;

  multiPv: number;
  showMultiPvCustom: boolean;
  setShowMultiPvCustom: (v: boolean) => void;
  onChangeMultiPv: (n: number) => void;

  cores: number;
  threadsMode: "auto" | "manual";
  threadsModeOptions: SRadioOption[];
  onThreadsModeChange: (m: "auto" | "manual") => void;
  threadsManual: number;
  threadChoices: number[];
  onThreadsManualChange: (n: number) => void;

  hashMode: "auto" | "manual";
  hashModeOptions: SRadioOption[];
  hashManual: number;
  onHashModeChange: (m: "auto" | "manual") => void;
  onHashManualChange: (n: number) => void;
}) {
  const {
    draft,
    setOpt,
    multiPv,
    showMultiPvCustom,
    setShowMultiPvCustom,
    onChangeMultiPv,
    cores,
    threadsMode,
    threadsModeOptions,
    onThreadsModeChange,
    threadsManual,
    threadChoices,
    onThreadsManualChange,
    hashMode,
    hashModeOptions,
    hashManual,
    onHashModeChange,
    onHashManualChange,
  } = props;

  return (
    <SSection
      title="重要オプション"
      description="研究・定跡管理では対局向けの時間調整系は基本不要です（下の折りたたみに隔離）。"
    >
      <div className="presetDialog__stack">
        {/* MultiPV */}
        <div className="presetDialog__block">
          <div className="presetDialog__blockHead">
            <div className="presetDialog__blockTitle">MultiPV（候補手数）</div>
            <div className="presetDialog__blockSub">
              候補を増やすと、1手あたりの読みは浅くなります。
            </div>
          </div>

          <div className="presetDialog__segRow">
            <div
              className="presetDialog__seg"
              role="tablist"
              aria-label="MultiPV presets"
            >
              {QUICK_MULTIPV.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={cx(
                    "presetDialog__segBtn",
                    multiPv === n && "is-active",
                  )}
                  onClick={() => onChangeMultiPv(n)}
                >
                  {n}
                </button>
              ))}
            </div>

            <SButton
              variant="ghost"
              size="sm"
              onClick={() => setShowMultiPvCustom(!showMultiPvCustom)}
              className="presetDialog__segRight"
            >
              カスタム…
            </SButton>
          </div>

          {showMultiPvCustom && (
            <div className="presetDialog__stepper">
              <SButton
                variant="ghost"
                size="sm"
                onClick={() => onChangeMultiPv(multiPv - 1)}
                disabled={multiPv <= MULTIPV_MIN}
              >
                −
              </SButton>

              <SInput
                className="presetDialog__stepperInput"
                inputMode="numeric"
                type="number"
                min={MULTIPV_MIN}
                max={MULTIPV_MAX}
                value={multiPv}
                onChange={(e) =>
                  onChangeMultiPv(parseIntSafe(e.target.value, MULTIPV_MIN))
                }
              />

              <SButton
                variant="ghost"
                size="sm"
                onClick={() => onChangeMultiPv(multiPv + 1)}
                disabled={multiPv >= MULTIPV_MAX}
              >
                ＋
              </SButton>

              <div className="presetDialog__stepperHint">
                範囲: {MULTIPV_MIN}〜{MULTIPV_MAX}
              </div>
            </div>
          )}

          {multiPv >= 2 && (
            <div className="presetDialog__hintWarn">
              注意: MultiPV を 2以上にすると棋力が低下し得ます（研究用途では “幅
              vs 深さ” の調整として有用）。
            </div>
          )}
        </div>

        {/* Threads */}
        <div className="presetDialog__block">
          <div className="presetDialog__blockHead">
            <div className="presetDialog__blockTitle">Threads（並列数）</div>
            <div className="presetDialog__blockSub">
              上げすぎると熱/騒音や効率低下の可能性があります。
            </div>
          </div>

          <SRadioGroup
            name="threadsMode"
            options={threadsModeOptions}
            value={threadsMode}
            onChange={(v) => onThreadsModeChange(v as ThreadsMode)}
            layout="list"
          />

          {threadsMode === "manual" && (
            <div className="presetDialog__inline">
              <SField
                label="手動 Threads"
                description={`最大: 論理コア数 ${cores}`}
              >
                <SSelect
                  value={String(threadsManual)}
                  onChange={(e) =>
                    onThreadsManualChange(parseIntSafe(e.target.value, 1))
                  }
                  options={threadChoices.map((n) => ({
                    value: String(n),
                    label: String(n),
                  }))}
                />
              </SField>
            </div>
          )}
        </div>

        {/* Hash */}
        <div className="presetDialog__block">
          <div className="presetDialog__blockHead">
            <div className="presetDialog__blockTitle">
              解析メモリ（USI_Hash）
            </div>
            <div className="presetDialog__blockSub">
              置換表サイズ（MB）。長時間思考で効くことがあります。
            </div>
          </div>

          <SRadioGroup
            name="hashMode"
            options={hashModeOptions}
            value={hashMode}
            onChange={(v) => onHashModeChange(v as HashMode)}
            layout="list"
          />

          {hashMode === "manual" && (
            <div className="presetDialog__inline">
              <SField
                label="手動 Hash"
                description={
                  <span>
                    推定使用RAM: <b>{hashManual}MB</b>（＋α）
                  </span>
                }
              >
                <SSelect
                  value={String(hashManual)}
                  onChange={(e) =>
                    onHashManualChange(parseIntSafe(e.target.value, 1024))
                  }
                  options={HASH_CHOICES.map((n) => ({
                    value: String(n),
                    label: `${n} MB`,
                  }))}
                />
              </SField>
            </div>
          )}
        </div>
      </div>

      <details className="presetDialog__details">
        <summary className="presetDialog__summary">対局向け（非推奨）</summary>
        <div className="presetDialog__detailsBody">
          <div className="presetDialog__grid2">
            <SField
              label="NetworkDelay"
              description="通信遅延の想定（対局向け）"
            >
              <SInput
                type="number"
                value={
                  draft.options.NetworkDelay ?? DEFAULT_OPTIONS.NetworkDelay
                }
                onChange={(e) =>
                  setOpt(
                    "NetworkDelay",
                    String(parseIntSafe(e.target.value, 0)),
                  )
                }
              />
            </SField>

            <SField label="NetworkDelay2" description="通信遅延2（対局向け）">
              <SInput
                type="number"
                value={
                  draft.options.NetworkDelay2 ?? DEFAULT_OPTIONS.NetworkDelay2
                }
                onChange={(e) =>
                  setOpt(
                    "NetworkDelay2",
                    String(parseIntSafe(e.target.value, 0)),
                  )
                }
              />
            </SField>

            <SField
              label="MinimumThinkingTime"
              description="最小思考時間（対局向け）"
            >
              <SInput
                type="number"
                value={
                  draft.options.MinimumThinkingTime ??
                  DEFAULT_OPTIONS.MinimumThinkingTime
                }
                onChange={(e) =>
                  setOpt(
                    "MinimumThinkingTime",
                    String(parseIntSafe(e.target.value, 0)),
                  )
                }
              />
            </SField>

            <SField label="SlowMover" description="秒読み配分（対局向け）">
              <SInput
                type="number"
                value={draft.options.SlowMover ?? DEFAULT_OPTIONS.SlowMover}
                onChange={(e) =>
                  setOpt("SlowMover", String(parseIntSafe(e.target.value, 0)))
                }
              />
            </SField>
          </div>

          <div className="presetDialog__hintMuted">
            研究・定跡管理アプリ（対戦なし）なら、ここは基本いじらなくてOKです。
          </div>
        </div>
      </details>
    </SSection>
  );
}
