# レビュー modal-titlebar ラウンド5

- 日付: 2026-08-29
- 対象: `git diff bb29884..HEAD`（レビュー時点で37コミット）
- 走らせた reviewer: `comment` / `robustness`
- 集計: HIGH 1 / MEDIUM 9
- 前ラウンド: r1（BLOCK 1 / HIGH 1 / MEDIUM 10）、r2（BLOCK 1 / HIGH 3 / MEDIUM 9）、
  r3（HIGH 3 / MEDIUM 9）、r4（HIGH 1 / MEDIUM 10）— いずれも全件対応済み

**r1〜r4 の再掲は無い。**

`ui` は走らせていない。r4 で440点の実測をして所見なしと結論しており、
r4 以降の差分は検査ファイルとコメントだけで SCSS の宣言が動いていないため。

**10件すべてが、私が足した検査ファイル自身と、そこに書いたコメントの欠陥。**
issue #53 の修正そのもの（overlay の `top` とカードの高さの上限）への指摘は
r3 以降1件も出ていない。

---

## 対応した所見

### [HIGH] 失敗文言が、判定がもう受け付けない書き方を「上限として効く」と教えていた

- reviewer: `comment`
- 対応: `15bc8f0`

r4 の `b284e12` で `clamp()` の第1引数（下限）を見るようにしたのに、失敗文言だけが
r3 の `9c40cf7` 時点のままだった。落ちた人が文言どおり `clamp(32rem, 78vh, 100%)` と
書くと、第3引数は `100%` なのにまた同じ文言で落ちる。**文言に従っても直らないループ。**

### [MEDIUM] 表テストが、r4 で直した4点のうち2点を守っていなかった

- reviewer: `robustness` / `comment`（独立に変異を実測して同旨）
- 対応: `15bc8f0`

固定できていたのは `isBounded` と高さの拾い方だけ。次の変異がいずれも素通りした。

| 緩める変異                                            | 何が戻るか                                          |
| ----------------------------------------------------- | --------------------------------------------------- |
| `unconditional` を常に `true`                         | 基底の上限を `@media` の中へ移せる（r4 が塞いだ穴） |
| 疑似要素の除外を外す                                  | 疑似要素を本体として数える（r4 が塞いだ穴）         |
| `lastCompound` を素朴な空白分割へ                     | `:is()` の素通り（r3 が塞いだ穴）                   |
| `min()` の判定を常に `true`                           | `min(80vh, 700px)` が上限として通る                 |
| `expandInset` の上下を入れ替える / `LOGICAL` を無効化 | `inset` 短縮形と論理プロパティの展開が壊れる        |

`expandInset` と `LOGICAL`（r3 が `inset-block: 0` の素通りを塞ぐために足したもの）は
現行の SCSS が使っていないため、**実 CSS でも表でも一度も実行されていなかった**。
辺の展開・`lastCompound`・疑似要素・`unconditional` の表を足した。

### [MEDIUM] 単一コロンの `:after` が疑似要素として除外されていなかった

- reviewer: `robustness`
- 対応: `15bc8f0`

sass は `:after` を `::after` へ正規化しない。綴りを1文字変えるだけで、
r4 が直した「疑似要素を本体として数え、正しい変更を落として誤った直し方へ誘導する」が戻る。

### [MEDIUM] `block-size` を見ていなかった

- reviewer: `comment`
- 対応: `15bc8f0`

辺の側では論理プロパティをわざわざ展開しているのに、高さの側は物理だけ。
`.presetDialog` の `height: min(78vh, 760px)` を `block-size` に書き換えるだけで、
r2 の退行が黙って戻る。`FORCING_HEIGHT` と正規表現に `block-size` / `min-block-size` を足した。

### [MEDIUM] `clamp()` の下限が `0vh` / `0pt` のとき、正しいのに落としていた

- reviewer: `robustness`
- 対応: `15bc8f0`

`/^0(px|%|rem|em)?$/` が単位を限定していた。ゼロ長は単位に関係なく `100%` 以下。
しかも唯一許していた裸の `0` は sass が長さとして受け付けないので、
文言どおり直そうとするとビルドが落ちる形になっていた。

### [MEDIUM] 「`height: auto` は上限にならない」の枝が到達しない

- reviewer: `robustness` / `comment`（独立に同旨）
- 対応: `15bc8f0`

`min-height` があると短絡するので、`auto` の除外に到達するのは同じ規則に `height` が
2回書かれた場合だけ。`!== "auto"` を丸ごと消しても表テストは通っていた。
**r2 で直した「`it` の名前が保証していない性質を約束する」と同じ形が、
その指摘を受けて足した表の中に入っていた。** 枝を落とし、ケースを実際に通る経路に置き換えた。

### [MEDIUM] 冒頭コメントの「素通りする形」の列挙が実装と食い違っていた

- reviewer: `comment`
- 対応: `15bc8f0`

「器より大きくなりうるのは `height` と `min-height` **だけ**」が、
同じファイルの「`grid-template-rows` / `flex-basis` で高さを決めた場合は素通りする」と
正面から食い違う。また「見るのは `src/features/**` の…だけ」は `.modal__card` を
見ている検査を勘定に入れていない。実際に見ている範囲へ直した。

### [MEDIUM] 「カードが内容ボックスを埋める構成」の列挙に `--workspace.modal--size-xl` が抜けていた

- reviewer: `comment`（実測）
- 対応: `2aae452`

`height: min(760px, 100%)` なので、内容ボックス（`H - 66`px）が 760 を切るとき、
すなわちウィンドウ高 826px 未満で `100%` 側が選ばれて埋める。`@media` は size-xl に
効かないので、720 < H < 826 の帯はこの規則だけが該当する。自分でも計算して確認した。

### [MEDIUM] 「他のモーダルの根のように `height: 100%`」が9件中5件でしか成り立たない

- reviewer: `comment`
- 対応: `2aae452`（SCSS）/ r4 報告書にも訂正を書き戻し

根に `height: 100%` があるのは `PositionSearchModal` / `StudyPositionSaveModal` /
`StudyPositionsManagerModal` / `PositionNavigationModal` / `SettingsPanel` の5件。
残る4件（`CreateFileModal` / `SfenKifuCreateModal` / `FileConflictDialog` /
`KifuReadErrorDialog`）は `height` を一切書かない。自分で全9件を確認した。

「他がみんな `height: 100%` なのにここだけ違う」という前提が検算で崩れると、
続く機構の説明ごと疑われる。機構そのものは reviewer の実測で正しいことが確認されている
（`height: 100%` に揃えると viewport 873 で panel が 680.9px → 401px に縮む）。

---

## 進め方についての記録

`2aae452` は2つの所見（`--workspace.modal--size-xl` の列挙、`height: 100%` の件数）を
1コミットにまとめている。skill の「複数の所見を1コミットにまとめない」に反する。
PR を出す判断をユーザーから受けた後だったため、コメントの文面だけの2件を1つにした。

---

## 未検証

- **実機（Tauri / WKWebView）では動かしていない。** r1〜r4 と同じく、実測はすべて
  Chrome headless にコンパイル済み SCSS を当てたもの。**受入条件の実機での目視は未了。**
- 高さの検査は依然として fail-open（`grid-template-rows` / `flex-basis` / `padding` で
  高さを作る形、`src/features/**` 以外に中身を置く形は素通りする）。r4 で範囲外と判断した
- `npm run verify:rust`（Rust に触れていない）

## 検証

`npm run verify` — 15 files / 165 tests passed。`npm run build` も通した。
