import { useMemo, useState } from "react";
import { useEngine } from "@/contexts/EngineContext";

// よく触るものだけ。ほか全部は後で「詳細」扱いで良い
const COMMON_KEYS = ["USI_Hash", "Threads", "MultiPV", "EvalDir"] as const;

function OptionsTab() {
  const { state, mergeOptions } = useEngine();

  const current = state.desiredConfig.options ?? {};
  const [draft, setDraft] = useState<Record<string, string>>({});

  const effective = useMemo(() => ({ ...current, ...draft }), [current, draft]);

  const set = (k: string, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
  };

  const apply = () => {
    // 空文字は無視（必要なら削除の仕様を別で作る）
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(draft)) {
      const trimmed = v.trim();
      if (trimmed.length > 0) payload[k] = trimmed;
    }
    if (Object.keys(payload).length > 0) mergeOptions(payload);
    setDraft({});
  };

  const resetDraft = () => setDraft({});

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <h3 style={{ margin: 0 }}>オプション</h3>
        <p style={{ margin: "6px 0 0", opacity: 0.8 }}>
          推奨設定をベースに、必要な人だけ変更します（保存はしない想定）。
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ opacity: 0.8 }}>状態:</span>
        <code>{state.phase}</code>
        {state.needsRestart && (
          <span style={{ opacity: 0.9 }}>
            ⚠️ 反映には再起動が必要（needsRestart）
          </span>
        )}
      </div>

      <div
        style={{
          border: "1px solid #333",
          borderRadius: 8,
          padding: 12,
          display: "grid",
          gap: 10,
          maxWidth: 520,
        }}
      >
        {COMMON_KEYS.map((k) => (
          <label key={k} style={{ display: "grid", gap: 6 }}>
            <span style={{ opacity: 0.85 }}>{k}</span>
            <input
              value={effective[k] ?? ""}
              onChange={(e) => set(k, e.target.value)}
              placeholder={current[k] ?? ""}
              style={{ padding: 8 }}
            />
          </label>
        ))}

        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button onClick={apply} disabled={Object.keys(draft).length === 0}>
            変更を反映（desiredにマージ）
          </button>
          <button
            onClick={resetDraft}
            disabled={Object.keys(draft).length === 0}
          >
            入力を破棄
          </button>
        </div>
      </div>

      <details>
        <summary style={{ cursor: "pointer" }}>
          現在の desired options を表示
        </summary>
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
          {JSON.stringify(current, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export default OptionsTab;
