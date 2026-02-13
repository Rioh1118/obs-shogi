import "./OptionsTab.scss";
import { useMemo, useState } from "react";
import { useEngine } from "@/contexts/EngineContext";
import {
  SButton,
  SField,
  SInput,
  SSection,
} from "@/components/SettingsModal/ui";

// よく触るものだけ（後で増やしてOK）
const COMMON_KEYS = ["USI_Hash", "Threads", "MultiPV", "EvalDir"] as const;

export default function OptionsTab() {
  const { state, mergeOptions } = useEngine();

  const current = state.desiredConfig.options ?? {};
  const [draft, setDraft] = useState<Record<string, string>>({});

  const isDirty = Object.keys(draft).length > 0;

  const effective = useMemo(() => ({ ...current, ...draft }), [current, draft]);

  const set = (k: string, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
  };

  const buildPayload = () => {
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(draft)) {
      const trimmed = v.trim();
      if (trimmed.length > 0) payload[k] = trimmed;
    }
    return payload;
  };

  const apply = () => {
    const payload = buildPayload();
    if (Object.keys(payload).length > 0) mergeOptions(payload);
    setDraft({});
  };

  const resetDraft = () => setDraft({});

  return (
    <div className="st-options">
      <SSection
        title="オプション"
        description="推奨設定をベースに、必要な人だけ変更します（保存はしない想定）。"
        actions={
          <div className="st-options__status">
            <span className="st-options__statusItem">
              状態: <code>{state.phase}</code>
            </span>
            {state.needsRestart && (
              <span className="st-options__pill st-options__pill--warn">
                再起動が必要
              </span>
            )}
            {isDirty && <span className="st-options__pill">未適用の変更</span>}
          </div>
        }
      >
        <div className="st-options__quickGrid">
          {COMMON_KEYS.map((k) => (
            <SField
              key={k}
              label={k}
              description={
                current[k] ? (
                  <span className="st-options__descLine">
                    現在: <code>{current[k]}</code>
                  </span>
                ) : (
                  <span className="st-options__descLine">現在: (未設定)</span>
                )
              }
            >
              <SInput
                value={effective[k] ?? ""}
                onChange={(e) => set(k, e.target.value)}
                placeholder={current[k] ?? ""}
              />
            </SField>
          ))}
        </div>

        <div className="st-options__actions">
          <SButton variant="primary" onClick={apply} disabled={!isDirty}>
            変更を反映
          </SButton>
          <SButton variant="ghost" onClick={resetDraft} disabled={!isDirty}>
            入力を破棄
          </SButton>
        </div>
      </SSection>

      <SSection title="詳細">
        <details className="st-options__details">
          <summary className="st-options__summary">
            現在の desired options を表示
          </summary>
          <pre className="st-options__json">
            {JSON.stringify(current, null, 2)}
          </pre>
        </details>
      </SSection>
    </div>
  );
}
