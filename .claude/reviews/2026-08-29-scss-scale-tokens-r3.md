# レビュー scss-scale-tokens ラウンド3

- 日付: 2026-08-29
- 範囲: `issue-160/scale-tokens` の `git diff main...HEAD`（28コミット）
- 対象コミット: `deaa03e`
- 走らせた reviewer: `robustness` / `comment` / `ui`
- 前ラウンド: r1（BLOCK 1 / HIGH 8 / MEDIUM 15、全件対応済み）、r2（BLOCK 1 / HIGH 3 / MEDIUM 9、全件対応済み）

**r1 / r2 の所見の再掲は無い。以下は全て、r2 の修正で新しく入った問題か、対応が不十分だったもの。**

---

## 所見

### [HIGH] `includeArguments()` だけがコメントと文字列を見ない

- reviewer: `robustness` / `comment`（**2人が独立に指摘**）
- 場所: `src/__tests__/scssScale.ts:214-243,296-303`

`declarations()` は状態機械を持つようになったが、`includeArguments()` は**生の `source`** を素の正規表現で舐める。
同じファイルの同じ文字列に対して、コメント認識のある経路と無い経路が同居している。

| 入力                                | 結果                                        |
| ----------------------------------- | ------------------------------------------- |
| `// @include size(1.37rem);`        | `indirect` **+1**（コメントアウトを数える） |
| `/* @include size(1.37rem); */`     | `indirect` **+1**                           |
| `content: "@include size(1.37rem)"` | `indirect` **+1**                           |

リポジトリ全体でも再現。`IconButton.scss` の先頭に `// 例: @include btn-size(1.2rem, …) のように書く` を
1行足すと `indirect` 53 → 54 で落ちる。メッセージは「トークンを使うこと」だが、書いたのはコメントなので
寄せ先が無い。`scale-exempt` を付けると今度は `exempt` が 0 → 1 で落ちる。
**コメントを1行書いた人が、規約どおりの手順では緑に戻せない。**

逆方向も実測: `IconButton.scss:47` の `@include` をコメントアウトしても `indirect` は減らない。

**r1 の実装は `blankComments(original)` に掛けていたので、この2件は0件だった。`0cf3083` の切り出しで落ちた。**

---

### [HIGH] エスケープされた引用符でファイルの残りが落ち、文書の復帰手順がそれを恒久化する

- reviewer: `robustness`
- 場所: `src/__tests__/scssScale.ts:164-173`、`CONTRIBUTING.md:206-220`

バックスラッシュ待避を見ていないので、`content: "\""` の2文字目で文字列を閉じ、3文字目で**新しい文字列を開く**。
以後 `;` `{` `}` が文字列の中身として扱われ、次の引用符まで切り出しが止まる。

実測: `IconButton.scss` に `.probe::after { content: "\"" }` を1行差し込むと、
そのファイルの findings が **6件 → 3件**。差し込んだ行とは無関係な既存の3宣言が消える。

`toBe` なので赤くなるが、出るメッセージは **「減ったなら BASELINE を 250 に下げること」**。
`CONTRIBUTING.md:210` も同じことを言う。**走査器のバグを、規約が指示する手順で基準値に焼き付ける。**
下がった枠は「下げる方向にだけ」の規律で二度と戻らず、そこに新しい直値を3件書いても緑になる。

現状 `\"` は0件なので基準値は正しい。

---

### [HIGH] Sass の補間 `#{}` が宣言を途中で切る（実在7箇所）

- reviewer: `robustness`
- 場所: `src/__tests__/scssScale.ts:195-198`、`widgets/game-board/ui/{Board,GameBoard,Hand}.scss`

`#{` の `{` で宣言を確定してしまう。実際に `declarations()` が返しているもの:

```
Hand.scss:13       font-size: calc(100cqw / #
GameBoard.scss:26  grid-template-columns: minmax(0, 1fr) minmax(0, #
GameBoard.scss:37  width: min(        100%,        #
Board.scss:25      inset: #
```

切られた残りは次の `;` で flush されるが `:` を含まないので**捨てられる**。

```scss
padding: #{$x}rem 1.37rem; // → spacing 0件（1.37rem が消える）
```

**r1 報告書は「実測で使用例は0件」と書いたが、その実測は誤り。`#{` は main に7箇所ある。**
しかも r2 の文字走査は、検出しないだけでなく**宣言を分断する**ぶん挙動が悪化している。

---

### [HIGH] `exempt` の枠は「基準値は下げる方向にだけ」に阻まれて一度も使えない

