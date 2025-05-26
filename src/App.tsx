import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import FolderSelect from "./pages/FolderSelect";
import AppLayout from "./pages/AppLayout";
import FileTree from "./components/FileTree";
import { AppConfigProvider } from "./contexts/AppConfigContext";
import { FileTreeProvider } from "./contexts/FileTreeContext";

function App() {
  return (
    <AppConfigProvider>
      <FileTreeProvider>
        <BrowserRouter>
          <Routes>
            <Route index element={<FolderSelect />} />
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Navigate replace to="filetree" />} />
              <Route path="filetree" element={<FileTree />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </FileTreeProvider>
    </AppConfigProvider>
  );
}

export default App;
