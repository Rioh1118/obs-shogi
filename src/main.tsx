import Prism from "prismjs";
import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";

// @lexical/markdown が window.Prism をグローバルとして参照するため設定する
(window as unknown as Record<string, unknown>).Prism = Prism;

createRoot(document.getElementById("root")!).render(<App />);
