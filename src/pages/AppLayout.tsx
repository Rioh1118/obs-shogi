import { useState } from "react";
import Sidebar from "../components/Sidebar";
import IconButton from "../components/IconButton";
import GameBoard from "../components/GameBoard/GameBoard";
import Board from "../components/GameBoard/Board/Board";
import Hand from "../components/GameBoard/Hand/Hand";
import { GameControls } from "../components/GameBoard";
import { PanelLeftOpen, PanelLeftClose } from "lucide-react";

import "./AppLayout.scss";

const AppLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <div className="app-layout">
      <IconButton
        handleClick={toggleSidebar}
        className="sidebar__btn--toggle"
        size="medium"
        variant="sidebar-toggle"
      >
        {/* {isSidebarOpen ? "x" : "☰"} */}
        {isSidebarOpen ? (
          <PanelLeftClose size={20} />
        ) : (
          <PanelLeftOpen size={20} />
        )}
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
      </main>
    </div>
  );
};

export default AppLayout;
