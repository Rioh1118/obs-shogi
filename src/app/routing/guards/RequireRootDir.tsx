import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useAppConfig } from "@/entities/app-config";
import BootSplash from "@/widgets/boot-splash/ui/BootSplash";

/**
 * ワークスペースの根が決まっているときだけ中身を描く。決まっていなければ `/` へ戻す。
 *
 * 設定の失敗が立っている間も戻す。根が残っていても戻すので、`/` の画面は
 * `config.root_dir` を見て `/app` へ送り返してはいけない（`AppLoading` のコメント）。
 */
export function RequireRootDir({ children }: { children: ReactNode }) {
  const { config, isLoading, error } = useAppConfig();

  // 初めて読んでいる間だけ中身を描かない。読み直しの間は前の設定のまま描き続ける
  if (isLoading && !config) return <BootSplash />;

  if (error) return <Navigate to="/" replace />;
  if (!config?.root_dir) return <Navigate to="/" replace />;

  return children;
}
