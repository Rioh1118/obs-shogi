import { useState, type Dispatch, type SetStateAction } from "react";

import Button from "@/shared/ui/Button/Button";
import { SField, SInput, SSection } from "@/features/settings/ui/kit";
import { cx, parseIntSafe } from "@/features/settings/lib/presetDialog";
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
 * 解析をどう回すか。候補手の数（エンジンへは `MultiPV` として送る）と、止める条件。
 *
 * 候補手の数は値が無ければ初期値（送らない）。止める条件は保存するが、解析はまだ読まない（#107）
 */
export default function AnalysisSection(props: {
  draft: EnginePreset;
  setDraft: Dispatch<SetStateAction<EnginePreset | null>>;
  /** `null` で値を消す（初期値。送らない） */
  setOpt: (name: string, value: string | null) => void;
  /** 候補手の数の上限（`multiPvMax`） */
  multiPvMax: number;
}) {
  const { draft, setDraft, setOpt, multiPvMax } = props;
  const multiPv = savedInt(draft.options, MULTIPV_OPTION);
  const multiPvDefault = engineDefaultOf(draft, MULTIPV_OPTION);
  const quick = QUICK_MULTIPV.filter((n) => n <= multiPvMax);
  // 利用者が開いたか、値がどのボタンにも無いときに開く（値から導く。ボタンに無い値が画面から消えない）
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
    <SSection title="解析">
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
            {/* ボタンに無い値の間は閉じられない（閉じると値が画面から消える）ので押せなくする */}
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
              aria-label="候補手の数（数で入れる）"
              // 空にしたら初期値（1 を入れない）
              onChange={(e) =>
                e.target.value.trim() === ""
                  ? setOpt(MULTIPV_OPTION, null)
                  : setMultiPv(parseIntSafe(e.target.value, MULTIPV_MIN))
              }
            />
          )}
        </SField>

        <SField
          label="止める条件"
          description="保存はしますが、解析はまだこの条件で止まりません（いまは止めるまで読み続けます）"
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
            checked={Boolean(draft.analysis?.mateSearch)}
            onChange={(e) => setAnalysis({ mateSearch: e.target.checked })}
          />
          <span className="presetDialog__checkLabel">詰み探索</span>
        </label>
      </div>
    </SSection>
  );
}
