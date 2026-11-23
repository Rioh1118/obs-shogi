import { useState } from "react";

import { useAppConfig, type MateSearchConfigPatch } from "@/entities/app-config";
import type { EnginePreset } from "@/entities/engine-presets";
import { MATE_SEARCH_LIMITS, resolveMateSearchLimit } from "@/entities/mate-search";
import { SField, SSection, SSelect } from "@/features/settings/ui/kit";
import SRadioGroup from "@/features/settings/ui/kit/SRadioGroup";
import InlineNotice from "@/shared/ui/notification/InlineNotice";

/** 「詰み探索」の節。使うプリセットと上限時間を決める */
export default function MateSearchSection({ presets }: { presets: EnginePreset[] }) {
  const { config, setMateSearchConfig } = useAppConfig();
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: MateSearchConfigPatch) => {
    const result = await setMateSearchConfig(patch);
    setError(result.success ? null : result.error);
  };

  // 消したプリセットの ID が残っていれば「指定しない」に見せる。詰み探索のボタンも押せない
  const presetId = presets.some((p) => p.id === config?.mate_preset_id)
    ? (config?.mate_preset_id ?? "")
    : "";

  return (
    <SSection title="詰み探索" description="検討ペインの「詰み探索」で使うエンジンと時間です。">
      {error && (
        <InlineNotice
          tier="warning"
          title="詰み探索の設定を保存できませんでした"
          body={`もう一度選択してください（${error}）。`}
        />
      )}
      <div className="engineTab__mate">
        <SField label="詰み探索に使う" inline>
          <SSelect
            value={presetId}
            aria-label="詰み探索に使うプリセット"
            onChange={(e) => void save({ mate_preset_id: e.target.value || null })}
            options={[
              { value: "", label: "指定しない" },
              ...presets.map((p) => ({ value: p.id, label: p.label })),
            ]}
          />
        </SField>
        <SField label="上限時間" inline>
          <SRadioGroup
            name="mate-search-limit"
            layout="segment"
            value={resolveMateSearchLimit(config?.mate_search_limit).key}
            onChange={(key) => void save({ mate_search_limit: key })}
            options={MATE_SEARCH_LIMITS.map(({ key, label }) => ({ value: key, label }))}
          />
        </SField>
      </div>
      {presetId === "" && (
        <p className="engineTab__note">詰将棋エンジンのプリセットを選択してください。</p>
      )}
    </SSection>
  );
}
