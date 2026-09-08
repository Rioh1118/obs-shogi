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

        **これより上に置かないのは、そこでは枠を描けないから。** `main.tsx` で `<App />` を
        包むことはできるが、`.app-root` の外に出た fallback は `App.scss` の器を持たない。

        **受けるのはいちばん内側の境界。** 盤・解析ペイン・棋譜一覧・モーダルは `AppLayout` の
        境界が、ヘッダとサイドバーは `RuntimeShell` の境界が受け、どちらも本物の `TitleBar` を残す。
        ここまで上がるのは**境界の外に居るもの**が落ちたとき —— provider・guard・ルータ自身に
        加えて、`TitleBar` そのものと、`RuntimeShell` の外に居る `/` の起動画面
        （`AppLoading`）がある。
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
