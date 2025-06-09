import { useState } from "react";
import Sidebar from "../components/Sidebar";
import IconButton from "../components/IconButton";
import GameBoard from "../components/GameBoard/GameBoard";
import Board from "../components/GameBoard/Board/Board";
import Hand from "../components/GameBoard/Hand/Hand";
import { GameControls } from "../components/GameBoard";
import { PanelLeftOpen, PanelLeftClose } from "lucide-react";

import "./AppLayout.scss";
import Modal from "@/components/Modal";
import FileCreateForm from "@/components/FileTree/FileCreateForm";
import { useSearchParams } from "react-router";
import { useGame } from "@/contexts/GameContext";
import WelcomeScreen from "@/components/WelcomeScreen";

const AppLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const { state } = useGame();

  const action = searchParams.get("action");
  const targetDir = searchParams.get("dir");

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const closeModal = () => {
    setSearchParams({});
  };

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
      {action === "create-file" && (
        <Modal onToggle={closeModal}>
          <FileCreateForm toggleModal={closeModal} dirPath={targetDir || ""} />
        </Modal>
      )}
      <Sidebar isOpen={isSidebarOpen} />
      <main className="app-layout__main-container">
        {!state.jkfPlayer?.shogi ? (
          <WelcomeScreen />
        ) : (
          <section className="main-container__game">
            <GameBoard>
              <Hand isPlayer={true} />
              <Board />
              <Hand isPlayer={false} />
            </GameBoard>
            <GameControls />
          </section>
        )}
      </main>
    </div>
  );
};

export default AppLayout;
