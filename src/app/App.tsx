import { BrowserRouter } from "react-router";
// リセットと基準文字サイズ。App.scss より前に読む
import "./styles/global.scss";
import "./App.scss";
import { BootstrapProviders } from "./providers/BootstrapProviders";
import AppRouter from "./routing/AppRouter";
import UpdaterScreen from "@/features/updater/ui/UpdaterScreen";

function App() {
  return (
    <div className="app-root">
      <BootstrapProviders>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </BootstrapProviders>

      {/*
        **更新の知らせは provider の外に置く。** 中に入れると、設定が読めない・
        ワークスペースが無いといった状態では出なくなる——つまり
        **その状態を直す版が、その状態のせいで届かない。**

        `useUpdater` は context も router も要らないので、外に置いても何も失わない。
      */}
      <UpdaterScreen />
    </div>
  );
}

export default App;
