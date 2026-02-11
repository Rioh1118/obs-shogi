import { Command, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import IconButton from "./IconButton";
import { useURLParams } from "@/hooks/useURLParams";
import "./AppLayoutHeader.scss";

type Props = {
  toggleSidebar: () => void;
  isSidebarOpen: boolean;
  hasFile: boolean;
};

function AppLayoutHeader({ toggleSidebar, isSidebarOpen, hasFile }: Props) {
  const { openModal } = useURLParams();

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
          <span className="app-header__context-label">
            {hasFile ? "棋譜表示中" : "ファイル未選択"}
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
