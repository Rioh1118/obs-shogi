# examples/

迷ったときの判断材料。good と bad を対で置く。

- good/：規則どおりの書き方。`npm run ds:build` で preview/examples.html に描画され、`npm run ds:shot` のスクリーンショットに入る。
- bad/：**悪い例。真似しない。** 各ファイルの先頭に、違反した規則を1行で書く。ds:check の通常の検査対象からは外し、代わりに「bad が必ず不合格になること」を自己テストで確かめる。ds:eval の採点ロジック（regex）の自己テストにも使う。
