# レビュー modal-titlebar ラウンド2

- 日付: 2026-08-29
- 対象: `git diff bb29884..HEAD`（レビュー時点で8コミット）
- 走らせた reviewer: `ui` / `comment` / `robustness`
- 集計: BLOCK 1 / HIGH 3 / MEDIUM 9
- 前ラウンド: r1（BLOCK 1 / HIGH 1 / MEDIUM 10）— 全件対応済み

**r1 の再掲は無い。** r2 は「r1 の修正が正しく入っているか」と
「r1 の修正が新しく入れた問題」を見た。

`architecture` は走らせていない。r1 で出た構造の所見は
`#modal-root` へ移す案（ユーザーが Modal 側に残すと決定）で決着しており、
r1 以降の差分はコメント・検査・1ファイルの高さ指定だけのため。

`ui-reviewer` は Chrome headless で実 SCSS をコンパイルして DOM を組み、
`getBoundingClientRect` / `elementFromPoint` で実測している。以下の実測値はその出典。

---

## 対応した所見

### [HIGH] r1 の修正が退行を入れていた — エンジンプリセット編集の保存ボタンが押せなくなる

- reviewer: `ui`（実測）
- 対応: `7d62b96`

`EnginePresetEditDialogPanel.scss:8` の `.presetDialog` は `size="lg"` のカードの
唯一の子だが、高さが `min(78vh, 760px)` と viewport 基準のまま残っていた。
`c2e422e` でカードの上限を `min(88vh, 100%)`（= `H - 66`px）に下げた結果、
`0.78H > H - 66` すなわち **H < 300px でパネルがカードを超える**。
カードは `Modal.scss:41` の `overflow: hidden` でスクローラを持たないので、
はみ出した分は切られて届かない。

実測（window 1280x360 / viewport 288）:

|                  | card    | `.presetDialog` | footer   | 保存ボタン           |
| ---------------- | ------- | --------------- | -------- | -------------------- |
| 変更前 `bb29884` | 12..276 | 13..237         | 185..237 | 200..223（収まる）   |
| `c2e422e` 時点   | 46..268 | **47..272**     | 220..272 | 235..258（切られる） |

切られる量は `66 - 0.22H`。フッタ下端と保存ボタン下端の差は実測 14px なので、
**viewport 高 236px を切ると保存ボタンが完全に隠れる**。

他のモーダルの中身の根（`PositionSearchModal` / `SettingsPanel` /
`StudyPositionsManagerModal` / `PositionNavigationModal`）はいずれも
`height: 100%; min-height: 0` でカード基準。ここだけ外れていた。

### [HIGH] 新しい検査が素通りする改変が5通りあった

- reviewer: `robustness`（実際に変異を当てて確認）
- 対応: `818b7f6`

| 素通りしていた改変                                 | 原因                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `.modal--dark .modal__overlay` に `inset: 0` を1行 | セレクタ完全一致で絞っていた。この規則は既に存在し詳細度で勝つ               |
| `.modal__card` に `min-height: 92vh`               | `min-height` を見ていなかった。CSS 2.1 §10.7 で `max-height` を上書きする    |
| `height: max(92vh, 100%)`                          | 値を「`100%` を含むか」で見ていた                                            |
| `max-height: calc(100% + 6rem)`                    | 同上                                                                         |
| 規則を `.modal__card--scroll-card` へ移す          | `endsWith(".modal__card")` を外れる。この class は `Modal.tsx:82` で常に付く |

逆に、振る舞いが同一な `inset: 2.6rem 0 0 0` へのまとめ直しは**落ちていた**。
固定していたのは不変条件ではなくソース上の綴りだった。

末尾の複合セレクタで拾い、`inset` を辺に展開してから比べ、高さは許す形を列挙する
書き方に直した。**上の5つが落ち、等価な書き換えが通ることを変異で確認した。**

この1コミットは4つの所見（HIGH 1 / MEDIUM 3）をまとめて直している。
判定関数（セレクタの拾い方・値の見方）を共有しているので、分けると
中間のコミットが壊れた検査になるため。

### [HIGH] 「z-index を上げてもカードが帯の上に載る」は重なり順が逆

- reviewer: `comment`
- 対応: `6b101aa`

overlay は `position: fixed` + `z-index: 9999` で重ね合わせ文脈を作るので、
その内側の `.modal__card`（`position: relative; z-index: auto`）が overlay を
飛び越えて前に出ることはあり得ない。起きるのは逆で、カードが**下に潜って上端が隠れる**。

最初のコミット `2bd9a2d` の本文では「潜る」と正しく書いていたのに、
`5991e5f` でコメントへ移すときに向きが反転していた。
**このリポジトリで5ラウンド続いている系統の故障（コメントの理由と実装の条件がずれる）。**

### [BLOCK] `$titlebar-height` の注記が、起こり得ない失敗を警告していた

- reviewer: `comment`
- 対応: `6be336a`

「下げるとタイトルバーが覆われる」は偽。参照は `TitleBar.scss:6` の `height` と
`Modal.scss` の overlay の `top` の2箇所だけで、どちらも同じトークンを見ている。
値を動かせば両方が同じだけ動くので、覆われることは原理的に無い。
「全画面オーバーレイはこの帯を空けて描く」も一般則としては偽（#175）。

壊れるのは片方だけを直値に書き換えたとき。読み手が検算して再現できる形に直した。

### [MEDIUM] `min(vh, 100%)` の理由に、実際に起きる条件が無い

