import "./EngineLoading.scss";

function EngineLoading() {
  return (
    <div className="loading loading__container">
      <p className="loading loading__text">
        <span>E</span>
        <span>n</span>
        <span>g</span>
        <span>i</span>
        <span>n</span>
        <span>e</span>
        <span> </span>
        <span>L</span>
        <span>o</span>
        <span>a</span>
        <span>d</span>
        <span>i</span>
        <span>n</span>
        <span>g</span>
        <span className="loading loading__text--dots">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </p>
    </div>
  );
}

export default EngineLoading;
