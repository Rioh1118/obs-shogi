import { Outlet, useLocation } from "react-router";
import { RuntimeProviders } from "@/app/providers/RuntimeProviders";
import { RequireRootDir } from "@/app/routing/guards/RequireRootDir";
import TitleBar from "@/shared/ui/TitleBar";
import { AppErrorBoundary } from "@/shared/ui/AppErrorBoundary";

export default function RuntimeShell() {
  const location = useLocation();

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
            **どこかへ移ったら畳むのをやめる。** `pathname` でなく `location.key` を見るのは、
            `?modal=` や `?tesuu=` を動かす遷移が `pathname` に出ないため。

            **いま `/app` の下で行き先が動く経路はほとんど無い。** `panel/*` は `filetree` の
            1本だけで、この境界が受けるとヘッダもサイドバーも消えるので、利用者が遷移を
            起こす導線は残らない。実際の復帰は案内（`hint`）が言う「窓を開き直す」になる → #511

            `key` を使わないのは、`AppLayout` がサイドバーの開閉をローカル state で持っていて、
            遷移のたび既定に戻ってしまうため
          */}
          <AppErrorBoundary
            label="作業画面"
            resetKeys={[location.key]}
            hint="再表示で戻らない場合は、ウィンドウを閉じて開き直してください。"
          >
            <Outlet />
          </AppErrorBoundary>
        </div>
      </RuntimeProviders>
    </RequireRootDir>
  );
}
