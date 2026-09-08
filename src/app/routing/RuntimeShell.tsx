import { Outlet } from "react-router";
import { RuntimeProviders } from "@/app/providers/RuntimeProviders";
import { RequireRootDir } from "@/app/routing/guards/RequireRootDir";
import TitleBar from "@/shared/ui/TitleBar";
import { AppErrorBoundary } from "@/shared/ui/AppErrorBoundary";

export default function RuntimeShell() {
  return (
    <RequireRootDir>
      <RuntimeProviders>
        <TitleBar />
        <div className="app-content">
          {/*
            **境界は `TitleBar` より下に置く。** 盤・解析ペイン・ヘッダ・サイドバーは
            この下に居るので、ここで受ければ枠が残り、ウィンドウを動かすことも
            閉じることもできる。root の境界まで上げると枠ごと差し替わる。
          */}
          <AppErrorBoundary label="作業画面">
            <Outlet />
          </AppErrorBoundary>
        </div>
      </RuntimeProviders>
    </RequireRootDir>
  );
}
