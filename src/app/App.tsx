import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import AppLayout from "../pages/AppLayout";
import FileTree from "@/components/FileTree/FileTree";
import { GameProvider } from "../contexts/GameContext";
import { useMemo } from "react";
import { KifuWriterFactory } from "../services/file/KifuWriterImpl";
import TitleBar from "../components/TitleBar";
import "./App.scss";
import EngineProvider from "../contexts/EngineContext";
import { AnalysisProvider } from "../contexts/AnalysisContext";
import { PositionProvider } from "../contexts/PositionContext";
import { PositionSearchProvider } from "../contexts/PositionSearchContext";
import { EnginePresetsProvider } from "../contexts/EnginePresetsContext";
import AppLoading from "../pages/AppLoading";
import AppProviders from "./providers/AppProviders";

function App() {
  const kifuWriter = useMemo(() => KifuWriterFactory.createInstance(), []);
  return (
    <div className="app-root">
      <AppProviders>
        <GameProvider kifuWriter={kifuWriter}>
          <TitleBar />
          <div className="app-content">
            <BrowserRouter>
              <Routes>
                <Route index element={<AppLoading />} />
                <Route
                  path="/app"
                  element={
                    <EnginePresetsProvider>
                      <EngineProvider>
                        <PositionProvider>
                          <PositionSearchProvider>
                            <AnalysisProvider>
                              <AppLayout />
                            </AnalysisProvider>
                          </PositionSearchProvider>
                        </PositionProvider>
                      </EngineProvider>
                    </EnginePresetsProvider>
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
      </AppProviders>
    </div>
  );
}

export default App;
