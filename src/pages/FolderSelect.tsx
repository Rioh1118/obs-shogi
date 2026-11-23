import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAppConfig } from "@/entities/app-config";
import StartScreen from "./StartScreen";

function FolderSelect() {
  const navigate = useNavigate();
  const { config } = useAppConfig();
  // 根が決まったら作業画面へ移る。選んだ直後は `onChosen` も移すが、別の経路で根が入ったときもここで移る
  useEffect(() => {
    if (config?.root_dir) {
      navigate("/app", { replace: true });
    }
  }, [config?.root_dir, navigate]);

  return (
    <StartScreen
      message="あなたの定跡を整理するノートアプリへようこそ"
      onChosen={() => navigate("/app", { replace: true })}
    />
  );
}

export default FolderSelect;
