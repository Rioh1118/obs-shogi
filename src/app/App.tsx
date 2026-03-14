import { BrowserRouter } from "react-router";
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
