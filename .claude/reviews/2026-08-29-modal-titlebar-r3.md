# レビュー modal-titlebar ラウンド3

- 日付: 2026-08-29
- 対象: `git diff bb29884..HEAD`（レビュー時点で17コミット）
- 走らせた reviewer: `ui` / `comment` / `robustness`
- 集計: HIGH 3 / MEDIUM 9
- 前ラウンド: r1（BLOCK 1 / HIGH 1 / MEDIUM 10）、r2（BLOCK 1 / HIGH 3 / MEDIUM 9）— いずれも全件対応済み

**r1 / r2 の再掲は無い。**

`robustness` は検査ファイルに **25通りの変異**を当てて素通り／検出を実測した。
`ui` は実 SCSS 97本を Chrome headless に当て、10種のモーダル × 6つの viewport 高 = 60通りを
`getBoundingClientRect` / `elementFromPoint` で実測した。
`comment` はコメント中の数値を1件ずつ再計算・実測した。

---

## 受入条件の確認（`ui`、実測）

issue #53 の3条件は成立している。10種のモーダル × viewport 高 900 / 760 / 719 / 400 / 300 / 288。

| 条件                           | 実測                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| タイトルバーを掴んで動かせる   | 60通りすべてで `elementFromPoint(768, 13)` が `data-tauri-drag-region` を持つ `.titlebar` を返す |
| ウィンドウ操作ボタンが押せる   | close / minimize / maximize の各中心で `elementFromPoint` がそのボタン自身を返す                 |
| overlay のクリックで閉じる挙動 | 60通りすべてでカード上端の直上（`padding` の帯）が `.modal__overlay` を返す                      |

帯の境は 26px でずれない（`(640, 25)` は `.titlebar`、`(640, 27)` は `.modal__overlay`）。

---

## 対応した所見

### [HIGH] 検査は「違反が無いこと」しか見ておらず、上限を書かない size を足すと素通りする

- reviewer: `robustness`（変異を実測）
- 対応: `cdffd22`（SCSS 側）/ `9c40cf7`（検査側）

`--size-md` から `max-height` を消す、あるいは上限を書かない `--size-xs` を新設すると、
検査は 4 passed のまま。Chrome 実測では viewport 873 でカード上端が 65.4px から **-1.5px** に
上がり、`elementFromPoint(640, 3)` が `titlebar` でなくカードの中身を返した。

検査を厚くするのでなく、`.modal__card` 自身に `max-height: 100%` を置いて構造で塞いだ。
size 側の規則は内側の意匠に限る。メディアクエリで上限を外していた `max-height: none` も
`100%` へ置き換える形にした。検査は「カード自身が上限を持つ」ことを見る。

### [HIGH] コメントの閾値が、到達できない規則に紐づいていた

- reviewer: `comment`（実測）
- 対応: `237c8cb`

「`88vh` ならウィンドウ高 217px」を `--size-md` / `--size-lg` の直上に書いていたが、
この2つは `@media (max-height: 720px)` が先に効くので `88vh` が生きるのは H > 720 のときだけ。
はみ出しの条件は H < 550 なので両立せず、**その規則では原理的に再現できない**。
実測でも `88vh` に戻して viewport 100px まで下げてカード上端は 46px のままだった。

217px が成立するのは `@media` の対象外である `--dialog.modal--size-xl`。
`--size-sm` の 130px は正しい。個別の数値でなく導出（`26 / (1 - k)`）と適用範囲を書く形に直した。

### [HIGH] `.presetDialog` のコメントの数値が実測と合わない

- reviewer: `comment` / `ui`（独立に実測して同旨）
- 対応: `10248bb`（コメント）/ `bfad603`・`a7a6a1c`（r2 報告書への取り消し）

「ウィンドウ高 236px でボタンが全部隠れる」は **r2 の `ui-reviewer` の外挿**であって実測ではない。
r2 の表の中ですでに矛盾していた（保存ボタン下端 258 < カード下端 268 なので切られていない）。

r3 の2人が独立に実測した境:

| 事象                           | 境      |
| ------------------------------ | ------- |
| フッタの下端が切られ始める     | H < 309 |
| 保存ボタンの下端が切られ始める | H < 245 |
| 保存ボタンが完全に隠れる       | H < 82  |

