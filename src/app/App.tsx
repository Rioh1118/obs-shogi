import { BrowserRouter } from "react-router";
// リセットと基準文字サイズ。App.scss より前に読む
import "./styles/global.scss";
import "./App.scss";
import { BootstrapProviders } from "./providers/BootstrapProviders";
import AppRouter from "./routing/AppRouter";
import UpdaterScreen from "@/features/updater/ui/UpdaterScreen";
import { AppErrorBoundary } from "@/shared/ui/AppErrorBoundary";
import { RootErrorFallback } from "./RootErrorFallback";

function App() {
  return (
    <div className="app-root">
      {/*
        **最後の砦。** ここより上に境界は置けない（`createRoot` の直下）ので、
        これを抜けた例外は root ごと unmount する —— ウィンドウ枠も自前なので、
        残るのは閉じるボタンもドラッグ領域も無い窓になる。だから fallback は
        枠を自前で持つ `RootErrorFallback` にする。

        **普段ここまでは上がってこない。** 盤・解析ペイン・ヘッダ・サイドバーは
        `RuntimeShell` の境界が受け、そちらは本物の `TitleBar` を残す。ここが出るのは
        provider・guard・ルータ自身が落ちたときだけ。
      */}
      <AppErrorBoundary fallback={(_error, reset) => <RootErrorFallback retry={reset} />}>
        <BootstrapProviders>
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
        </BootstrapProviders>

        {/*
          **更新の知らせはルートの外に置く。** 畳んでいるのは `RequireRootDir` で、
          設定が読めないときとワークスペースが無いときに `/` へ飛ばす。その内側に
          置くと、**その状態を直す版が、その状態のせいで届かない。**

          `useUpdater` は context も router も要らないので、外に置いても何も失わない。
        */}
        <UpdaterScreen />
      </AppErrorBoundary>
    </div>
  );
}

export default App;
