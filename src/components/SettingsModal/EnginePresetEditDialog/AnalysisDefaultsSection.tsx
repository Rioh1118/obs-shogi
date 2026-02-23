import type { Dispatch, SetStateAction } from "react";

import { SField, SInput, SSection } from "../ui";
import { parseIntSafe } from "@/utils/enginePresetDialog";
import type { EnginePreset } from "@/entities/engine-presets/model/types";

export default function AnalysisDefaultsSection(props: {
  draft: EnginePreset;
  setDraft: Dispatch<SetStateAction<EnginePreset | null>>;
}) {
  const { draft, setDraft } = props;

  return (
    <SSection
      title="解析デフォルト（フロント保持）"
      description="バックエンド非対応でもUI側で保持します"
    >
      <div className="presetDialog__grid3">
        <SField label="Time (sec)" description="優先: 時間">
          <SInput
            type="number"
            min={0}
            value={draft.analysis?.timeSeconds ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const n = v === "" ? undefined : parseIntSafe(v, 0);
              setDraft({
                ...draft,
                analysis: {
                  ...(draft.analysis ?? { mateSearch: false }),
                  timeSeconds: n,
                },
              });
            }}
          />
        </SField>

        <SField label="Depth" description="優先: 深さ">
          <SInput
            type="number"
            min={0}
            value={draft.analysis?.depth ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const n = v === "" ? undefined : parseIntSafe(v, 0);
              setDraft({
                ...draft,
                analysis: {
                  ...(draft.analysis ?? { mateSearch: false }),
                  depth: n,
                },
              });
            }}
          />
        </SField>

        <SField label="Nodes" description="優先: ノード数">
          <SInput
            type="number"
            min={0}
            value={draft.analysis?.nodes ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const n = v === "" ? undefined : parseIntSafe(v, 0);
              setDraft({
                ...draft,
                analysis: {
                  ...(draft.analysis ?? { mateSearch: false }),
                  nodes: n,
                },
              });
            }}
          />
        </SField>
      </div>

      <div className="presetDialog__row">
        <label className="presetDialog__check">
          <input
            type="checkbox"
            checked={Boolean(draft.analysis?.mateSearch)}
            onChange={(e) => {
              setDraft({
                ...draft,
                analysis: {
                  ...(draft.analysis ?? { mateSearch: false }),
                  mateSearch: e.target.checked,
                },
              });
            }}
          />
          <span className="presetDialog__checkLabel">
            詰み探索（フロント保持）
          </span>
        </label>
      </div>
    </SSection>
  );
}
