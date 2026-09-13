import "./StatsSection.scss";

interface StatsSectionProps {
  searchStats: {
    depth?: number | null;
    nodes?: number | null;
    time_ms?: number | null;
  } | null;
}

/** 数の無い欄。**行ごと消さない** —— 欄が増減すると隣の欄の位置が動く */
const UNKNOWN = "—";

/** `1,234,567 → 1.2M` */
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatTime(timeMs: number): string {
  const seconds = timeMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;

  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

/**
 * 探索の脚注。**欄はいつも同じ数だけ出す。**
 *
 * 結果が無い回に欄を減らすと、届いた瞬間に脚注の幅が変わって隣の数字が飛ぶ。
 * 値が無いことは `—` で言う。
 *
 * **`0` を「無い」と読まない。** `depth: 0`・`nodes: 0` は
 * 「まだ1手も読んでいない」という結果で、届いていないこととは別。
 *
 * NPS は `nodes` と `time_ms` から導く。**エンジンの申告は使えない** ——
 * `AnalysisCandidate`（`src-tauri/src/engine/types.rs`）に欄が無い。
 * seldepth と hashfull は導きようが無く、その手前で #380 が塞いでいる → #563 の関連
 */
function StatsSection({ searchStats }: StatsSectionProps) {
  const depth = searchStats?.depth ?? null;
  const nodes = searchStats?.nodes ?? null;
  const timeMs = searchStats?.time_ms ?? null;

  const nps = nodes !== null && timeMs !== null && timeMs > 0 ? (nodes / timeMs) * 1000 : null;

  const items: { label: string; value: string }[] = [
    { label: "深度", value: depth !== null ? String(depth) : UNKNOWN },
    { label: "探索局面", value: nodes !== null ? formatCount(nodes) : UNKNOWN },
    { label: "NPS", value: nps !== null ? formatCount(Math.round(nps)) : UNKNOWN },
    { label: "時間", value: timeMs !== null ? formatTime(timeMs) : UNKNOWN },
  ];

  return (
    <div className="stats-section">
      {items.map((item) => (
        <div key={item.label} className="stats-section__item">
          <span className="stats-section__label">{item.label}</span>
          <span className="stats-section__value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

export default StatsSection;
