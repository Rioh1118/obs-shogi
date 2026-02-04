import "./FolderSelect.scss";
import Title from "../components/Title";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAppConfig } from "../contexts/AppConfigContext";

function FolderSelect() {
  const navigate = useNavigate();
  const { config, chooseRootDir } = useAppConfig();
  // 初回マウント時にチェック
  useEffect(() => {
    if (config?.root_dir) {
      navigate("/app", { replace: true });
    }
  }, [config?.root_dir, navigate]);

  async function handleClick() {
    const rootDir = await chooseRootDir({ force: true });
    if (rootDir) {
      navigate("/app", { replace: true });
    }
  }
  return (
    <div className="container">
      <Title />
      <p className="guide--text">
        あなたの定跡を整理するノートアプリへようこそ
      </p>
      <button onClick={handleClick} className="guide__btn--big">
        <span className="folder-icon">📁</span>フォルダを選択
      </button>
    </div>
  );
}

export default FolderSelect;
