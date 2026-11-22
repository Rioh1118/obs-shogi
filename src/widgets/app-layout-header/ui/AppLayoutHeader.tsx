import { PanelLeftClose, PanelLeftOpen, Settings, Library } from "lucide-react";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useOpenSettings } from "@/features/settings/model/useOpenSettings";
import Title from "@/shared/ui/Title";
import TitleBarContent from "@/shared/ui/TitleBarContent";
import { useHeaderCenterInfo } from "../lib/useHeaderCenterInfo";
import "./AppLayoutHeader.scss";

type Props = {
  toggleSidebar: () => void;
  isSidebarOpen: boolean;
};

/** 作業画面の見出し。タイトルバーの中に描く */
function AppLayoutHeader({ toggleSidebar, isSidebarOpen }: Props) {
  const { openModal } = useURLParams();
  const openSettings = useOpenSettings();

  const info = useHeaderCenterInfo();

  const toggleLabel = isSidebarOpen ? "サイドバーを閉じる" : "サイドバーを開く";
  const ToggleIcon = isSidebarOpen ? PanelLeftClose : PanelLeftOpen;

  return (
    <TitleBarContent>
      <header className="app-header">
        <button
          type="button"
          className="app-header__toggle"
          title={toggleLabel}
          aria-label={toggleLabel}
          onClick={toggleSidebar}
        >
          <ToggleIcon size={17} aria-hidden="true" />
        </button>

        <div className="app-header__brand">
          {/* 名前は隣の文字が言うので、印は読み上げない */}
          <img className="app-header__mark" src="/icon.svg" alt="" width={16} height={19} />
          <Title as="div" variant="header" />
        </div>

        <div className="app-header__doc" title={info.tooltip}>
          <span
            className={`app-header__filename ${info.hasKifu ? "" : "app-header__filename--none"}`}
            title={info.fileTitle}
          >
            {info.fileLabel}
          </span>
        </div>

        <div className="app-header__actions">
          <button
            type="button"
            className="app-header__action"
            onClick={() => openModal("study-positions")}
          >
            <Library size={15} aria-hidden="true" />
            課題局面
          </button>
          <button
            type="button"
            className="app-header__action"
            onClick={() => openSettings("workspace")}
          >
            <Settings size={15} aria-hidden="true" />
            設定
          </button>
        </div>
      </header>
    </TitleBarContent>
  );
}

export default AppLayoutHeader;
