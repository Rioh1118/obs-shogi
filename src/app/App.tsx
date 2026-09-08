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
        **最後の砦。** これを抜けた例外は root ごと unmount する —— ウィンドウ枠も自前なので、
        残るのは閉じるボタンもドラッグ領域も無い窓になる。だから fallback は
        枠を自前で持つ `RootErrorFallback` にする。

        **これより上に置かないのは、`UpdaterScreen` を巻き込むから。** `main.tsx` で `<App />` を
        包むことはできる（`RootErrorFallback` は `position: fixed` なので器も要らない）が、
        そうすると本体の事故で更新の導線まで畳まれる —— 下の境界を分けた理由がそのまま消える。

        **受けるのはいちばん内側の境界。** どこに何枚あるか、どこまで枠が残るかは
        `docs/spec/screens/app-layout.md` の「失敗の見せ方」が持つ。**ここに写さない**
        —— 2箇所に置くと片方だけ直る。
      */}
      <AppErrorBoundary label="アプリ" fallback={(args) => <RootErrorFallback {...args} />}>
        <BootstrapProviders>
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
        </BootstrapProviders>
      </AppErrorBoundary>

      {/*
        **更新の知らせはルートの外に置く。境界の外でもある。** 畳んでいるのは
        `RequireRootDir` で、設定が読めないときとワークスペースが無いときに `/` へ飛ばす。
        その内側に置くと、**その状態を直す版が、その状態のせいで届かない。**
        同じ理由で境界も分ける —— provider が落ちて上の fallback が出ているときこそ、
        修正版を受け取る導線が要る。

        逆向きも分ける理由になる。ここが落ちてもアプリ全体を最後の砦へ落とさない。

        `useUpdater` は context も router も要らないので、外に置いても何も失わない。
      */}
      <AppErrorBoundary label="更新の知らせ" floating hint="更新は次の起動時にもう一度知らせます。">
        <UpdaterScreen />
      </AppErrorBoundary>
    </div>
  );
}

export default App;
