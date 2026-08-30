import FolderSelect from "./FolderSelect";
import { Navigate } from "react-router";
import { useAppConfig } from "@/entities/app-config";
import BootSplash from "@/widgets/boot-splash/ui/BootSplash";

function AppLoading() {
  const { config, isLoading, error } = useAppConfig();

  if (isLoading) return <BootSplash />;
  if (error) {
    // **行き止まりにしない。** ここへ来るのは設定を読めなかったときで、
    // 出口はワークスペースを選び直すことしかない。文だけを出すと、
    // アプリを終了する以外に何もできない画面になる（次の起動でも同じ）
    return (
      <>
        <p role="alert">起動エラー: {error}</p>
        <FolderSelect />
      </>
    );
  }

  return config?.root_dir ? <Navigate replace to="/app" /> : <FolderSelect />;
}

export default AppLoading;
