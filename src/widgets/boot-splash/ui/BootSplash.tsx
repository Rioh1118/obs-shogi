import "./BootSplash.scss";
import Icon from "@/assets/icon.svg";

function BootSplash() {
  return (
    <div
      className="loading loading__container"
      role="status"
      aria-live="polite"
    >
      <div className="loading__content">
        <img className="loading__icon" src={Icon} alt="ObsShogi" />

        <p className="loading__text">
          <span className="loading__label">Loading</span>
          <span className="loading__dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </p>

        <span className="loading__srOnly">Loading</span>
      </div>
    </div>
  );
}

export default BootSplash;