- reviewer: `comment`（`robustness` が MEDIUM で同旨）
- 場所: `CONTRIBUTING.md:210,228`、`docs/decisions/0003:132,135-136`、`scssScaleRatchet.test.ts:6-19`

印を1つ足すと、元の枠が1減り `exempt` が 0 → 1 になる。つまり **`BASELINE` を2箇所、片方は上向きに**
書き換えないと通らない。ところが規約は「下げる方向にだけ動かす」「増やす変更は通さない」と**3箇所で明言**している。

**規約に忠実な人は印を使えず、使った人は規約違反として指摘される。**
現に `scale-exempt` は `src/**/*.scss` に **0件**で、この機構は利用者ゼロのまま導入されている。

失敗メッセージにもこの場合の分岐が無い。`exempt` が 0 → 1 で落ちたとき出る3つの案内
（「トークンを使え」「1 に下げること」「exempt の枠へ移せる」）は**全て的外れ**で行き止まりになる。

---

### [MEDIUM] `isExempt` の行範囲判定が、印を書いていない隣の宣言まで免除する

- reviewer: `robustness`
- 場所: `src/__tests__/scssScale.ts:279-281`

r2 は「印1つで行全体が抜ける」を直すために判定を行から行範囲へ広げたが、その結果
複数行にまたがる宣言の範囲に他の宣言の印が入るようになった。

```scss
.a {
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.2),
    0 2px 4px rgba(0, 0, 0, 0.1);
  font-size: 1.2rem; // scale-exempt
}
// → elevation ではなく exempt +1、font-size も exempt +1
```

`box-shadow` を複数行に書くのはこのリポジトリの標準（`index.scss` 自身がそう）。

---

### [MEDIUM] 29件の fixture は件数しか見ていない。軸がいくつも抜けている

- reviewer: `robustness`
- 場所: `src/__tests__/scssScale.test.ts:4-6`

| 抜けている軸                           | 影響                                                               |
| -------------------------------------- | ------------------------------------------------------------------ |
| `Finding.line` / `Declaration.endLine` | 失敗メッセージと `isExempt` が全部これに依存するのに、回帰しても緑 |
| `scan(source, { tokenSource: true })`  | `index.scss` 専用の分岐が一度も実行されない                        |
| Sass の補間 `#{}`                      | 上の HIGH                                                          |
| コメント・文字列の中の `@include`      | 上の HIGH                                                          |
| エスケープされた引用符                 | 上の HIGH                                                          |
| `@media` / `@each` / `@for`            | `@each $n, $v in (a: 1rem)` はマップごと 0件                       |
| `RAW_RADIUS` の `%`                    | r1 の BLOCK（48件）の再発検知が無い                                |

**ADR の自己診断（走査器にテストが無いと穴が件数の減少としてしか現れない）は正しいが、
置かれた29件はその診断が名指しした軸をほとんど覆っていない。**

---

### [MEDIUM] 動的 import の検査が `.ts` 直下しか見ない

- reviewer: `robustness`
- 場所: `src/__tests__/scssScaleRatchet.test.ts:96-105`

`readdirSync(here).filter((name) => name.endsWith(".ts"))` は再帰せず、`.tsx` も見ない
（`"a.tsx".endsWith(".ts")` は false）。lint の override は `.tsx` とサブディレクトリを含むが、
それが捕まえるのは静的 import だけ。**`src/__tests__/foo.test.tsx` の `await import("@/shared/x")` は
lint も vitest も両方通る。** レンダリングを伴う横断検査は `.tsx` になるので、抜けている側が実際に使われる側。

正規表現 `["'`]@\/(app|…)\//g`は末尾スラッシュを要求するので`vi.mock("@/shared")` も当たらない。

---

### [MEDIUM] 駒台の修正は、唯一の呼び出し元では描画されない。係数の出所も書かれていない

- reviewer: `robustness` / `comment` / `ui`（**3人が独立に指摘**）
- 場所: `src/entities/position/ui/BoardPreview.scss:141-143,170-173`、`PositionPreviewPane.tsx:65`

`BoardPreview` の唯一の利用者は `PositionPreviewPane` で **`showHands={false}`** を渡すため、
`renderHands()` は常に `null`。**この2行は現時点で到達不能。**

`ui` が実測した各サイズでの値:

