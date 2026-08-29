# レビュー modal-titlebar ラウンド1

- 日付: 2026-08-29
- 対象: issue #53、ブランチ `fix/53-modal-titlebar`、基点 `bb29884`（`origin/main`）
- レビュー時のコミット: `2bd9a2d`（1コミット）
- 走らせた reviewer: `ui` / `architecture` / `comment` / `robustness`
- 集計: BLOCK 1 / HIGH 1 / MEDIUM 10

`perf` / `rust` / `oss-hygiene` は走らせていない。差分が SCSS 1ファイルで、
Rust・依存・docs・CI のいずれにも触れていないため。

---

## 対応した所見

### [BLOCK] `TitleBar.scss:15` の `// 最前面に表示` が偽

- reviewer: `comment`
- 対応: `105b544`

`src/` の z-index を全数えした結果、`.titlebar` の 9999 より上が3つある。
いずれも `document.body` へ portal される。

| ファイル                 | z-index | portal 先                 |
| ------------------------ | ------- | ------------------------- |
| `KifuForkMenu.scss:7`    | 100000  | `KifuForkMenu.tsx:272`    |
| `KifuForkActions.scss:5` | 100001  | `KifuForkActions.tsx:161` |
| `KifuMoveActions.scss:5` | 100001  | `KifuMoveActions.tsx:113` |

「タイトルバーは常に前面」と読んだ人は、overlay の `top` を回りくどいと見て
`inset: 0` に戻す。実際の重なり順に合わせて書き換えた。

### [MEDIUM] カードの高さが viewport 基準のままで overlay とズレる

- reviewer: `ui` / `robustness`（独立に同旨）
- 対応: `c2e422e`

overlay の高さは `100vh - 2.6rem` になったのに、カードは `92vh` / `88vh` のままだった。
`align-items: center` は不足分を上下対称にはみ出させるので、カード上端は `13 + 0.04H` px。

| ウィンドウ高 H | カード上端 | 症状                                                                            |
| -------------- | ---------- | ------------------------------------------------------------------------------- |
| 825px 未満     | —          | 意図した `padding: 2rem` の余白が黙って食われる                                 |
| 325px 未満     | 26px 未満  | 帯を再び覆う。下端は画面外に出るが `position: fixed` なのでスクロールで届かない |

`tauri.conf.json` に `minHeight` が無く `resizable: true` なので、この高さには実際に縮められる。
高さの上限を `100%`（overlay の内容ボックス）で挟んで、はみ出しを原理的に消した。

reviewer は `minHeight: 600` の追加も提案しているが、採らなかった。
`100%` で挟めば **どの高さでも** はみ出さないので、`minHeight` は同じ欠陥に対する
二重の対処になる。ウィンドウを縮められる範囲を狭めるのは別の判断で、
この修正の成立には要らない。

### [MEDIUM] `$titlebar-height` が付箋のヘッダ高さと共有されている

- reviewer: `architecture`
- 対応: `6e5ae38`

このコミット以前、このトークンは「高さ」しか意味していなかった。今後は同じ値が
「オーバーレイが空ける帯の幅」＝ウィンドウを動かせるかどうかを決める。
付箋の見た目だけを変えるつもりの編集が overlay の覆う範囲まで動かす。
`$note-header-height` を別に立てた（値は同じ 2.6rem）。

なお reviewer は FloatingNote.scss のローカル変数化を提案したが、それだと
`scssScaleRatchet` の `indirect` が 53→54 に増えて落ちる（`scssScale.ts:187` の
`tokenSource` 分岐で直値が許されるのは `src/index.scss` だけ）。トークン側に置いた。

### [MEDIUM] 「z-index で競うのではなく」の**なぜ**がコードに無い

- reviewer: `comment`
- 対応: `5991e5f`

z-index を上げても overlay の内側のカードが帯の上に載る、という
この書き方でなければならない理由を書いた。

### [MEDIUM] 「タイトルバーのある画面でしか開かない」前提が書かれていない

- reviewer: `comment` / `architecture`（同旨）
- 対応: `d1744f6`

`RuntimeShell` の外（`FolderSelect` / `BootSplash`）でモーダルを開くと、
上端 26px が減光もクリック遮断もされない帯として残る。現在その経路は無いが、
Modal 側に強制する仕組みも無い。前提であることを書いた。

### [MEDIUM] この修正を守る検査が無い

- reviewer: `robustness`
- 対応: `41ba35c`

`src/__tests__/modalOverlayTitlebar.test.ts` を追加。SCSS をコンパイルして、
overlay の `top` が `.titlebar` の `height` と一致すること、`inset` が無いこと、
三辺が `0` であること、カードの高さが `100%` で挟まれていることを見る。

happy-dom にレイアウトエンジンが無く `vite.config.ts` に `test` セクションも
無い（`test.css` は既定 false）ため、DOM で computed style を取る方式は
取れないという reviewer の確認は正しかった。

**変異を当てて落ちることを確認した。** `inset: 0` に戻すと3件、
カードを `height: 92vh` に戻すと1件が落ちる。

---

## 対応しなかった所見

### [MEDIUM] `shared/ui/Modal` がシェルの構図を持っている → `#modal-root` へ移す案

