import { useEffect, useRef, useState } from "react";
import Sidebar from "../widgets/sidebar/Sidebar";
import GameBoard from "../widgets/game-board/ui/GameBoard";
import Board from "../widgets/game-board/ui/Board";
import Hand from "../widgets/game-board/ui/Hand";

import "./AppLayout.scss";
import PositionNavigationModal from "@/features/position-navigation/ui/PositionNavigationModal";
import WelcomeScreen from "@/pages/WelcomeScreen";

import AnalysisPane from "@/widgets/analysis-pane/ui/AnalysisPane";
import SettingsModal from "@/features/settings/ui/SettingsModal";
import CreateFileModal from "@/features/create-file/ui/CreateFileModal";
import AppLayoutHeader from "@/widgets/app-layout-header/ui/AppLayoutHeader";
import KifuStreamList from "@/widgets/kifu-stream/ui/KifuStreamList";
import PositionSearchModal from "@/features/position-search/ui/PositionSearchModal";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useGame } from "@/entities/game";
import { usePositionSearch } from "@/entities/search";
import GameControls from "@/widgets/game-board/ui/GameControls";
import { useFileTree } from "@/entities/file-tree";

const AppLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { state: gameState, clearSelection } = useGame();
  const { params, updateParams } = useURLParams();
  const rotate = params.pov === "gote";

  const { selectedNode } = useFileTree();

  const prevIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = selectedNode?.id ?? null;
    if (prevIdRef.current === id) return;
    prevIdRef.current = id;

    updateParams({ pov: undefined }, { replace: true });
  }, [selectedNode, updateParams]);

  const toggleSidebar = () => setIsSidebarOpen((v) => !v);
  const hasFile = !!gameState.jkfPlayer?.shogi;
  const { openProject } = usePositionSearch();

  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (!gameState.selectedPosition) return;

    const el = e.target as HTMLElement | null;
    if (!el) return;

    // boardのsquare内クリックは除外
    if (el.closest('[data-board-square="true"]')) return;
    if (el.closest('[data-board-square="true"]')) return;
    if (el.closest('[data-hand-area="true"]')) return;

    clearSelection();
  };

  useEffect(() => {
    openProject();
  }, [openProject]);

  return (
    <div
      className={`app-layout ${isSidebarOpen ? "" : "app-layout--sidebar-closed"}`}
      onPointerDownCapture={onPointerDownCapture}
    >
      <CreateFileModal />
      <PositionNavigationModal />
      <SettingsModal />
      <PositionSearchModal />

      <AppLayoutHeader
        toggleSidebar={toggleSidebar}
        isSidebarOpen={isSidebarOpen}
        hasFile={hasFile}
      />

      <div className="app-layout__body">
        <aside className="app-layout__sidebar-slot">
          <Sidebar isOpen={isSidebarOpen} />
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
                      rotate={rotate}
                    />
                    <div className="workspace__controls">
                      <GameControls />
                    </div>
                  </div>
                  <aside className="workspace__kifuPane">
                    <KifuStreamList />
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