| `size`              | `__hand-label` | `__hand-empty` | `__coordinate` | 旧         |
| ------------------- | -------------- | -------------- | -------------- | ---------- |
| `small`(180)        | **4.5px**      | **3.75px**     | 10px（上書き） | 7.5 / 6.25 |
| `medium`(300)       | 7.5px          | 6.25px         | 6.67px         | 7.5 / 6.25 |
| `large`(440)        | 11px           | 9.17px         | 14px（上書き） | 7.5 / 6.25 |
| 240（実行時の下限） | 6px            | 5px            | 5.33px         | 7.5 / 6.25 |
| 820（実行時の上限） | 20.5px         | 17.1px         | 18.2px         | 7.5 / 6.25 |

`small` で **font-weight 600 の見出しが座標数字の 2.2 分の 1** という逆転が起きる。
`__coordinate` は `data-size` で px に固定されているので、**「兄弟と同じ考え方」は small / large では偽。**
r2 の BLOCK と同じ形が別の行に移っただけになっている。

`0.225` / `0.1875` の出所（既定 300px で従来の 7.5px / 6.25px と一致するよう逆算した値）も書かれていない。
同じルールの `min-width: 3rem` と兄弟の `&__hands { gap: 0.5rem }` は固定値のまま。

---

### [MEDIUM] `overflow: auto` を足したのにスクロールバーを戻していない。既存5箇所は戻している

- reviewer: `robustness` / `ui`（**2人が独立に指摘**）
- 場所: `src/pages/AppLayout.scss:52`、`src/app/styles/global.scss:36-43`

**`safe center` 自体は正しく効くことが実測で確認されている。**

| 幅1280 × 高さ           | main                         | この HEAD                      |
| ----------------------- | ---------------------------- | ------------------------------ |
| 800                     | top **-5.1**（上端が切れる） | top **56**、`maxScrollTop 144` |
| 900                     | top **44.9**（上下が切れる） | top **56**                     |
| 1050 / 1200（入りきる） | top 119.9 / 213.9            | **完全に同一**                 |

問題は復帰の案内。`global.scss` が全要素のスクロールバーを消しており、
既存のスクロール領域5箇所（`Modal.scss:34-51,98-110` / `KifuForkMenu.scss:38-53` /
`StudyPositionsManagerModal.scss:238-246` / `EnginePresetEditDialogPanel.scss:44-56` /
`BranchList.scss:60-73`）は**どれも自前で `scrollbar-width: thin` と `::-webkit-scrollbar { display: block }` を戻している。**
新設した `.app-layout__empty` だけ戻していない。

**続きがあることを示す手がかりが画面上に1つも無く、ホイールを試した人だけが一覧に到達できる。**
`AppLayout.scss:50` の「スクロールで届く」は、届く手段があることしか言っていない。

---

### [MEDIUM] `$radius-N` と `$space-N` が同じ連番なのに1段ずれている

- reviewer: `ui`
- 場所: `src/index.scss:33-44,46-56`

`$radius-N` = `$space-(N+1)`。`$space-6` は 1.2rem、`$radius-6` は 1.4rem。

改名前は `$radius-xs`…`$radius-3xl` で名前の形が違うため取り違えようがなかった。
同じ `$name-N` に揃えたことで「同じ N なら同じ値」という読み方が成立してしまう。

`padding: 1.2rem; border-radius: 1.2rem;` を寄せる人が `$space-6` と `$radius-6` と書けば
**角丸だけ 1.4rem になる。両方ともトークン参照なので件数は動かず、`verify` は緑のまま。**
レビューでも `$space-6` / `$radius-6` は正しく見える。

---

### [MEDIUM] 段を欠けなく張ったのは長さだけ。モーションに 140ms（25件）と 200ms（20件）の寄せ先が無い

- reviewer: `ui`
- 場所: `src/index.scss:60-64`、`docs/decisions/0003:93-94,104-106`

走査器で数え直した `motion` 枠の分布:

| 値              | 件数      | 段                     |
| --------------- | --------- | ---------------------- |
| 100ms           | 23        | `$duration-fast`       |
| **120ms**       | 52        | `$duration`            |
| **140ms**       | **25**    | **無し**（12ファイル） |
| 160ms           | 15        | `$duration-slow`       |
| **200ms**       | **20**    | 無し                   |
| 80 / 90 / 150ms | 8 / 4 / 9 | 無し                   |

**140ms は 120ms と 160ms のちょうど中間**で、ADR がその2段落上で「やってはいけない」と名指しした状態そのもの。
`df34c51` は長さの2系統だけを直し、同じコミットで触った ADR §4 のモーションの段は据え置いた。

