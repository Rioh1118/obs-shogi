import { useAppConfig } from "@/entities/app-config";

import "./ChooseWorkspaceButton.scss";

/**
 * ワークスペースを選ばせるボタン。**自分では画面を移動しない。**
 *
 * 移動を内蔵すると、置いた先のページの遷移規則とぶつかる。実際に
 * `FolderSelect`（`config.root_dir` があれば `/app` へ飛ぶ）を起動エラーの画面へ
 * そのまま置いたとき、`RequireRootDir` が `error` を見て `/` へ戻すのと往復して
 * 止まらなくなった。行き先はページごとに違うので、選べたことだけを返す。
 */
function ChooseWorkspaceButton({ onChosen }: { onChosen: (rootDir: string) => void }) {
  const { chooseRootDir } = useAppConfig();

  return (
    <button
      className="choose-workspace"
      onClick={() => {
        void chooseRootDir({ force: true }).then((rootDir) => {
          if (rootDir) onChosen(rootDir);
        });
      }}
    >
      <span className="choose-workspace__icon">📁</span>フォルダを選択
    </button>
  );
}

export default ChooseWorkspaceButton;