236px は「ボタンの下端が 2px 欠ける」高さで、押せる。
パネルがカードを超えてフッタが切られること自体は実在するので `7d62b96` の判断は変えない。
検算できない閾値をコメントから落とし、機構（カード基準の上限とフレックスの自動最小サイズ）で書き直した。

### [MEDIUM] 検査に、まだ素通りする改変が4通り残っていた

- reviewer: `robustness`（変異を実測）
- 対応: `9c40cf7`

| 改変                                                                    | 原因                                                                                                      |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `:is(.modal__overlay, .confirm-dialog-overlay) { inset: 0 }`            | 末尾の複合セレクタを空白で切っていた。sass はカンマ後に必ず空白を入れるので、ソースで詰めても避けられない |
| `.modal__overlay { inset-block: 0 }`                                    | 知らないプロパティを黙って捨てていた。実測で overlay 上端が 0 になり、ドラッグ領域も操作ボタンも死ぬ      |
| `min(100%, 88vh)` / `min(88vh, 100%, 700px)` / `clamp(0px, 88vh, 100%)` | 上限として正しく効くのに落ちていた（偽陽性）。引数の順序を固定していた                                    |
| `target.replace(".", "\\.")`                                            | 最初のドットしかエスケープしない。現在の3つの target では害が無い潜在                                     |

括弧の深さを見て切り、論理プロパティを展開し、辺を決めうるのに展開規則を持たない
プロパティが出たら**落とす**（fail-closed）。上限はどの引数が上限になるかで判定する。
8通りの変異で確認した。

### [MEDIUM] この修正を守る検査が、実際の故障箇所に届いていなかった

- reviewer: `ui`
- 対応: `1ff4d63`

r1 で「守る検査が無い」と言われて足した検査は `Modal.scss` と `TitleBar.scss` しか読まず、
r2 で見つかった退行（`.presetDialog` の `height: min(78vh, 760px)`）は対象外だった。
`max-height: 100%; min-height: 0` の2行を消しても全検査が通る状態だった。
`scssScaleRatchet` も `bucketOf` が `height` 系を分類しないので拾わない。

`src/features/**` の SCSS を走査し、`height` / `min-height` を viewport 単位で決めていながら
器に対する頭打ちを持たない規則を落とす検査を足した。
**`max-height` を `vh` で書くのは要素を大きくしないので対象外**にしたことで、
該当が `.presetDialog` だけになり許可リストが要らなくなった。

最初の実装は `min-height: 0` を「上限あり」と数えて変異を通していた。
上限になれるのは `max-height` と、それ自身が挟まれた `height` だけに直した。

### [MEDIUM] `max-height: 100%` が効く条件が書かれていない

- reviewer: `ui`
- 対応: `4478bd3`

百分率の `max-height` は器の高さが確定していないと `none` 扱いになる。
カードの高さが確定するのは `@media (max-height: 720px)` の側だけ。
それ以外ではカードが内容に合わせて伸びるので、そもそも超えない（`0.78H < 0.88H`）。
条件が無いと、大きいウィンドウで検算した読み手が「この行は何もしていない」と判断して消す。

### [MEDIUM] 「カード上端 20px」が既定ウィンドウでは起きない

- reviewer: `comment`（実測）
- 対応: `e7a8fa7`

カード上端が 20px になるのはカードが overlay の内容ボックスを埋めるときだけ。
既定ウィンドウ 1600x960 では `@media` が効かず、md のカードは 845px（内容ボックス 894px）で
帯には届かない。実測でも viewport 873 のカード上端は 95px。

条件を添えたうえで、この書き方を選ぶ一番の理由（塗り順の勝ち負けに依存させない）を前に出した。
カードの潜りは副次的な根拠として残す。

### [MEDIUM] `min-height: 0` の理由が書かれておらず、書かれている理由が機構と違う

- reviewer: `comment`
- 対応: `10248bb`

修正前にパネルが縮まなかったのは、カードが頭打ちだからではなく、
フレックスアイテムの自動最小サイズが指定高に解決されて `flex-shrink` が効かないため。
実測でも修正前のパネル高は viewport 288 で 224.6px = `0.78 × 288` ちょうどで 1px も縮んでいない。

