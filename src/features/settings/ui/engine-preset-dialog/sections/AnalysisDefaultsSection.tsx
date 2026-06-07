import type { Dispatch, SetStateAction } from "react";

import { SField, SInput, SRadioGroup, SSection } from "../../kit";
import { parseIntSafe } from "@/features/settings/lib/presetDialog";
import type { EnginePreset, AnalysisDefaults } from "@/entities/engine-presets/model/types";
import type { AnalysisMode } from "@/entities/engine/api/rust-types";

const MODE_OPTIONS: Array<{ value: AnalysisMode; label: string; description: string }> = [
  { value: "infinite", label: "∞ 無限", description: "停止操作するまで思考し続ける" },
  { value: "time", label: "時間", description: "指定した秒数で打ち切る" },
  { value: "depth", label: "深さ", description: "最善手の読み深さが指定値に達したら打ち切る" },
  { value: "nodes", label: "ノード", description: "探索ノード数が指定値に達したら打ち切る" },
  { value: "mate", label: "詰", description: "詰み探索を行う" },
];

function mergeAnalysis(
  prev: AnalysisDefaults | undefined,
  patch: Partial<AnalysisDefaults>,
): AnalysisDefaults {
  const base: AnalysisDefaults = prev ?? { mode: "infinite" };
  return { ...base, ...patch };
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
      description="このプリセットで解析を開始したときの停止条件を決めます"
    >
      <SField
        label="モード"
        description="停止条件を選びます。各モード固有の値 (時間/深さ/ノード数) は下のフィールドで指定します"
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
            max={3600}
            placeholder="未指定なら 30s"
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
            max={999}
            placeholder="未指定なら 20"
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
            max={999_999_999}
            placeholder="未指定なら 100,000,000"
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
    </SSection>
  );
}
