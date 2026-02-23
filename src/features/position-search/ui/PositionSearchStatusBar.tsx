import "./PositionSearchStatusBar.scss";

type Props = {
  hitsCount: number;
  statusText: string;
  stale: boolean;
  error: string | null;
};

export default function PositionSearchStatusBar({
  hitsCount,
  statusText,
  stale,
  error,
}: Props) {
  return (
    <section className="pos-search-status" aria-label="検索状態">
      <span className="pos-search-status__item">一致: {hitsCount}</span>
      <span className="pos-search-status__item">{statusText}</span>

      {stale && (
        <span className="pos-search-status__item pos-search-status__item--warn">
          インデックス更新待ち
        </span>
      )}

      {error && (
        <span className="pos-search-status__item pos-search-status__item--error">
          {error}
        </span>
      )}
    </section>
  );
}
