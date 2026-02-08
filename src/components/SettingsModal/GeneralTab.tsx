type Props = {
  aiRoot: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onChooseAiRoot: () => Promise<string | null>;
  onClearAiRoot: () => Promise<void>;
};

export default function GeneralTab(props: Props) {
  const { aiRoot, loading, error, onRefresh, onChooseAiRoot, onClearAiRoot } =
    props;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <div>ai_root（AIライブラリ）:</div>
          <div style={{ opacity: 0.8 }}>{aiRoot ?? "(未設定)"}</div>
        </div>

        <button disabled={loading} onClick={onChooseAiRoot}>
          フォルダを選択
        </button>
        <button disabled={loading || !aiRoot} onClick={onClearAiRoot}>
          解除
        </button>
        <button disabled={loading} onClick={onRefresh}>
          再読込
        </button>
      </div>

      {error && <p style={{ color: "tomato", margin: 0 }}>{error}</p>}

      <div style={{ opacity: 0.75, fontSize: 12 }}>
        期待する構成:
        <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>
          {`ai_root/
  engines/
    <engine files...>
  <profile name>/
    eval/nn.bin
    book/<some>.db`}
        </pre>
      </div>
    </div>
  );
}
