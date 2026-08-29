# レビュー issue-31-move-notation ラウンド5

- 日付: 2026-08-29
- 範囲: `fix/31-relative-kanji` の `main...HEAD`（レビュー時点は `798ea84`）
- 走らせた reviewer: `architecture` / `comment` / `robustness`
  （ラウンド4の修正の確認に集中させるため3観点に絞った。#157 / #160 の範囲は再掲禁止と明示）
- 前ラウンド: `-r1.md` / `-r2.md` / `-r4.md`

## ラウンド4の修正が効いていることの確認（実測）

- **レイヤ規則**: `src/` の全291ファイルに上位レイヤへの import を追記して `vp lint src -f json` に
  食わせ、期待違反数と実際の診断数を突き合わせた結果 **不一致0**。修正前の `5880fe8` の設定で
  同じ probe を走らせると **不一致257** になるので、probe 自体が機能していることも確認済み
- **`entities/position` → `entities/kifu` の依存**: 0本
- **`BranchOption` の生成元**: `buildNextOptions` 1箇所のみ。食い違った組み合わせは作れない
- **`KifuForkMenu` の `branchIndex`**: `branchIndexFromForkIndex(i) === i + 1` で置換前と同値。
  `branchEdit` に渡る座標は変わっていない
- **本譜の次が `special` のとき**: `goto` は投了ノードへ到達し、例外も無反応も起きない。
  `readableMove` は全 special と未知の値と空文字で throw しない

## 所見

### [BLOCK] `structuredClone` の理由コメントが CSA / JKF 経路で事実と逆 — comment

ラウンド4で私は「tsshogi が同・相対表記を先に埋めるので書き換えは実質起きない」と書いた。
**これは KIF と KI2 でしか成立しない。** 実測:

```
importCSA (4手目 -4122KI = 4一の金を2二へ): ok   ← 非合法手を受理する
normalizeMinimal: throw: 4手目で失敗しました
破壊された? true
move4: {..., "same": true}                       ← 例外の前に書き込まれている

KIF same: true   CSA same: undefined   JKF same: undefined
```

ラウンド4で「CSA は非合法手を import 段階で弾く」と結論したのは、probe に使った `-9988UM` が
**「Invalid turn」という別の理由**で弾かれたのを一般化したため。

コメントを信じて clone を外すと、CSA / JKF の壊れた棋譜で `same` だけ書き足された中途半端な
棋譜が返り、`normalizeNotation` の doc 自身が言うとおりそれが `saveKifuToFile` で書き戻る。
しかも私が書いた回帰テストは **KIF 版**だったので、clone を外しても落ちなかった。

**対応済み**: コメントを実態に直し、回帰テストを CSA 版に差し替えた。差し替え後は
clone を外すと落ちることを確認済み。`-r4.md` の該当節も取り消した。

### [BLOCK] 再生できない棋譜で局面ナビを進めると画面が消える — robustness

`PositionNavigationModal` の `goto` は `useMemo` の中、つまり**レンダ中**にある。
盤上で再生できない手を含む棋譜（正規化に失敗して未正規化のまま開いたもの）では
そこで throw し、`AppModalLayer` から root まで境界が1つも無いため React が root ごと
unmount する。Tauri のウィンドウが白紙になり、再起動するしかない。

r4 の HIGH（#157 に委譲）は棋譜ストリーム経由の話で、そちらは `navigate` の try/catch が
拾う。局面ナビの経路は**拾う者がいない**ので別物。

**対応済み**: `gotoPreview()` に切り出して包み、失敗時は「この棋譜は N 手目を盤上で
再現できません」と出す。`handleConfirm` の `goto` も同じ関数を通す。
`AppModalLayer` を `AppErrorBoundary` で囲った。

### [HIGH] 分岐を選び直すと、捨てた枝の計画が残って盤が別の変化に入る — robustness

