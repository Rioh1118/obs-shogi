import { useState } from "react";
import Sidebar from "../components/Sidebar";
import GameBoard from "../components/GameBoard/GameBoard";
import Board from "../components/GameBoard/Board/Board";
import Hand from "../components/GameBoard/Hand/Hand";
import { GameControls } from "../components/GameBoard";

import "./AppLayout.scss";
import PositionNavigationModal from "@/components/NavigationModal/PositionNavigationModal";
import { useGame } from "@/contexts/GameContext";
import { useEngine } from "@/contexts/EngineContext";
import WelcomeScreen from "@/components/WelcomeScreen";

import AnalysisPane from "@/components/AnalysisPane/AnalysisPane";
import EngineLoading from "@/components/EngineLoading";
import SettingsModal from "@/components/SettingsModal/SettingsModal";
import CreateFileModal from "@/components/CreateFileModal";
import AppLayoutHeader from "@/components/AppLayoutHeader";

const AppLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { state: gameState } = useGame();

  const { state: engineState } = useEngine();

  const toggleSidebar = () => setIsSidebarOpen((v) => !v);
  const hasFile = !!gameState.jkfPlayer?.shogi;

  if (engineState.phase === "initializing") {
    return (
      <div className="app-layout">
        <EngineLoading />
      </div>
    );
  }

  return (
    <div
      className={`app-layout ${isSidebarOpen ? "" : "app-layout--sidebar-closed"}`}
    >
      <CreateFileModal />
      <PositionNavigationModal />
      <SettingsModal />

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
              <section className="workspace__board">
                <div className="workspace__board-surface">
                  <GameBoard>
                    <Hand isPlayer={true} />
                    <Board />
                    <Hand isPlayer={false} />
                  </GameBoard>
                  <div className="workspace__controls">
                    <GameControls />
                  </div>
                </div>
              </section>

              <section className="workspace__analysis">
                <AnalysisPane />
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
