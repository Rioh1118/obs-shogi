import type { Dispatch, SetStateAction } from "react";

import { SField, SInput, SRadioGroup, SSection } from "../../kit";
import { parseIntSafe } from "@/features/settings/lib/presetDialog";
import type { EnginePreset, AnalysisDefaults } from "@/entities/engine-presets/model/types";
import type { AnalysisMode } from "@/entities/engine/api/rust-types";

const MODE_OPTIONS: Array<{ value: AnalysisMode; label: string; description: string }> = [
  { value: "infinite", label: "∞ 無限", description: "外部 Stop を待つまで思考し続ける" },
  { value: "time", label: "時間", description: "byoyomi (ms) を engine に渡す" },
  { value: "depth", label: "深さ", description: "rank1 が指定 depth に到達したら Stop" },
  { value: "nodes", label: "ノード", description: "rank1 が指定 nodes に到達したら Stop" },
  { value: "mate", label: "詰", description: "go mate / mate infinite を engine に渡す" },
];

function mergeAnalysis(
  prev: AnalysisDefaults | undefined,
  patch: Partial<AnalysisDefaults>,
): AnalysisDefaults {
  const base: AnalysisDefaults = prev ?? { mode: "infinite", mateSearch: false };
  const next: AnalysisDefaults = { ...base, ...patch };
  next.mateSearch = next.mode === "mate";
  return next;
}

export default function AnalysisDefaultsSection(props: {
  draft: EnginePreset;
  setDraft: Dispatch<SetStateAction<EnginePreset | null>>;
}) {
  const { draft, setDraft } = props;
  const mode: AnalysisMode = draft.analysis?.mode ?? "infinite";

  const setAnalysis = (patch: Partial<AnalysisDefaults>) => {
    setDraft({
      ...draft,
      analysis: mergeAnalysis(draft.analysis, patch),
    });
  };

  return (
    <SSection
      title="解析デフォルト"
      description="このプリセットで解析開始した時の go コマンドを決めます"
    >
      <SField
        label="モード"
        description="go コマンドの形を決める。値は各モードのフィールドが保持します"
      >
        <SRadioGroup
          name="analysis-mode"
          layout="grid"
          columns={5}
          value={mode}
          onChange={(v) => setAnalysis({ mode: v as AnalysisMode })}
          options={MODE_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
            description: o.description,
          }))}
        />
      </SField>

      <div className="presetDialog__grid3">
        <SField label="Time (sec)" description={mode === "time" ? "アクティブ" : "保持のみ"}>
          <SInput
            type="number"
            min={0}
            disabled={mode !== "time"}
            value={draft.analysis?.timeSeconds ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const n = v === "" ? undefined : parseIntSafe(v, 0);
              setAnalysis({ timeSeconds: n });
            }}
          />
        </SField>

        <SField label="Depth" description={mode === "depth" ? "アクティブ" : "保持のみ"}>
          <SInput
            type="number"
            min={0}
            disabled={mode !== "depth"}
            value={draft.analysis?.depth ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const n = v === "" ? undefined : parseIntSafe(v, 0);
              setAnalysis({ depth: n });
            }}
          />
        </SField>

        <SField label="Nodes" description={mode === "nodes" ? "アクティブ" : "保持のみ"}>
          <SInput
            type="number"
            min={0}
            disabled={mode !== "nodes"}
            value={draft.analysis?.nodes ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const n = v === "" ? undefined : parseIntSafe(v, 0);
              setAnalysis({ nodes: n });
            }}
          />
        </SField>
      </div>

      <SField
        label="Mate timeout (sec)"
        description={
          mode === "mate"
            ? "0 / 空 で `go mate infinite`、それ以外は `go mate <ms>`"
            : "保持のみ（Time フィールドを共有）"
        }
      >
        <SInput
          type="number"
          min={0}
          disabled={mode !== "mate"}
          value={draft.analysis?.timeSeconds ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            const n = v === "" ? undefined : parseIntSafe(v, 0);
            setAnalysis({ timeSeconds: n });
          }}
        />
      </SField>
    </SSection>
  );
}
