import FolderSelect from "./FolderSelect";
import { Navigate } from "react-router";
import { useAppConfig } from "@/entities/app-config";
import BootSplash from "@/widgets/boot-splash/ui/BootSplash";

function AppLoading() {
  const { config, isLoading, error } = useAppConfig();

  if (isLoading) return <BootSplash />;
  if (error) {
    return <div>起動エラー: {error}</div>;
  }

  return config?.root_dir ? <Navigate replace to="/app" /> : <FolderSelect />;
}

export default AppLoading;
