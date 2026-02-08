import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import FolderSelect from "./pages/FolderSelect";
import AppLayout from "./pages/AppLayout";
import FileTree from "@/components/FileTree/FileTree";
import { AppConfigProvider } from "./contexts/AppConfigContext";
import { FileTreeProvider } from "./contexts/FileTreeContext";
import { GameProvider } from "./contexts/GameContext";
import { useMemo } from "react";
import { KifuWriterFactory } from "./services/file/KifuWriterImpl";
import TitleBar from "./components/TitleBar";
import "./App.scss";
import EngineProvider from "./contexts/EngineContext";
import { AnalysisProvider } from "./contexts/AnalysisContext";
import { PositionProvider } from "./contexts/PositionContext";

function App() {
  const kifuWriter = useMemo(() => KifuWriterFactory.createInstance(), []);
  return (
    <div className="app-root">
      <AppConfigProvider>
        <FileTreeProvider>
          <GameProvider kifuWriter={kifuWriter}>
            <TitleBar />
            <div className="app-content">
              <BrowserRouter>
                <Routes>
                  <Route index element={<FolderSelect />} />
                  <Route
                    path="/app"
                    element={
                      <EngineProvider>
                        <PositionProvider>
                          <AnalysisProvider>
                            <AppLayout />
                          </AnalysisProvider>
                        </PositionProvider>
                      </EngineProvider>
                    }
                  >
                    <Route
                      index
                      element={<Navigate replace to="panel/filetree" />}
                    />
                    <Route path="panel">
                      <Route path="filetree" element={<FileTree />} />
                    </Route>
                  </Route>
                </Routes>
              </BrowserRouter>
            </div>
          </GameProvider>
        </FileTreeProvider>
      </AppConfigProvider>
    </div>
  );
}

export default App;
