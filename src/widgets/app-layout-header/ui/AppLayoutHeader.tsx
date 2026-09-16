import { PanelLeftClose, PanelLeftOpen, Settings, Library } from "lucide-react";
import IconButton from "@/shared/ui/IconButton";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useOpenSettings } from "@/features/settings/model/useOpenSettings";
import { GOTE_GLYPH, SENTE_GLYPH } from "@/shared/lib/turn";
import "./AppLayoutHeader.scss";
import Title from "@/shared/ui/Title";
import { useHeaderCenterInfo } from "@/widgets/app-layout-header/lib/useHeaderCenterInfo";
import { liveGameOf, useGameSession } from "@/entities/game-session";
import HeaderGameLine from "./HeaderGameLine";

type Props = {
  toggleSidebar: () => void;
  isSidebarOpen: boolean;
};

function AppLayoutHeader({ toggleSidebar, isSidebarOpen }: Props) {
  const { openModal } = useURLParams();
  const openSettings = useOpenSettings();

  const info = useHeaderCenterInfo();
  const { view: gameView } = useGameSession();
  // 行を出すかは1つの判定から引く。**中身を描く側（`HeaderGameLine`）と同じもの**を
  // 読まないと、片方だけが「対局中」と読んだ回に中身の無い行のぶんだけ高さが伸びる
  const isGameLive = liveGameOf(gameView) !== null;

  const hasKifu = info.hasKifu;

  const metaNode = !hasKifu ? null : !info.isPlayersShown ? (
    <span className="app-header__muted">棋譜表示中</span>
  ) : (
    <span className="app-header__meta" aria-label="対局者">
      <span className="app-header__piece app-header__piece--sente">{SENTE_GLYPH}</span>
      <span className="app-header__meta-name">{info.senteName ?? "先手"}</span>
      <span className="app-header__meta-sep" aria-hidden="true">
        ・
      </span>
      <span className="app-header__piece app-header__piece--gote">{GOTE_GLYPH}</span>
      <span className="app-header__meta-name">{info.goteName ?? "後手"}</span>
    </span>
  );

  return (
    <header className={`app-header ${isGameLive ? "app-header--game" : ""}`}>
      <div className="app-header__left">
        <IconButton
          handleClick={toggleSidebar}
          className="app-header__sidebar-toggle"
          size="medium"
          variant="sidebar-toggle"
          title={isSidebarOpen ? "サイドバーを閉じる" : "サイドバーを開く"}
        >
          {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
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

            {hasKifu && (
              <span className="app-header__badges" aria-hidden="true">
                <span className="app-header__badge app-header__badge--turn">
                  {info.turnGlyph} {info.turnText}
                </span>
                <span className="app-header__badge">{info.tesuuText}</span>
              </span>
            )}
            {metaNode && <span className="app-header__divider" aria-hidden="true" />}
            {metaNode}
          </div>
          {/*
            **1行目は棋譜の行、2行目は対局の行。** 対局は棋譜が入れ替わっても
            走り続けるので、別の棋譜を見ている間もこの行は対局の時計を出す。
            1行目の手番バッジは盤の局面のもの、2行目の印は対局のもので、
            遡って並べている間は**食い違って見えるが、それでよい**（ADR-0011 決定2）
          */}
          <HeaderGameLine />
        </div>
      </div>
      <div className="app-header__right">
        <button
          type="button"
          className="app-header__icon-btn"
          title="課題局面"
          aria-label="課題局面"
          onClick={() => openModal("study-positions")}
        >
          <Library size={18} />
        </button>
        <button
          type="button"
          className="app-header__icon-btn"
          title="設定"
          aria-label="設定"
          onClick={() => openSettings("workspace")}
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}

export default AppLayoutHeader;
