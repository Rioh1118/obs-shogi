import "./EvaluationBar.scss";

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
