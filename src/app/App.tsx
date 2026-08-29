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
      <UpdaterScreen />
    </div>
  );
}

export default App;
