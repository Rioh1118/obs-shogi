## デザインシステム
- UI・SCSS・画面上の文言を作る／直す前に、obs-shogi-design-system スキルを使う。
- 色・余白・角丸・文字サイズ・太さ・影は、`src/index.scss` の名前（`index.$font-body` など）だけを使う。hex・rgb()・任意の px を書かない。
- スタイルは部品ごとの .scss。Tailwind・CSS-in-JS・CSS Modules は使わない。
- 既存の部品（`src/shared/ui/`）を使う。新しい部品やトークンが要るときは、作る前に聞く。
- 盤・駒台・駒は実物の画像で、トークンの対象外。
