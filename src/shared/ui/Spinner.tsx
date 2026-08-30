import "./Spinner.scss";

/** 読み込み中。名前を持たせないと、支援技術には何も起きていないのと同じになる */
function Spinner() {
  return (
    <div className="spinnerContainer" role="status" aria-label="読み込み中">
      <div className="spinner"></div>
    </div>
  );
}

export default Spinner;
