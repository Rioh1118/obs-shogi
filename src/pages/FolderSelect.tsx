import "./FolderSelect.scss";
import Title from "../components/Title";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAppConfig } from "../contexts/AppConfigContext";

function FolderSelect() {
  const navigate = useNavigate();
  const { config, initRootDir } = useAppConfig();
  // 初回マウント時にチェック
  useEffect(() => {
    if (config?.root_dir) {
      navigate("/app", { replace: true });
    }
  }, [config, navigate]);

  async function handleClick() {
    try {
      const rootDir = await initRootDir();
      if (rootDir) {
        navigate("/app", { replace: true });
      }
    } catch (err) {
      console.error("ディレクトリ選択に失敗しました:", err);
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