`handleNext` は選び直した `nextTe` の pointer しか消さないため、`{te:4, forkIndex:0}` のような
「もう選んでいない枝の4手目」が計画に残る。実測:

```
変化1 → 変化1 と進む            fps=[{te:3,fi:0},{te:4,fi:0}]
2手戻って te3 で本譜を選び直す   fps=[{te:4,fi:0}]        ← te3 だけ消える
確定して盤で → を1回            tesuu=4  ☖１四歩         ← 一度も見ていない変化
計画が無ければ                  tesuu=4  ☖８四歩         ← 本譜
```

計画が効いていることを示す表示はどこにも無いので、別の手順を本譜だと思って読み進める。

**対応済み**: `truncatePlanFrom(fps, te)` を `kifuPlan.ts` に足し、`handleNext` で
選択を変えた手数より先の計画を捨てる。

### [MEDIUM] JSDoc と本文コメントが逆のことを言っていた — comment

`parse.ts` の JSDoc は「表記が揃わないだけで、開いて読むことはできる」、本文は
「表記が揃わないだけでなく、その手より先へは進めない」。r4 で本文だけ直し、
**呼び出し側が読むほうの JSDoc が楽観的なまま残った**。

**対応済み**: JSDoc 側に一本化し、本文の重複を消した。

### [MEDIUM] `vite.config.test.ts` が `upperLayers` の半分しか守っていなかった — architecture

`upperLayers` は `@/<upper>/**` と `../<upper>/**` の2形式を出すが、テストは前者しか見て
いなかった。後者を消しても8件すべて green のまま。`src/pages/` と `src/app/` には
レイヤ直下のファイルが実在するので、1階層の `../app/` で隣のレイヤに届く経路は実在する。

**対応済み**: 期待集合を `LAYERS_TOP_DOWN` から導く形にし、`pages` を含む全レイヤを対象にした。
`../<upper>/**` を消すと5レイヤすべてで落ちることを確認済み。
`globToRegExp` が扱えないメタ文字（`?` `[]` `!`）が設定に出たら throw するようにもした。

### [MEDIUM] `tag: "本譜"` が `branchLabel` を通っていなかった — architecture

r4 で `KifuForkMenu` の変化側を `branchLabel(i)` に寄せたが、その3行上の本譜が直書きのまま
だった。`branchLabel` の文言を変えると本譜だけ追随しない。

**対応済み**: `branchLabel()`（引数なしで `"本譜"`）を通す。

### [MEDIUM] `createdNew` の doc が実装の主要経路と食い違っていた — comment

`（= inputMove したか）` と書いてあるが、分岐3では `inputMove` を**意図的に避ける**と
本文が明言している。しかも末端の `inputMove` は `false` を返しうる（`promote` 未指定で
成れる位置）ので、何も追加せずに `createdNew: true` が返る場合がある。

**対応済み**: 「棋譜に新しい分岐を1本足したか」に直した。正規化が書き加えるフィールドの
列挙に `piece` と `promote` が漏れていたのも補った（`promote` は #31 の発端そのもの）。

### [MEDIUM] 成立しない前提を根拠にした doc / 消えた条件の説明 — comment

`branchLabel` の doc が根拠にしていた「一覧から間引かれた分岐」は、tsshogi が空の変化を
落とすため現状どこからも作れない。`buildNextOptions` の「投了だけの変化も落とさない」は
直下の `if (!forkFirst) return;` の説明になっていない（投了だけの変化は `forkFirst` が truthy）。

**対応済み**: 成立する根拠（棋譜ストリームが `forkIndex` で番号を振る）だけ残し、
投了の話は関数 doc に移した。`if` には実際の役割（手組み JKF への保険）を書いた。

### [MEDIUM] `turnText` が2種類の文字列を指していた — comment

r4 の改名で `turnText` が `"先手"` と `"先手番"` の両方を指すようになった。
`useTurnInfoCache` の値を `PositionDetail` に流用すると型は通り表示だけ変わる。

