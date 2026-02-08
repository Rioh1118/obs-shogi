import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import IconButton from "../components/IconButton";
import GameBoard from "../components/GameBoard/GameBoard";
import Board from "../components/GameBoard/Board/Board";
import Hand from "../components/GameBoard/Hand/Hand";
import { GameControls } from "../components/GameBoard";
import { PanelLeftOpen, PanelLeftClose } from "lucide-react";

import "./AppLayout.scss";
import PositionNavigationModal from "@/components/NavigationModal/PositionNavigationModal";
import { useGame } from "@/contexts/GameContext";
import { useEngine } from "@/contexts/EngineContext";
import WelcomeScreen from "@/components/WelcomeScreen";

import AnalysisPane from "@/components/AnalysisPane/AnalysisPane";
import EngineLoading from "@/components/EngineLoading";
import SettingsModal from "@/components/SettingsModal/SettingsModal";
import CreateFileModal from "@/components/CreateFileModal";

const AppLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { state: gameState } = useGame();

  const {
    state: engineState,
    validation,
    setupOk,
    resolvedPaths,
  } = useEngine();

  useEffect(() => {
    console.log("[AppLayout render]", {
      phase: engineState.phase,
      validation: validation.status,
      setupOk,
      hasResolved: !!resolvedPaths,
    });

    if (engineState.phase === "error") {
      console.error("[Engine error]", engineState.error);
    }
  }, [
    engineState.phase,
    engineState.error,
    validation.status,
    setupOk,
    resolvedPaths,
  ]);

  const toggleSidebar = () => setIsSidebarOpen((v) => !v);

  if (engineState.phase === "initializing") {
    return (
      <div className="app-layout">
        <EngineLoading />
      </div>
    );
  }

  return (
    <div className="app-layout">
      <IconButton
        handleClick={toggleSidebar}
        className="sidebar__btn--toggle"
        size="medium"
        variant="sidebar-toggle"
      >
        {isSidebarOpen ? (
          <PanelLeftClose size={20} />
        ) : (
          <PanelLeftOpen size={20} />
        )}
      </IconButton>

      <CreateFileModal />
      <PositionNavigationModal />
      <SettingsModal />
      <Sidebar isOpen={isSidebarOpen} />

      <main className="app-layout__main-container">
        {!gameState.jkfPlayer?.shogi ? (
          <WelcomeScreen />
        ) : (
          <>
            <section className="main-container__game">
              <GameBoard>
                <Hand isPlayer={true} />
                <Board />
                <Hand isPlayer={false} />
              </GameBoard>
              <GameControls />
              <div className="app-layout__analysis-controls">{/* ... */}</div>
            </section>

            <section className="app-layout__footer-container">
              <AnalysisPane />
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default AppLayout;
