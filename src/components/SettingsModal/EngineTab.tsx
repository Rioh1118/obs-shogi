import type { EngineCandidate } from "@/commands/ai_library";

type Props = {
  engines: EngineCandidate[];
  selected: string | null | undefined;
  onSelect: (entry: string | null) => void;
  enginesDir: string | null;
};

export default function EngineTab({
  engines,
  selected,
  onSelect,
  enginesDir,
}: Props) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div>
        <h3 style={{ margin: 0 }}>エンジン</h3>
        <p style={{ margin: "6px 0 0", opacity: 0.8 }}>
          {enginesDir ? (
            <>
              <code>{enginesDir}</code> 配下の候補から選びます。
            </>
          ) : (
            <>ai_root/engines 配下の候補から選びます。</>
          )}
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ opacity: 0.8 }}>選択中:</span>
        <code>{selected ?? "(未選択)"}</code>
        <button onClick={() => onSelect(null)} disabled={!selected}>
          解除
        </button>
      </div>

      {engines.length === 0 ? (
        <div style={{ opacity: 0.8 }}>
          engines/ の中に候補がありません（空です）。
        </div>
      ) : (
        <div style={{ border: "1px solid #333", borderRadius: 8 }}>
          {engines.map((e) => {
            const isSelected = e.entry === selected;
            return (
              <button
                key={e.entry}
                onClick={() => onSelect(e.entry)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  background: isSelected ? "rgba(255,255,255,0.08)" : "none",
                  cursor: "pointer",
                  display: "grid",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <strong>{e.entry}</strong>
                  <span style={{ opacity: 0.7, fontSize: 12 }}>{e.kind}</span>
                </div>
                <div style={{ opacity: 0.6, fontSize: 12 }}>
                  <code>{e.path}</code>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ opacity: 0.75, fontSize: 12 }}>
        ※ 候補一覧は <code>scanAiRoot</code> の結果です。最終的な起動可否は{" "}
        <code>checkEngineSetup</code> が決めます。
      </div>
    </div>
  );
}
