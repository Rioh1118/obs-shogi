import { Outlet, useLocation } from "react-router";
import { RuntimeProviders } from "@/app/providers/RuntimeProviders";
import { RequireRootDir } from "@/app/routing/guards/RequireRootDir";
import TitleBar from "@/shared/ui/TitleBar";
import { AppErrorBoundary } from "@/shared/ui/AppErrorBoundary";

export default function RuntimeShell() {
  const { pathname } = useLocation();

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
          {/*
            **行き先が変わったら畳むのをやめる。** ここが受けるとヘッダもサイドバーも
            消えるので、`reset` を押す以外に出口が無くなる。`/app/panel/*` を移った時点で
            落ちた画面はもう描かれないのに、境界がそれを知らないと畳んだままになる。

            `key` にしないのは、`AppLayout` がサイドバーの開閉をローカル state で持っていて、
            パネルを移るたび既定に戻ってしまうため
          */}
          <AppErrorBoundary label="作業画面" resetKeys={[pathname]}>
            <Outlet />
          </AppErrorBoundary>
        </div>
      </RuntimeProviders>
    </RequireRootDir>
  );
}
