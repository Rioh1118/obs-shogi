import { useAppConfig } from "../contexts/AppConfigContext";
import { useState } from "react";
import Sidebar from "../components/Sidebar";
import IconButton from "../components/IconButton";
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