- reviewer: `comment`
- 対応: `8f5cf6b`

はみ出す先はまず `padding: 2rem` の内側であって「overlay の外」ではない。
帯に届く境は `88vh` で H < 217px、`80vh` で H < 130px。
既定ウィンドウ高 960px で検算した読み手は「起きない」と結論して `min()` を外す。
そこまで縮められる条件（`minHeight` が無く `resizable: true`）も書いた。

### [MEDIUM] テスト先頭の「DOM で確かめられない理由」が実態と違う

- reviewer: `comment`
- 対応: `818b7f6`（書き直しに含む）

`// @vitest-environment happy-dom` の指定が無いので既定の node 環境で走っており、
happy-dom はそもそも動いていなかった。`vite.config.ts` に `test` セクションは無く、
`test.css` は「切ってある」のではなく既定 false のまま。
`（issue #53）` の番号参照も落とした（`CONTRIBUTING.md` が認めるのは `TODO(#N)` 形式のみ）。

### [MEDIUM] `it` の名前が、その検査が保証していない性質を約束していた

- reviewer: `comment`
- 対応: `818b7f6`（書き直しに含む）

「カードの高さが overlay の内容ボックスを超えない」→
「カードの高さ指定が必ず 100% で挟まれている」に改名。
`cardHeights`（名前は値の集合、実体は宣言テキスト）は書き直しで消えた。
`const modal` → `modalCss`。

### [MEDIUM] `$note-header-height` の名前と置き場の理由

- reviewer: `comment`
- 対応: `71da3d9`

`note` は棋譜のコメント欄とも読める。`$floating-note-header-height` に改名し、
利用者が1つしか無いのに全体のトークン表にある理由（ローカル変数に下ろすと
ラチェットの `indirect` が増える）を書いた。

### [MEDIUM] 検査がランナーの起動場所の木を読んでいた

- reviewer: `ui`
- 対応: `a50f784`

`process.cwd()` だと、テスト本体はこの木のものなのに SCSS は起動場所の木のものが
読まれる。reviewer の再現手順（親チェックアウトから `--root <worktree>` で起動）で
4件とも落ちていた。`import.meta.url` から辿る形に直し、同じ手順で 4 passed になることを確認した。

### [MEDIUM] r1 報告書のカード幅の記述が誤り

- reviewer: `ui`（実測で否定）
- 対応: `70d96fa`（r1 報告書に取り消しを書き戻し）

「幅も overlay の内容ボックスを超える」は誤り。超えない。
カードは overlay の flex item で、幅は主軸サイズなので `flex-shrink: 1` が効く。
**この非対称（主軸は縮む・交差軸は縮まない）こそが、高さだけ `100%` で挟む必要があった理由。**

---

## 対応しなかった所見

### 既存の3本のテストも `process.cwd()` を使っている

- reviewer: `ui`（「直すなら4本まとめて」と提案）
- **範囲外。**

`turnGlyphLiterals.test.ts:12` / `testsLayerBoundary.test.ts:13` /
`scssScaleRatchet.test.ts:25` も同じ書き方。#53 の修正とは無関係で、
直しても振る舞いは変わらない（通常の起動では同じ木を指す）。

reviewer が挙げた「`src/__tests__/**` の `process.cwd()` を lint で禁止する」案は
4本すべてを直さないと落ちるので、**まとめて別 PR で扱うのが妥当**。

---

## reviewer が検証して問題が無かった点

再掲を避けるための記録。

- **`min(80vh, 100%)` は意図どおり効く**（`ui`、実測）。overlay は
  `top`/`right`/`bottom`/`left` 全指定で高さが definite。viewport 713 / 913 / 363 / 288 の
  全ケースでカード上端は 46px、`elementFromPoint(w/2, 3)` は全ケースで `titlebar` を返した。
  変更前は viewport 653 で上端 26px、363 で 15px と帯に食い込んでいた。**修正は実測で成立している。**
- **スクロールは壊れていない**（`ui`、実測）。`scroll="content"` / `scroll="card"` とも内部スクロールを確認。
- **r1 の `#modal-root` 反論は正しい**（`ui` / `robustness` が独立に確認）。
  提案どおり組むと `z-index: 1200` の兄弟が `elementFromPoint` で上に来ることを実測。
  `position: fixed` が z-index auto でも重ね合わせ文脈を作るという前提も確認された。
- **`sass.compile` の実行時間**は当該ファイル 300〜500ms、`npm test` 全体 7.2s で問題なし（`robustness`）。
- **`$floating-note-header-height` の腐り方の経路は見つからない**（`robustness`）。
  `scssScaleRatchet.test.ts:86-105` の「ローカル変数がトークンと同名にならない」検査が
  ローカルへ戻す改変を落とす。

## 未検証

- **実機（Tauri / WKWebView）では動かしていない。** `ui` の実測は Chrome 141 headless に
  コンパイル済み SCSS を当てたもので、React が実際に描く各モーダルの中身は再現していない
- `.presetDialog` 以外のモーダルの中身が、カードを `100%` で挟んだ後で実コンテンツでも
  成立するか（SCSS の `height: 100%` チェーンは確認済み、実物では未測定）
- `backdrop-filter` の y=26 の境界の見た目、非整数 DPI でのスナップ
- `npm run verify:rust`（Rust に触れていない）

## 検証

`npm run verify` — 15 files / 133 tests passed。`npm run build` も通した。
