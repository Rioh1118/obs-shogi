import { useState } from "react";
import { Outlet } from "react-router";
import Sidebar from "../widgets/sidebar/Sidebar";
import GameBoard from "../widgets/game-board/ui/GameBoard";
import Board from "../widgets/game-board/ui/Board";
import Hand from "../widgets/game-board/ui/Hand";

import "./AppLayout.scss";
import WelcomeScreen from "@/pages/WelcomeScreen";
import AppModalLayer from "@/pages/AppModalLayer";

import AnalysisPane from "@/widgets/analysis-pane/ui/AnalysisPane";
import AppLayoutHeader from "@/widgets/app-layout-header/ui/AppLayoutHeader";
import KifuStreamList from "@/widgets/kifu-stream/ui/KifuStreamList";
import { useGame } from "@/entities/game";
import GameControls from "@/widgets/game-board/ui/GameControls";
import { AppErrorBoundary } from "@/shared/ui/AppErrorBoundary";

const AppLayout = () => {
  // 開閉は持ち越さない。**起動のたびに開いた状態で始まる**のが既定で、これは意匠。
  // どのパネルを出すかは URL（`panel/*`）が持つが、開閉はそちらへ揃えない
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { view: gameView, state: gameState, clearSelection } = useGame();

  const toggleSidebar = () => setIsSidebarOpen((v) => !v);
  const hasFile = !!gameView.player?.shogi;

  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (!gameState.selectedPosition) return;
    const el = e.target as HTMLElement | null;
    if (!el) return;
    if (el.closest('[data-board-square="true"]')) return;
    if (el.closest('[data-hand-area="true"]')) return;
    clearSelection();
  };

  return (
    <div
      className={`app-layout ${isSidebarOpen ? "" : "app-layout--sidebar-closed"}`}
      onPointerDownCapture={onPointerDownCapture}
    >
      {/* モーダル1枚の事故で本体まで unmount させない */}
      <AppErrorBoundary>
        <AppModalLayer />
      </AppErrorBoundary>

      <AppLayoutHeader
        toggleSidebar={toggleSidebar}
        isSidebarOpen={isSidebarOpen}
        hasFile={hasFile}
      />

      <div className="app-layout__body">
        <aside className="app-layout__sidebar-slot">
          {/* `panel/*` のルートがここに入る。行き先は AppRouter を見る */}
          <Sidebar isOpen={isSidebarOpen}>
            <Outlet />
          </Sidebar>
        </aside>
        <main className="app-layout__main">
          {!hasFile ? (
            <div className="app-layout__empty">
              <WelcomeScreen />
            </div>
          ) : (
            <div className="workspace">
              <div className="workspace__surface">
                <section className="workspace__main">
                  <div className="workspace__boardPane">
                    <GameBoard
                      topLeft={<Hand isSente={false} />}
                      center={<Board />}
                      bottomRight={<Hand isSente={true} />}
                    />
                    <div className="workspace__controls">
                      <GameControls />
                    </div>
                  </div>
                  <aside className="workspace__kifuPane">
                    <AppErrorBoundary>
                      <KifuStreamList />
                    </AppErrorBoundary>
                  </aside>
                </section>

                <section className="workspace__dock">
                  <AnalysisPane />
                </section>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
