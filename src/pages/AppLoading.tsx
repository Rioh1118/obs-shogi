import FolderSelect from "./FolderSelect";
import "./FolderSelect.scss";
import { Navigate, useNavigate } from "react-router";
import { useAppConfig } from "@/entities/app-config";
import BootSplash from "@/widgets/boot-splash/ui/BootSplash";
import Title from "@/shared/ui/Title";
import ChooseWorkspaceButton from "@/features/choose-workspace/ui/ChooseWorkspaceButton";

function AppLoading() {
  const { config, isLoading, error } = useAppConfig();
  const navigate = useNavigate();

  if (isLoading) return <BootSplash />;
  if (error) {
    // **行き止まりにしない。** 文だけを出すと、アプリを終了する以外に何もできない
    // 画面になる（次の起動でも同じ）。出口はワークスペースを選び直すことしかない。
    //
    // **`FolderSelect` は置けない。** あちらは `config.root_dir` があれば `/app` へ
    // 飛ぶが、`error` が立っている間は `RequireRootDir` が `/` へ戻すので往復が
    // 止まらない。`error` は `config` を残すので、この組み合わせは実際に起きる。
    //
    // 器（`.container`）も自分で持つ。外に置くと面も文字色も継げず、
    // この1行だけが UA まかせの色で暗い面の上に出る
    return (
      <div className="container">
        <Title />
        <p className="guide--text" role="alert">
          起動エラー: {error}
        </p>
        <ChooseWorkspaceButton onChosen={() => navigate("/app", { replace: true })} />
      </div>
    );
  }

  return config?.root_dir ? <Navigate replace to="/app" /> : <FolderSelect />;
}

export default AppLoading;
