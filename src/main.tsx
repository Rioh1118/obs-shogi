/*
  同梱する書体。**読み込む face を綴りで固定する。**

  - `latin` のサブセットだけを取る。この3書体が描くのは看板の "obs" / "shogi"、
    起動画面の "Loading"、解析ペインの時計の数字だけで、日本語の字形は使わない
    （日本語は OS の書体。`src/index.scss` の `$font-sans`）
  - **weight を増やさない。** SCSS 側には 500 / 600 / 800 の指定があるが、
    対応する face を読み込んでいないので現に隣へ落ちている。ここへ face を足すと
    見た目が変わる
  - 可変フォント版（`@fontsource-variable/*`）は使わない。latin だけなら
    静的サブセットのほうが小さい

  **`index.html` から `<link>` で読まない。** 配布物の CSP が外部オリジンを落とすので、
  dev でだけ効く指定になる（→ #503）。**`.scss` からも読まない。**
  `knip.json` の `project` は `ts,tsx` だけなので、依存が未使用と判定される。
*/
import "@fontsource/orbitron/latin-700.css";
import "@fontsource/zen-kaku-gothic-antique/latin-700.css";
import "@fontsource/lato/latin-400.css";

import Prism from "prismjs";
import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";

// @lexical/markdown が window.Prism をグローバルとして参照するため設定する
(window as unknown as Record<string, unknown>).Prism = Prism;

createRoot(document.getElementById("root")!).render(<App />);
