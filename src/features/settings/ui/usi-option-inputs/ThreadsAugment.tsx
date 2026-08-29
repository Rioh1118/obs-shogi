import "./Augment.scss";

interface ThreadsAugmentProps {
  /** 現在 draft で設定中の値（未設定 = エンジンの default） */
  currentValue: string | undefined;
  /** エンジンが申告した default */
  defaultValue: string | undefined;
}

function safeInt(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

export default function ThreadsAugment({ currentValue, defaultValue }: ThreadsAugmentProps) {
  const cores =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : null;
  const value = safeInt(currentValue) ?? safeInt(defaultValue);

  if (value === null) return null;

  const ratio = cores ? Math.min(value / cores, 1) : null;
  const overCore = cores !== null && value > cores;

  return (
    <div className="usiOptAug">
      <div className="usiOptAug__line">
        <span className="usiOptAug__label">論理コア</span>
        <span className="usiOptAug__num">{cores ?? "?"}</span>
        <span className="usiOptAug__sep">/</span>
        <span className="usiOptAug__label">設定</span>
        <span className="usiOptAug__num">{value}</span>
      </div>
      {ratio !== null && (
        <div className="usiOptAug__bar" aria-hidden>
          <div
            className={`usiOptAug__barFill ${overCore ? "is-warn" : ""}`}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      )}
      {overCore && (
        <div className="usiOptAug__warn">論理コア数を超えています。効率低下や発熱の可能性。</div>
      )}
    </div>
  );
}