**対応済み**: `shared/lib/turn.ts` に `turnText(color): "先手番" | "後手番"` を置き、
「〜番」の4箇所をそこに寄せた。短い表記は `turnShortText` に改名して名前を分けた。

### [MEDIUM] issue 番号の無い TODO — comment

`appliedForkPointers` が `cursor.forkPointers` しか読まないのに `KifuCursor` 全体を要求し、
呼び出し側がダミーの `"0,[]"` を2箇所で直書きしていた。

**対応済み**: 引数を `Pick<KifuCursor, "forkPointers"> | null` に狭め、TODO とダミーを消した。

### [MEDIUM] 調査用ファイルの残骸でテストが落ちていた — comment

前ラウンドのレビュアーが残した `zz-probe.test.ts` / `.tsx` / `probe-layers.mjs` が
worktree 直下にあり、`zz-probe.test.tsx` が依存に無い `happy-dom` を要求して
`npm run test` を落としていた。

**対応済み**: 削除。

## 対応していない所見

- **JKF の clone が3実装ある** — architecture。`cloneJKF` / `cloneJkf`（1文字違い）/
  `branchEdit.ts` の `JSON.parse(JSON.stringify())`。3つ目は optional フィールドを落とすので
  `forks` を出し入れする `branchEdit` では挙動が違う。**別 issue が妥当**（このブランチは既に大きい）
- **`sanitizeJkf` の適用箇所が doc と違う** — architecture。doc は「`parseKifuContentToJKF` 直後で
  一度だけ」と言うが、実際は `entities/file-tree` と `widgets/kifu-stream` の2箇所。
  ただし実測では tsshogi の往復で空 fork が落ちるため、2箇所とも発火しない。**別 issue**
- **`entities/kifu` の公開面に doc が無い** — comment。内部ヘルパーの doc が14行あるのに
  `parseKifuContentToJKF` などは0行。**別 issue**
- **`BranchOption.id` / `Opt.branchIndex` の派生フィールド** — architecture。**別 issue**
- #157 / #160 の範囲（前ラウンドから継続）

## 重複・矛盾した所見

- **`structuredClone`**: comment が BLOCK として指摘し、robustness も独立に
  「clone を外すと45件すべて green のまま」を実測していた。ただし robustness は
  r4 の（誤った）結論を追認する形で書いており、comment だけが誤りに気づいた。
  **私自身が実測して comment を採用した。**
- **矛盾なし。**

## 見ていない範囲

- Rust 側。`npm run verify:rust` 未実行
- 実画面。BLOCK の白画面は「throw すること」「try/catch が無いこと」「境界が無いこと」の
  3点の実測と読解から組み立てたもので、実機での再現はしていない
- KI2 経路、Shift_JIS の KIF、途中で切れたファイル
- `@testing-library/react` による `PositionNavigationModal` の実レンダリング
  （robustness が試みたが 100 秒でタイムアウトし打ち切っている）
- SCSS / #160 の範囲

## lint / hook で強制できるもの

- **レイヤ規則**: `vite.config.test.ts` として導入済み。今回、両形式を覆う形に強化した
- **先後の記号の直書き**: `turn.test.ts` として導入済み。語（`"先手番"`）も同じ手段で
  閉じられるが、`"先手"`（番なし）との2種類が残っているため未実施
- **`forkPointers` の計画が現在の線と矛盾しないこと**: `kifuPlan.ts` の純関数レベルで
  テストできる。今回 `truncatePlanFrom` を切り出したので書ける状態にはなったが未実施
- **モーダルが境界の内側にあること**: `AppLayout.tsx` を検査するテストで固定できる（未実施）
- **`BranchIndex` の branded 化**: r2 からの持ち越し。未実施
- **ルート直下の `*.test.*` 残骸**: vitest の `include` を絞れば止まる（未実施）

## 次ラウンドの対象

- 今回直した所見の確認（特に BLOCK 2件）
- 見送り: 上記「対応していない所見」4件、#157、#160
