import { PanelLeftClose, PanelLeftOpen, Settings, Library } from "lucide-react";
import IconButton from "@/shared/ui/IconButton";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useOpenSettings } from "@/features/settings/model/useOpenSettings";
import { GOTE_GLYPH, SENTE_GLYPH } from "@/shared/lib/turn";
import "./AppLayoutHeader.scss";
import Title from "@/shared/ui/Title";
import { useHeaderCenterInfo } from "@/widgets/app-layout-header/lib/useHeaderCenterInfo";
import HeaderGameLine from "./HeaderGameLine";

type Props = {
  toggleSidebar: () => void;
  isSidebarOpen: boolean;
};

function AppLayoutHeader({ toggleSidebar, isSidebarOpen }: Props) {
  const { openModal } = useURLParams();
  const openSettings = useOpenSettings();

  const info = useHeaderCenterInfo();

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
    <header className="app-header">
      {/*
        **1行目は棋譜の行。** 高さが固まっているので、対局の行が生えても
        ここに並ぶものは動かない（ヘッダ全体を中央揃えにすると、対局を始めた
        瞬間にサイドバーのトグルも設定の歯車も1行ぶん下へ逃げる）
      */}
      <div className="app-header__bar">
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
          <div className="app-header__context">
            {/*
              **説明するのはこの行だけ。** `title` は子孫に効くので、器の側に置くと
              対局の行にカーソルを当てた人に、盤に出ている棋譜の対局者名が出る
              （別の棋譜の対局を走らせている間は、別の対局の名前が読める）
            */}
            <div className="app-header__docline" title={info.tooltip}>
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
      </div>
      {/*
        **2行目は対局の行。** 出すかどうかも高さも行が自分で決める（`HeaderGameLine`）。
        1行目の手番バッジは盤の局面のもの、2行目の印は対局のもので、
        遡って並べている間は**食い違って見えるが、それでよい**（ADR-0011 決定2）
      */}
      <HeaderGameLine />
    </header>
  );
}

export default AppLayoutHeader;
