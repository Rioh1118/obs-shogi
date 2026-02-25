import { BrowserRouter } from "react-router";
import "./App.scss";
import { BootstrapProviders } from "./providers/BootstrapProviders";
import AppRouter from "./routing/AppRouter";

function App() {
  return (
    <div className="app-root">
      <BootstrapProviders>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </BootstrapProviders>
    </div>
  );
}

export default App;
