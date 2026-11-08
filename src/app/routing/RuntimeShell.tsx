import { Outlet, useLocation } from "react-router";
import { RuntimeProviders } from "../providers/RuntimeProviders";
import { RequireRootDir } from "./guards/RequireRootDir";
import TitleBar from "@/shared/ui/TitleBar";
import { AppErrorBoundary, BOUNDARY_LABELS } from "@/shared/ui/AppErrorBoundary";
import { ErrorFallbackBody, RETRY_LABEL } from "@/shared/ui/error-fallback/ErrorFallbackBody";

export default function RuntimeShell() {
  const location = useLocation();

  return (
    <RequireRootDir>
      <RuntimeProviders>
        <TitleBar />
        <div className="app-content">
          {/*
            境界は `TitleBar` より下に置く。盤・解析ペイン・ヘッダ・サイドバーは
            この下に居るので、ここで受ければウィンドウ枠が残り、ウィンドウを動かすことも
            閉じることもできる。root の境界まで上げるとウィンドウ枠ごと差し替わる。
          */}
          {/*
            どこかへ移ったら境界をリセットする。`pathname` でなく `location.key` を見るのは、
            `?modal=` や `?tesuu=` を動かす遷移が `pathname` に出ないため。

            **unmount している間は、遷移を起こす導線が画面に残らない。** ここが受けるとヘッダも
            サイドバーも消えるので、`?modal=` を含めて `location.key` を動かす操作が利用者側に無い。
            実際の復帰は案内（`hint`）が言う「ウィンドウを閉じて開き直す」になる。TODO(#511): ウィンドウを開き直さずに戻れるようにする

            React の `key` で部品ごと作り直すのは採らない。`AppLayout` がサイドバーの開閉を
            ローカル state で持っているので、遷移のたび既定へ戻る。境界をリセットするだけでよい
          */}
          <AppErrorBoundary
            label={BOUNDARY_LABELS.shell}
            resetKeys={[location.key]}
            fallback={(view) => (
              <ErrorFallbackBody
                {...view}
                hint={`「${RETRY_LABEL}」で戻らない場合は、ウィンドウを閉じて開き直してください。`}
              />
            )}
          >
            <Outlet />
          </AppErrorBoundary>
        </div>
      </RuntimeProviders>
    </RequireRootDir>
  );
}
