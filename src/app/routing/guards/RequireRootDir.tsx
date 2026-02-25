import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useAppConfig } from "@/entities/app-config";
import BootSplash from "@/widgets/boot-splash/ui/BootSplash";

export function RequireRootDir({ children }: { children: ReactNode }) {
  const { config, isLoading, error } = useAppConfig();

  // config ロードが終わってないなら何もマウントしない
  if (isLoading && !config) return <BootSplash />;

  // config 読み込みエラーなら / に戻す
  if (error) return <Navigate to="/" replace />;
  // root_dir が無いなら / に戻す
  if (!config?.root_dir) return <Navigate to="/" replace />;

  return children;
}
