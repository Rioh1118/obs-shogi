import { Outlet } from "react-router";
import { RuntimeProviders } from "@/app/providers/RuntimeProviders";
import { RequireRootDir } from "@/app/routing/guards/RequireRootDir";
import TitleBar from "@/shared/ui/TitleBar";

export default function RuntimeShell() {
  return (
    <RequireRootDir>
      <RuntimeProviders>
        <TitleBar />
        <div className="app-content">
          <Outlet />
        </div>
      </RuntimeProviders>
    </RequireRootDir>
  );
}