角丸も同型で1件。改名の動機に「**下**にも段を足せなくなる」を挙げているが、
その下の段（`border-radius: 0.2rem`、`Board.scss:17` と `PromotionDialog.scss:61` の2件）は張られていない。

---

### [MEDIUM] 「トークンの最初の利用者」にした `ContextMenu.scss` に、トークンと1バイト違わない直値が4件残っている

- reviewer: `ui`
- 場所: `src/widgets/file-tree/ui/ContextMenu.scss:27,40-43`

```scss
font-size: 1.4rem; // ← index.$font-lead と同値
transition:
  background-color 120ms ease,
  // ← index.$duration / index.$ease と同値
  color 120ms ease,
  box-shadow 120ms ease;
```

r2 が `$shadow-overlay` について指摘した状態が、**その修正を入れた当のファイルの中で4件続いている。**
このコミットは「最初の利用者にする」と名乗っているので、次にトークンを使う人はこれを手本にし、
「一部だけ寄せればよい」形をコピーする。

---

### [MEDIUM] ADR §4 の「刻みは実測の最大値まで欠けなく張る」が、間隔について偽

- reviewer: `comment`
- 場所: `docs/decisions/0003:93`

間隔の実測の最大値は 2.4rem ではない。`FolderSelect.scss:19` の `margin: 10rem auto`、
`Title.scss:11` の `8rem`、`AppLayoutHeader.scss:10` の `gap: 4rem`、`Form.scss:6` の `padding: 2rem 3rem`。
`gap` だけに絞っても最大は 4rem。

**2.4rem より上は段が1つも無いので、`padding: 3rem` を新しく書く人は寄せ先が無く、
直値はラチェットで止まり、`scale-exempt` は上の HIGH のとおり使えない。**
なお `src/index.scss:32` は「2.4rem まで」と事実どおりで、ADR とだけ食い違っている。

---

### [MEDIUM] `CONTRIBUTING.md` が `family` 枠を説明しておらず、埋め込んだ基準値も古い

- reviewer: `comment`
- 場所: `CONTRIBUTING.md:184,216-218`

`grep -n "mono\|font-family\|等幅\|family" CONTRIBUTING.md` は **0件**。
一方 `BASELINE.family: 18` は実在し、9つ目の逐語コピーで落ちる。
落ちた人が寄せ先の名前を知る手段は ADR の1行だけ。

失敗メッセージの例に埋め込んだ `基準値 529 件` / `BASELINE を 526 に下げること` は
r1 時点の値で、現在の `spacing` は **528**。

---

### [MEDIUM] Q-005 が 🟡 なので週次レビューの入力に乗らない

- reviewer: `comment`
- 場所: `docs/OPEN-QUESTIONS.md:76`、`docs/OPERATING-MODEL.md:59`

r1 の HIGH を直した理由は明示的に「`OPEN-QUESTIONS.md` に載れば週次レビューの入力2に自動で乗る」だった。
**入力2は 🔴 だけを見る。** Q-005 は 🟡 なので、依然としてどの定例入力にも乗らない。
本文自身が `#157` のブロッカーだと宣言しており、同じくブロッカーの Q-001 は 🔴 なので色の付け方も揃っていない。

---

### [LOW] ADR §4 の1行が段落から離れて迷子になっている

- reviewer: `comment`
- 場所: `docs/decisions/0003:96-97` と `:109`

**重複ではない**（`:96` はサイズ名を却下、`:109` は役割名を却下で対象が違う）。
問題は順序で、`:109` は `:97` の続きであるべきなのに、間に箇条書きが11行挟まっている。

---

## 重複・矛盾した所見

| 箇所                                    | reviewer                               | 深刻度   |
| --------------------------------------- | -------------------------------------- | -------- |
| `includeArguments()` がコメントを見ない | `robustness` / `comment`               | **HIGH** |
| `exempt` が規約と矛盾して使えない       | `comment`(HIGH) / `robustness`(MEDIUM) | **HIGH** |
| 駒台の修正が到達不能・係数の出所        | `robustness` / `comment` / `ui`        | MEDIUM   |
| スクロールバーを戻していない            | `robustness` / `ui`                    | MEDIUM   |

**矛盾する提案は無い。**

## 見ていない範囲

- 実機（Tauri の WKWebView）での描画。`ui` の計測は headless Chrome で、
  フォントが無いため絶対値は実機とずれる（`safe` の有無の比較には影響しない）
