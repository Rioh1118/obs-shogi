import { BrowserRouter, Route, Routes } from "react-router";
import FolderSelect from "./pages/FolderSelect";
import AppLayout from "./pages/AppLayout";
import { AppConfigProvider } from "./contexts/AppConfigContext";

function App() {
  return (
    <AppConfigProvider>
      <BrowserRouter>
        <Routes>
          <Route index element={<FolderSelect />} />
          <Route path="/app" element={<AppLayout />} />
        </Routes>
      </BrowserRouter>
    </AppConfigProvider>
  );
}

export default App;
