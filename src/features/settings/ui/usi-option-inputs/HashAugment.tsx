import "./Augment.scss";

interface HashAugmentProps {
  currentValue: string | undefined;
  defaultValue: string | undefined;
}

function safeInt(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

const LARGE_THRESHOLD_MB = 8192;

export default function HashAugment({ currentValue, defaultValue }: HashAugmentProps) {
  const value = safeInt(currentValue) ?? safeInt(defaultValue);
  if (value === null) return null;

  const isLarge = value >= LARGE_THRESHOLD_MB;

  return (
    <div className="usiOptAug">
      <div className="usiOptAug__line">
        <span className="usiOptAug__label">推定使用 RAM</span>
        <span className="usiOptAug__num">{value} MB</span>
      </div>
      {isLarge && (
        <div className="usiOptAug__warn">
          大きめの値です。空き RAM を超えないか確認してください。
        </div>
      )}
    </div>
  );
}
