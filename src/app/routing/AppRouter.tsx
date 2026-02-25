import { Navigate, Route, Routes } from "react-router";
import RuntimeShell from "./RuntimeShell";

import AppLayout from "@/pages/AppLayout";
import AppLoading from "@/pages/AppLoading";
import FileTree from "@/widgets/file-tree/ui/FileTree";

function AppRouter() {
  return (
    <Routes>
      <Route index element={<AppLoading />} />

      <Route element={<RuntimeShell />}>
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<Navigate replace to="panel/filetree" />} />
          <Route path="panel">
            <Route path="filetree" element={<FileTree />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}

export default AppRouter;
