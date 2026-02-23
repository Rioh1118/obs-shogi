import { PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import IconButton from "../../../shared/ui/IconButton";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import "./AppLayoutHeader.scss";
import Title from "../../../shared/ui/Title";
import { useHeaderCenterInfo } from "@/widgets/app-layout-header/lib/useHeaderCenterInfo";

type Props = {
  toggleSidebar: () => void;
  isSidebarOpen: boolean;
  hasFile: boolean;
};

function AppLayoutHeader({ toggleSidebar, isSidebarOpen, hasFile }: Props) {
  const { openModal } = useURLParams();

  const info = useHeaderCenterInfo(hasFile);

  const metaNode = !hasFile ? null : !info.isPlayersShown ? (
    <span className="app-header__muted">棋譜表示中</span>
  ) : (
    <span className="app-header__meta" aria-label="対局者">
      <span className="app-header__piece app-header__piece--sente">☗</span>
      <span className="app-header__meta-name">{info.senteName ?? "先手"}</span>
      <span className="app-header__meta-sep" aria-hidden="true">
        ・
      </span>
      <span className="app-header__piece app-header__piece--gote">☖</span>
      <span className="app-header__meta-name">{info.goteName ?? "後手"}</span>
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
        <Title as="div" variant="header" />
      </div>
      <div className="app-header__center">
        <div className="app-header__context" title={info.tooltip}>
          <div className="app-header__docline">
            <span className="app-header__filename" title={info.fileTitle}>
              {info.fileLabel}
            </span>

            {info.hasBadges && (
              <span className="app-header__badges" aria-hidden="true">
                <span className="app-header__badge app-header__badge--turn">
                  {info.turnGlyph} {info.turnText}
                </span>
                <span className="app-header__badge">{info.tesuuText}</span>
              </span>
            )}
            {metaNode && (
              <span className="app-header__divider" aria-hidden="true" />
            )}
            {metaNode}
          </div>
        </div>
      </div>
      <div className="app-header__right">
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
