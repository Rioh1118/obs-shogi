import { useAppConfig } from "../contexts/AppConfigContext";
import { useState } from "react";
import Sidebar from "../components/Sidebar";
import IconButton from "../components/IconButton";
import GameBoard from "../components/GameBoard/GameBoard";
import Board from "../components/GameBoard/Board/Board";
import Hand from "../components/GameBoard/Hand/Hand";
import { GameControls } from "../components/GameBoard";

import "./AppLayout.scss";

const AppLayout = () => {
  const { config, error } = useAppConfig();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <div className="app-layout">
      <IconButton handleClick={toggleSidebar} className="sidebar__btn--toggle">
        {isSidebarOpen ? "x" : "☰"}
      </IconButton>
      <Sidebar isOpen={isSidebarOpen} />
      <main className="app-layout__main-container">
        <section className="main-container__game">
          <GameBoard>
            <Hand isPlayer={true} />
            <Board />
            <Hand isPlayer={false} />
          </GameBoard>
          <GameControls />
        </section>
        <h1>App Layout</h1>
        {error && <p style={{ color: "red" }}>❌ {error}</p>}
        {!error && (
          <p>
            📂 Root Directory:{" "}
            {config?.root_dir ? (
              <strong>{config.root_dir}</strong>
            ) : (
              <em>未設定</em>
            )}
          </p>
        )}
      </main>
    </div>
  );
};

export default AppLayout;
