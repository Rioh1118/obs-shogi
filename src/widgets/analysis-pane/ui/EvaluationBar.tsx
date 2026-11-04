import "./EvaluationBar.scss";

/** 先手の側を左から `percentage` の幅で塗る帯。置き場と寸法は呼び手が持つ */
function EvaluationBar({ percentage }: { percentage: number }) {
  const clampedPercentage = Math.max(0, Math.min(100, percentage));

  return (
    <div className="evaluation-bar">
      <div
        className="evaluation-bar__side evaluation-bar__side--black"
        style={{ width: `${clampedPercentage}%` }}
      />
      <div className="evaluation-bar__center-line" />
      <div
        className="evaluation-bar__side evaluation-bar__side--white"
        style={{ width: `${100 - clampedPercentage}%` }}
      />
    </div>
  );
}

export default EvaluationBar;