- reviewer: `architecture`
- **反論。この PR では採らない。**

提案は `#modal-root` に `position: fixed; top: $titlebar-height; pointer-events: none`
を与え、overlay を `position: absolute; inset: 0; pointer-events: auto` に戻す形。
責務の置き場としては確かに `app` が正しい。ただし提案のままでは退行する。

1. **`position: fixed` は z-index が `auto` でも重ね合わせ文脈を作る**（CSS Positioned
   Layout 3）。提案の `#modal-root` には z-index が無いので、overlay の 9999 は
   `#modal-root` の内側に閉じ、`#modal-root` 自身はルート文脈の `auto` 段に入る。
   `FloatingNote`（`FloatingNote.scss:9` の z-index 1200）は正の段にいるので、
   **付箋がモーダルの上に描かれる**。提案はこの点に触れていない。
2. 1 は `#modal-root` に `z-index: 9999` を足せば直るが、`Modal.tsx:70` の
   `document.getElementById("modal-root") ?? document.body` というフォールバックが残る。
   `#modal-root` が無い経路に落ちると `position: absolute` は包含ブロックを失い、
   overlay が再び帯を覆う。**#53 が黙って戻る経路を作る。**

得られるのは配置の正しさ、払うのは新しい沈黙する故障2つ。釣り合わない。
reviewer 自身「依存の方向の違反は無い」と確認しており（`src/index.scss` は変数のみ、
`shared → index.scss` は下向き）、これは規則違反ではなく設計の好みの問題。

代わりに前提をコメントで明示し（`d1744f6`）、`top` と `height` が同じ値であることを
検査で固定した（`41ba35c`）。**置き場を移すかどうかは設計の選択なので、
別 issue にしてユーザーに選ばせる。**

### [HIGH] `ContextMenu` にビューポートのクランプが無い

- reviewer: `ui`
- **範囲外。別 issue。**

`ContextMenu.tsx:67-73` は `innerHeight` を一切参照していない。ファイルツリーの
末尾で右クリックすると2項目目の「Delete」が画面外に出て押せない。
同種のポップオーバー3つ（`KifuForkMenu` / `KifuMoveActions` / `KifuForkActions`）は
クランプしているので、同じ役割の UI で方針が割れている。

#53 とは独立で、この修正の成立にも関係しない。範囲を広げると PR が読めなくなる。

### [MEDIUM] 他のオーバーレイがタイトルバーを覆う経路が残っている

- reviewer: `ui` / `architecture` / `comment`
- **範囲外。別 issue。**

`KifuForkMenu.tsx:111,122-125` の上端クランプは `margin = 8`(px) で、帯の 26px より
上に入る。z-index も 100000/100001 でタイトルバーの 9999 より上なので、
今回採った「幾何で避ける」も塗り順も効かない。`ContextMenu.tsx:72` も 9999 で
タイトルバーと同値・DOM 順で勝つ。

`src/index.scss` に z のトークンは1つも無く、20箇所すべて直値。段を作る作業は
#53 の修正に不要（この修正はどの z-index 順序にも依存していない）。

### [MEDIUM] ウィンドウを閉じられるようになったことで、実行中の処理と未保存の下書きが消える

- reviewer: `robustness`
- **範囲外。別 issue。**

`FileConflictDialog.tsx:63-64` は送信中に Esc とオーバーレイ閉じを意図的に殺しているが、
赤ボタンは `onCloseRequested` を張っていない（リポジトリ全体で0件）ので素通りする。

ただしこれは**この変更が作った露出ではない**。変更前も Cmd+Q とメニューから
終了できたので、経路が1つ増えただけ。独立した欠陥として issue にする。

### [MEDIUM] `TitleBar.tsx:9-11` の Promise が投げっぱなし

- reviewer: `robustness`
- **範囲外。別 issue。**

`minimize` / `toggleMaximize` / `close` は `Promise<void>` を返すが await も catch も
されず、`unhandledrejection` のハンドラも無い。capabilities が落ちていると
押しても何も起きず、ログにも UI にも何も出ない。既存の欠陥。

### [MEDIUM] breakpoint の直値が13種類散っている

- reviewer: `ui`
- **範囲外。** ADR-0003 の続きの作業であって #53 とは別。

### カードの**幅**にも同じズレがある（reviewer は指摘していない）

自分で確認した範囲として記録する。`width: 96vw` は overlay の内容幅 `W - 40`px を
`W < 1000px` で超える。ただしはみ出すのは左右対称で 7px 程度、隠れるものも無く、
タイトルバーにも関係しない。高さ側と違って**正しさの問題ではない**ので直していない。

---

## 未検証

- **実機で動かしていない。** 上の寸法はすべて SCSS のコンパイル結果と CSS の規則からの
  計算で、実測ではない。受入条件（掴んで動かせる／ボタンが押せる）の目視確認は未了
- WKWebView 固有の挙動（`backdrop-filter` の端、非整数 DPI での y=26px のスナップ）
- `npm run verify:rust` は走らせていない。Rust に触れていないため

## 検証

`npm run verify` — 15 files / 133 tests passed。SCSS を触ったので `npm run build` も実行。
コンパイル結果が `inset: 2.6rem 0 0` になっていることを確認した。
