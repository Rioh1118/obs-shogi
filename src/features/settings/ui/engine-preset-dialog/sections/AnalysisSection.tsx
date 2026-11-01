import { useState, type Dispatch, type SetStateAction } from "react";

import Button from "@/shared/ui/Button/Button";
import { SField, SInput, SSection } from "@/features/settings/ui/kit";
import { cx } from "@/features/settings/lib/cx";
import { parseIntSafe } from "@/features/settings/lib/presetDialog";
import {
  engineDefaultLabel,
  engineDefaultOf,
  savedInt,
} from "@/features/settings/lib/quickOptions";
import {
  MULTIPV_MIN,
  MULTIPV_OPTION,
  QUICK_MULTIPV,
} from "@/entities/engine-presets/model/multiPv";
import type { AnalysisDefaults, EnginePreset } from "@/entities/engine-presets/model/types";
import "./AnalysisSection.scss";

/**
 * 「検討」の節。候補手の数と終了条件と詰み探索を決める。
 * 候補手の数は値が無ければ送らない。終了条件と詰み探索は保存するが、検討はまだ読まない。
 */
export default function AnalysisSection(props: {
  draft: EnginePreset;
  setDraft: Dispatch<SetStateAction<EnginePreset | null>>;
  /** `null` で値を消す。 */
  setOpt: (name: string, value: string | null) => void;
  /** 候補手の数の上限（`multiPvMax`） */
  multiPvMax: number;
}) {
  const { draft, setDraft, setOpt, multiPvMax } = props;
  const multiPv = savedInt(draft.options, MULTIPV_OPTION);
  const multiPvDefault = engineDefaultOf(draft, MULTIPV_OPTION);
  const quick = QUICK_MULTIPV.filter((n) => n <= multiPvMax);
  // 値がどのボタンにも無いときは開いたままにする。閉じると値が画面から消える
  const [customOpened, setCustomOpened] = useState(false);
  const offButtons = multiPv != null && !(quick as number[]).includes(multiPv);
  const showCustom = customOpened || offButtons;
  const setMultiPv = (n: number) =>
    setOpt(MULTIPV_OPTION, String(Math.max(MULTIPV_MIN, Math.min(n, multiPvMax))));

  const setAnalysis = (patch: Partial<AnalysisDefaults>) =>
    setDraft({
      ...draft,
      analysis: { ...(draft.analysis ?? { mateSearch: false }), ...patch },
    });
  const numberOrUndefined = (v: string) => (v === "" ? undefined : parseIntSafe(v, 0));

  return (
    <SSection title="検討">
      <div className="presetDialog__stack">
        <SField
          label="候補手の数"
          description={
            multiPv == null
              ? `空欄なら${engineDefaultLabel(multiPvDefault)}`
              : `初期値 ${multiPvDefault ?? "—"}。増やすと 1 手あたりの読みは浅くなります`
          }
        >
          <div className="presetDialog__inputRow">
            <div className="presetDialog__seg" role="group" aria-label="候補手の数">
              {quick.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={cx("presetDialog__segBtn", multiPv === n && "is-active")}
                  aria-pressed={multiPv === n}
                  onClick={() => (multiPv === n ? setOpt(MULTIPV_OPTION, null) : setMultiPv(n))}
                >
                  {n}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => setCustomOpened(!showCustom)} disabled={offButtons}>
              ほかの数…
            </Button>
          </div>
          {showCustom && (
            <SInput
              className="presetDialog__stepperInput"
              inputMode="numeric"
              type="number"
              min={MULTIPV_MIN}
              max={multiPvMax}
              value={multiPv ?? ""}
              placeholder={multiPvDefault ?? ""}
              aria-label="候補手の数（数値で入力）"
              onChange={(e) =>
                e.target.value.trim() === ""
                  ? setOpt(MULTIPV_OPTION, null)
                  : setMultiPv(parseIntSafe(e.target.value, MULTIPV_MIN))
              }
            />
          )}
        </SField>

        <SField
          label="終了条件"
          description="保存はしますが、検討はまだこの条件で終了しません（いまは中断するまで読み続けます）"
        >
          <div className="presetDialog__grid3">
            <SInput
              type="number"
              min={0}
              placeholder="時間（秒）"
              aria-label="時間（秒）"
              value={draft.analysis?.timeSeconds ?? ""}
              onChange={(e) => setAnalysis({ timeSeconds: numberOrUndefined(e.target.value) })}
            />
            <SInput
              type="number"
              min={0}
              placeholder="深さ"
              aria-label="深さ"
              value={draft.analysis?.depth ?? ""}
              onChange={(e) => setAnalysis({ depth: numberOrUndefined(e.target.value) })}
            />
            <SInput
              type="number"
              min={0}
              placeholder="ノード数"
              aria-label="ノード数"
              value={draft.analysis?.nodes ?? ""}
              onChange={(e) => setAnalysis({ nodes: numberOrUndefined(e.target.value) })}
            />
          </div>
        </SField>

        <label className="presetDialog__check">
          <input
            type="checkbox"
            checked={draft.analysis?.mateSearch ?? false}
            onChange={(e) => setAnalysis({ mateSearch: e.target.checked })}
          />
          <span className="presetDialog__checkLabel">詰み探索</span>
        </label>
      </div>
    </SSection>
  );
}