- ビルド後 CSS に `place-items: center` が**他に21件**あり、切れるものがあるかは未調査
- ADR §1 の実測表と §4 の「約89% / 約83%」は誰も数え直していない
- `%` / `vh` / `vw` / `ch` 単位の間隔は `RAW_LENGTH` の対象外。コメントが嘘をついていないため所見にしていない

## lint / hook で強制できるもの

| 対象                                              | 手当て                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| コメント中の `@include` / 補間 / エスケープ引用符 | **どれも合成 SCSS を食わせるだけで再現する。** fixture を足す     |
| `BASELINE` が下がったコミットに理由の記載を要求   | 走査器のバグによる「黙って減る」を人のレビューに載せる唯一の手段  |
| `$space-N` と `$radius-N` の N のずれ             | 同じ接尾辞の連番トークン群で、同じ N が同じ値を指さないなら落とす |
| `overflow: auto` なのに `scrollbar-width` が無い  | 現在の違反は1件のみなので基準値0で導入できる                      |
| トークンと1バイト違わない直値                     | r2 が挙げて未実装。その間に `ContextMenu` に4件入った             |
| 見出しに「ブロッカー」を含む問いが 🔴 以外        | 正規表現1本                                                       |

**機械で防げないもの:** `0.225` の出所、コメントが実装と一致しているか、
`scale-exempt` を付けた宣言がその後も描画されているか。

## 次ラウンドの対象

HIGH 4件・MEDIUM 12件・LOW 1件。**ラウンド4が必要。**

---

## ラウンド3 の対応結果

HIGH 4件・MEDIUM 12件・LOW 1件すべてを処理した。**見送りは0件。**

### 方針の変更 — 自前パーサをやめた

HIGH 3件（コメント中の `@include` / エスケープ引用符 / 補間）と MEDIUM 3件は、
どれも自前パーサの穴だった。**3ラウンド続けて同じ場所から出ている**ので、
`postcss-scss` に差し替えてこのクラスごと消した（`d5b2168`）。

ADR-0003 が「直値を数えるだけなら構文解析は要らない」と書いていた判断は
**反証として ADR に書き直した**。stylelint と違いツールチェーンは増えず、引き続き vitest で走る。

**差し替えの前後で8枠すべての件数が変わらない**ことを確認している。
fixture は 29件 → 45件（所見の行番号 / `tokenSource` / 補間 / `@media` / `@each` / `@if` /
エスケープ引用符 / pill と円の軸を追加）。

| 所見                                         | コミット                                      |
| -------------------------------------------- | --------------------------------------------- |
| `includeArguments` がコメントを見ない        | `d5b2168`                                     |
| エスケープされた引用符                       | `d5b2168`                                     |
| Sass の補間 `#{}`                            | `d5b2168`                                     |
| `isExempt` の行範囲                          | `d5b2168`（「直後に続く行末コメント」に変更） |
| fixture の軸不足                             | `d5b2168`                                     |
| `exempt` が規約と矛盾して使えない            | `b62bb93`                                     |
| 駒台（到達不能・係数の出所・small で 4.5px） | `b62bb93`（**r2 の修正を差し戻した**）        |
| `$radius-N` と `$space-N` の1段ずれ          | `5d79e0d`                                     |
| モーションの 140ms / 200ms、角丸の 0.2rem    | `5d79e0d`                                     |
| ADR「実測の最大値まで」が偽                  | `5d79e0d`                                     |
| `ContextMenu` に残る4件                      | `ed33167`                                     |
| スクロールバーを戻していない                 | `8de7e89`                                     |
| 動的 import 検査が `.ts` 直下のみ            | `6e51a27`                                     |
| Q-005 が 🟡                                  | `6e51a27`                                     |
| `CONTRIBUTING` の `family` と古い基準値      | `b62bb93`                                     |
| ADR §4 の1行の置き場所（LOW）                | `5d79e0d`                                     |

### r2 の修正を差し戻したもの

**駒台を `calc(var(--square-size) * 0.225)` にした r2 の BLOCK 修正は行き過ぎだった。**
`ui` が実測で `size="small"`（盤 180px）で 4.5px まで落ちること、
兄弟の `__coordinate` は `data-size` ごとに px で固定されており
「兄弟と同じ考え方」が成立しないことを示した。固定値に戻し、`scale-exempt` で除外する。
**これが印の最初の利用者になった**（`exempt: 0 → 2`）。

### 最終的な基準値

font-size 251 / border-radius 178 / spacing 528 / elevation 79 / motion 79 /
family 18 / indirect 53 / exempt 2