### [MEDIUM] ラチェットの免除範囲の説明が実装と違う

- reviewer: `comment`
- 対応: `b70dcd8`

「直値を許すのはこのファイルだけ」は言い過ぎ。`scssScale.ts` の `scan()` が `tokenSource` で
落とすのは `indirect` の枠だけで、他の7枠は `index.scss` でも数える。
他ファイルの直値も禁止ではなく BASELINE で許容されている。

---

## 対応しなかった所見

### [MEDIUM] 小さいウィンドウで内容の少ないモーダルがカード全高に引き伸ばされる

- reviewer: `ui`（実測）
- **範囲外。issue #181 に切り出した。**

`@media (max-height: 720px)` の `height: 100%` により、1280×719 で `CreateFileModal` は
142px の中身に対して 653px のカードになり、約 490px の空白が残る。

**この差分が作ったものではない。** 変更前は `height: 92vh` = 661.5px で症状は同一（空白は 8px 大きかった）。
直すには `variant="dialog"` の「内容に合わせて縮む」性質を戻す設計判断が要り、
`.presetDialog` の百分率 `max-height` と同時に動かす必要がある。#53 の修正には不要。

### 既存の3本のテストも `process.cwd()` を使っている（r2 から継続）

- **範囲外。** まとめて別 PR で扱う。

---

## reviewer が検証して問題が無かった点

- **`.presetDialog` 以外の9つのモーダルは、カードを `min(vh, 100%)` で挟んだ後も実コンテンツで成立する**（`ui`、実測）。
  `SettingsPanel` / `PositionSearchModal` / `StudyPositionsManagerModal` / `StudyPositionSaveModal` /
  `PositionNavigationModal` は根が `height: 100%; min-height: 0` でカードに従属し、
  viewport 900〜288 の全域で `root.bottom - card.bottom = -1`（はみ出し 0）。
  `CreateFileModal` / `FileConflictDialog` / `KifuReadErrorDialog` はカードまたは `.modal__body` が
  スクローラで、2400px の中身でも最下部のボタンがカード内に収まる。
  `SfenKifuCreateModal` は根自身が `overflow-y: auto` で自動最小サイズが 0 になり縮む。
- **`7d62b96` は失敗経路を壊していない**（`robustness` / `ui`、実測）。viewport 288 で
  パネル `47..271.6` → `47..267`。`.presetDialog__body` が縮み、ヘッダ・フッタは `min-content` を保つ。
- **モーダルの中身で viewport 単位の高さを使うのは3箇所だけ**で、`.presetDialog` 以外の2つは
  `@container (max-width: 920px)` / `@media (max-width: 980px)` の内側にあり幅 1280 では発火しない。
- **1280 幅で xl の横並びの最小幅は足りている**（`ui`、実測）。4つのグリッドいずれも溢れない。
- **`TitleBar.scss` の z-index のコメントは正しい**（`ui` / `comment` が独立に確認）。
- **`ConfirmDialog` はタイトルバーと競合しない**（`position: absolute; z-index: 30`）。
- **検出されることを確認した変異**（`robustness`）: `@media` の中だけで `inset: 0` /
  `@media` の中だけでカードを `height: 92vh` / `@supports` で包んで `top: 0` / `top: 0 !important` /
  `:where(.modal__overlay) { top: 0 }` / `.modal__card:is(--scroll-card, --scroll-none) { height: 92vh }` /
  `top` を直値 `26px` に。等価な `inset: 2.6rem 0 0`（3値）は通る。

## 未検証

- **実機（Tauri / WKWebView）では動かしていない。** 実測はすべて Chrome headless に
  コンパイル済み SCSS を当て、React の描画は各モーダルの根から3〜4階層まで手で再現したもの
- headless は viewport 高 288px で下げ止まるため、245px / 82px の境は 288 / 613 の2点からの外挿
- `backdrop-filter` の y=26 の境の見た目、非整数 DPI でのスナップ
- `npm run verify:rust`（Rust に触れていない）

## 検証

`npm run verify` — 15 files / 136 tests passed。`npm run build` も通した。
