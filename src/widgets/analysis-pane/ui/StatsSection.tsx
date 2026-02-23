import "./StatsSection.scss";

interface StatsSectionProps {
  searchStats: {
    depth?: number | null;
    nodes?: number | null;
    time_ms?: number | null;
  } | null;
}

function StatsSection({ searchStats }: StatsSectionProps) {
  // ノード数を読みやすい形式に変換（1,234,567 → 1.2M）
  const formatNodes = (nodes: number): string => {
    if (nodes >= 1_000_000) {
      return `${(nodes / 1_000_000).toFixed(1)}M`;
    } else if (nodes >= 1_000) {
      return `${(nodes / 1_000).toFixed(1)}K`;
    } else {
      return nodes.toString();
    }
  };

  // 時間を読みやすい形式に変換（ms → 秒）
  const formatTime = (timeMs: number): string => {
    const seconds = timeMs / 1000;
    if (seconds >= 60) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = Math.floor(seconds % 60);
      return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
    } else {
      return `${seconds.toFixed(1)}s`;
    }
  };

  if (!searchStats) {
    return (
      <section className="stats-section">
        <div className="stats-section__item">
          <span className="stats-section__item--label">深度:</span>
          <span className="stats-section__item--value">-</span>
        </div>
        <div className="stats-section__item">
          <span className="stats-section__item--label">探索局面:</span>
          <span className="stats-section__item--value">-</span>
        </div>
      </section>
    );
  }

  return (
    <div className="stats-section">
      <div className="stats-section__item">
        <span className="stats-section__label">深度:</span>
        <span className="stats-section__value">
          {searchStats.depth ? `${searchStats.depth}` : "-"}
        </span>
      </div>

      <div className="stats-section__item">
        <span className="stats-section__label">探索局面:</span>
        <span className="stats-section__value">
          {searchStats.nodes ? formatNodes(searchStats.nodes) : "-"}
        </span>
      </div>

      <div className="stats-section__item">
        <span className="stats-section__label">時間:</span>
        <span className="stats-section__value">
          {searchStats.time_ms ? formatTime(searchStats.time_ms) : "-"}
        </span>
      </div>
    </div>
  );
}

export default StatsSection;
