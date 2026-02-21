import { useAppConfig } from "@/contexts/AppConfigContext";
import "./AppLoading.scss";
import Icon from "@/assets/icon.svg";
import FolderSelect from "./FolderSelect";
import { Navigate } from "react-router";

function AppLoading() {
  const { config, isLoading, error } = useAppConfig();

  if (isLoading)
    return (
      <div
        className="loading loading__container"
        role="status"
        aria-live="polite"
      >
        <div className="loading__backdrop" aria-hidden="true" />

        <div className="loading__panel">
          <div className="loading__brand">
            <div className="loading__iconWrap" aria-hidden="true">
              <img className="loading__icon" src={Icon} alt="" />
              <span className="loading__iconGlow" />
            </div>

            <div className="loading__titles">
              <h1 className="loading__appName">ObsShogi</h1>
              <p className="loading__tagline">研究定跡を、静かに磨く。</p>
            </div>
          </div>

          <div className="loading__divider" aria-hidden="true" />

          <p className="loading__text">
            <span className="loading__text--wave" aria-hidden="true">
              <span>A</span>
              <span>p</span>
              <span>p</span>
              <span>&nbsp;</span>
              <span>L</span>
              <span>o</span>
              <span>a</span>
              <span>d</span>
              <span>i</span>
              <span>n</span>
              <span>g</span>
            </span>

            <span className="loading__text--dots" aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>

            <span className="loading__srOnly">App Loading</span>
          </p>

          <div className="loading__hint">
            <span className="loading__pill">openings</span>
            <span className="loading__pill">notes</span>
            <span className="loading__pill">sync</span>
          </div>
        </div>
      </div>
    );

  if (error) {
    return <div>起動エラー: {error}</div>;
  }

  return config?.root_dir ? <Navigate replace to="/app" /> : <FolderSelect />;
}

export default AppLoading;
