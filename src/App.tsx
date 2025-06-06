import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import FolderSelect from "./pages/FolderSelect";
import AppLayout from "./pages/AppLayout";
import FileTree from "@/components/FileTree/FileTree";
import { AppConfigProvider } from "./contexts/AppConfigContext";
import { FileTreeProvider } from "./contexts/FileTreeContext";
import { GameProvider } from "./contexts/GameContext";
import { useMemo } from "react";
import { KifuWriterFactory } from "./services/file/KifuWriterImpl";

function App() {
  const kifuWriter = useMemo(() => KifuWriterFactory.createInstance(), []);
  return (
    <AppConfigProvider>
      <FileTreeProvider>
        <GameProvider kifuWriter={kifuWriter}>
          <BrowserRouter>
            <Routes>
              <Route index element={<FolderSelect />} />
              <Route path="/app" element={<AppLayout />}>
                <Route index element={<Navigate replace to="filetree" />} />
                <Route path="filetree" element={<FileTree />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </GameProvider>
      </FileTreeProvider>
    </AppConfigProvider>
  );
}

export default App;
