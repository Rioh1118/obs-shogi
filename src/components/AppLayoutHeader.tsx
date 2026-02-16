import { Command, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import IconButton from "./IconButton";
import { useURLParams } from "@/hooks/useURLParams";
import "./AppLayoutHeader.scss";
import { useFileTree } from "@/contexts/FileTreeContext";

type Props = {
  toggleSidebar: () => void;
  isSidebarOpen: boolean;
  hasFile: boolean;
};

function AppLayoutHeader({ toggleSidebar, isSidebarOpen, hasFile }: Props) {
  const { openModal } = useURLParams();
  const { jkfData } = useFileTree();

  const header = jkfData?.header ?? {};
  const sente = header["先手"]?.trim();
  const gote = header["後手"]?.trim();
  const isPlayersShown = hasFile && Boolean(sente || gote);

  const titleText = !hasFile
    ? "ファイル未選択"
    : !isPlayersShown
      ? "棋譜表示中"
      : `先手 ${sente || "（不明）"} / 後手 ${gote || "（不明）"}`;

  const contextNode = !hasFile ? (
    "ファイル未選択"
  ) : !isPlayersShown ? (
    "棋譜表示中"
  ) : (
    <span className="app-header__players">
      <span className="app-header__player">
        <span className="app-header__piece app-header__piece--sente">☗</span>
        <span className="app-header__player-name">{sente || "先手"}</span>
      </span>

      <span className="app-header__vs" aria-hidden="true">
        {/* 将棋っぽい “間” を作るための中点 */}・
      </span>

      <span className="app-header__player">
        <span className="app-header__piece app-header__piece--gote">☖</span>
        <span className="app-header__player-name">{gote || "後手"}</span>
      </span>
    </span>
  );

  return (
    <header className="app-header">
      <div className="app-header__left">
        <IconButton
          handleClick={toggleSidebar}
          className="app-header__sidebar-toggle"
          size="medium"
          variant="sidebar-toggle"
          title={isSidebarOpen ? "サイドバーを閉じる" : "サイドバーを開く"}
        >
          {isSidebarOpen ? (
            <PanelLeftClose size={20} />
          ) : (
            <PanelLeftOpen size={20} />
          )}
        </IconButton>
      </div>
      <div className="app-header__brand">
        <div className="app-header__appname">OBS SHOGI</div>
        <div className="app-header__subtitle">研究・定跡管理</div>
      </div>
      <div className="app-header__center">
        <div className="app-header__context">
          <span
            className={[
              "app-header__context-label",
              isPlayersShown ? "app-header__context-label--players" : "",
            ].join(" ")}
            title={titleText}
          >
            {contextNode}
          </span>
        </div>
      </div>
      <div className="app-header__right">
        <button
          type="button"
          className="app-header__icon-btn"
          title="コマンド"
          aria-label="コマンド"
          disabled
        >
          <Command size={18} />
        </button>
        <button
          type="button"
          className="app-header__icon-btn"
          title="設定"
          aria-label="設定"
          onClick={() => openModal("settings", { tab: "general" })}
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}

export default AppLayoutHeader;
