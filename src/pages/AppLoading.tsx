import "./AppLoading.scss";
import Icon from "@/assets/icon.svg";
import FolderSelect from "./FolderSelect";
import { Navigate } from "react-router";
import { useAppConfig } from "@/entities/app-config";

function AppLoading() {
  const { config, isLoading, error } = useAppConfig();

  if (isLoading)
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

  if (error) {
    return <div>起動エラー: {error}</div>;
  }

  return config?.root_dir ? <Navigate replace to="/app" /> : <FolderSelect />;
}

export default AppLoading;
