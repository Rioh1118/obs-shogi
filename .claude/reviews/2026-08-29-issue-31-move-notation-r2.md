# レビュー issue-31-move-notation ラウンド2

- 日付: 2026-08-29
- 範囲: `fix/31-relative-kanji` の `main...HEAD`
  - `src/entities/kifu/lib/readableMove.ts`（新規）
  - `src/entities/kifu/lib/__tests__/readableMove.test.ts`（新規）
  - `src/features/position-navigation/ui/BranchCard.tsx`
  - `src/features/position-navigation/lib/shogi-format.ts`（削除）
- 走らせた reviewer: `comment-reviewer` / `robustness-reviewer` / `architecture-reviewer`
- 対象コミット: `3ecefdb`
- 前ラウンド: `2026-08-29-issue-31-move-notation-r1.md`

ラウンド1の BLOCK / HIGH を受けて方針Aを採り、手書きの `formatMove` を捨てて
`JKFPlayer.moveToReadableKifu` に委譲した。ラウンド2は**その結果**に対するレビュー。

## ラウンド1から解決したこと（再確認済み）

- **BLOCK（不成が消える）/ HIGH（実装が2本）**: 解決。architecture-reviewer が
  `getReadableKifu()` / `getReadableForkKifu()` と `readableMove()` を全手で突き合わせ、
  成・不成・同・相対・打・手番記号すべて**文字単位で一致**を実測。
- **「打」の補完を消した判断**: robustness-reviewer が実測で安全と確認。
  `applyMoveWithBranch` の fork 追加も末端の `inputMove` も `normalizeMinimal` を通り、
  issue #74 の場面（4九金 + 持駒の金、両方が3九へ）で本譜 `☗３九金` / 変化1 `☗３九金打` と
  別文字列になる。打が「打」を落とすのは盤上の駒が到達できないとき＝取り違える相手が
  存在しないときだけ。**曖昧でない打から「打」が消えるのは仕様どおりで不具合ではない**（ユーザー判断）。
- **削除の完全性**: `formatMove` / `formatPiece` / `formatPlace` / `isSameMove` / `getMoveHash` /
  `shogi-format` は `src/` に1件も残っていない。
- **置き場・ファイル名・レイヤ規則・循環**: 問題なし。テストが `@/entities/kifu/api/parse` を
  import する点も同一レイヤ・同一スライスで規則に触れない。

## 所見

### [MEDIUM] テストヘルパーの根拠コメントが事実と違い、不要な盤面リテラルを正当化している — comment

`readableMove.test.ts:15` の「相対表記は駒の配置でしか作れない」が誤り。実測:

```
手合割：平手 / 1 ５八金(49)  =>  ☗５八金右
```

平手の初期配置に金は 6九・4九 なので、1文字の相対表記は KIF 1手で出る。
しかもヘルパーの最初の利用者（1文字のケース）は金を 6九 / 4九 に置いており、
**これは平手の初期配置そのもの**。このテストに15行のヘルパーは要らない。

2文字のケース（金3枚）と曖昧な打（持ち駒）は平手から短手数で作れないのでヘルパー自体は要る。
誤っているのは理由だけ。

### [MEDIUM] `movesOf` の doc が「期待値は手書きせず」と言うが、期待値は全て手書き — comment

手書きしていないのは**入力の指し手**であって期待値ではない。規約を素直に守ろうとした人は
`expect(readableMove(m)).toBe(player.getReadableKifu())` と書き、**同じ関数を左右に置いた
恒真テスト**に変えてしまう。今この委譲を守っているのは期待値リテラルだけなので、
それが失われると回帰検知が0になる。

### [MEDIUM] テストヘルパー2本の名前が返すものを言っていない — comment

`movesOf` は指し手ではなく日本語表記の文字列を返す。`jkfWithBoard` は名前どおりなら
JKF オブジェクトだが実体は文字列で、だからこそ `movesOf(content, "jkf")`（＝再パース）という
一見無駄な往復が要る。`readableMovesOf` / `jkfContentWithBoard` に直せば往復の理由が名前で通る。

### [MEDIUM] `readableMove(undefined) → ""` の契約が doc に無く、唯一の呼び出し側はその経路を避けている — comment

`BranchCard` は自前で `"次の手"` / `"N手目"` を出しており `""` は到達しない。
テストだけがこの契約を固定している。次の利用者が doc を見て「null 安全だ」と判断し
`{readableMove(x)}` をそのまま書くと、手が無いカードだけ pill が空白になる（壊れて見えない）。

引数を `IMoveMoveFormat` に狭め、フォールバックの置き場を呼び出し側1か所に寄せる。

### [MEDIUM] 「打」が出る根拠は `applyMoveWithBranch` の `normalizeMinimal` 呼び出しにあるのに、そこを通るテストが無い — robustness

削除した「打」フォールバックが守っていた場面（issue #74）は**ファイル由来ではなく盤操作由来**の手。
今その表記が成立しているのは `applyMoveWithBranch.ts:61` が毎回全体を再正規化しているからで、
この結合はコードのどこにも書かれていない。将来この `normalizeMinimal` を外すと、
分岐カードに `☗３九金` が2枚並び、**どちらが打か区別できないまま片方を選ぶ**。
テストは全件 green のまま通る。

### [MEDIUM] `readableMove` の doc が「両方の一覧で同じ文字列になる」で止まっており、項目数が揃うとは限らない点が読めない — architecture

一致が破れるのは `special` だけ。実測:

```
te=5 readableKifu=[投了]  readableMove=[]  *** DIFF ***
```

`readableMove` は `IMoveMoveFormat` しか取らないため `special` を扱えない。
型を `IMoveFormat` に広げるのが本筋だが `BranchOption` と `buildPreviewData` に波及するので
別 issue（下記）。本 PR では doc に明記する。

## 重複・矛盾した所見

- **`special` の取りこぼし**: robustness と architecture が独立に発見。
  robustness は利用者影響（投了で始まる変化が局面ナビから消え、`変化N` の番号が
  棋譜ストリームとずれる）、architecture は型設計（`IMoveFormat` に広げるべき）から。
  同じ根で、**本 PR が作った問題ではなく既存**（`buildPreviewData.ts:43` の早期 return と
  `BranchCard.tsx:20` の `変化${index}` が配列添字）。別 issue に切る。
- **矛盾なし**。ラウンド1と違い、reviewer 間で結論の割れは無かった。

## 差分外で見つかった既存バグ（別 issue に切る）

1. **CSA から開いた棋譜の表記が、無関係な分岐を1つ作った瞬間に変わる** — robustness
   `same` は CSA に存在せず tsshogi も付けないが、`applyMoveWithBranch` が棋譜ツリー全体に
   `normalizeMinimal` を走らせて後から書き足す。`☖２二銀` → `☖同　銀`。
   直すなら `parseKifuContentToJKF` の出口で正規化を通す。ただし `normalizeMinimal` は
   非合法手で throw するので、try/catch で失敗時は正規化前を使うこととセット。
2. **投了で始まる変化が分岐カード一覧から消え、`変化N` の番号がずれる** — robustness / architecture
   `buildPreviewData.ts:43` が `move` を持たない fork を落とし、`BranchCard.tsx:20` が
   配列添字をラベルにしている。`KifuForkMenu.tsx:77` は真の `forkIndex` を使うので食い違う。
3. **`entities/kifu/index.ts` が公開境界として機能していない** — architecture
   barrel 経由 17件 に対し深い直接 import 42件。`lib/branchEdit.ts:2` は自スライスの barrel を
   読み返しており、export がひとつ増えると `import/no-cycle` で落ちる形。
4. ラウンド1からの持ち越し: ☗/☖ の直書き7箇所と `BoardPreview.tsx:111,123` の先後逆転、
   `toKan` の7重複、参照0件 export を落とす `knip` 相当の導入。

## 見ていない範囲

- 実画面での見え方。半角→全角化で `branch-selector__move-pill` が伸びる（最長 `☗５八金左上成`）。
  `ui-reviewer` は不実施
- CSA / KI2 経路は robustness が部分的に実測したのみ（`relative` と `promote:false` の有無）
- `parseKifuStringToJKF`（形式自動判定）経路、Shift_JIS の KIF、途中で切れたファイル
- `features/position-search/ui/PositionSearchContinuation.tsx:124` の `getReadableKifu` 経路
  （3つ目の呼び出し元だが出力は同じ関数由来なので不一致は起きない）
- Rust 側（差分に無い）。`npm run verify:rust` 未実行

## lint / hook で強制できるもの

- **`readableMove` と `getReadableKifu` の一致**（この PR の存在理由）: 現在どのテストも固定していない。
  fork のある棋譜1本で `getReadableForkKifu()[i] === readableMove(forks[i][0].move)` を
  突き合わせる1本があれば、将来どちらか片方が差し替わったとき自動で落ちる
- **配列添字を分岐番号として使うこと**: `BranchIndex` を branded type にし
  `branchIndexFromForkIndex` 以外から作れなくすれば tsc が落とせる。現状 `BranchIndex = number` で素通り
- **自スライスの barrel 読み返し**: `no-restricted-imports` に1本足せば循環の種を機械で止められる
- **`special` の取りこぼし**: 型でしか防げない。`readableMove` が `IMoveFormat` を取る形にすれば
  コンパイル時に見える
- doc とテストの食い違いは機械では防げない

## 次ラウンドの対象

- 今回直す: 上の所見6件すべて（テストの doc・命名・不要ヘルパー、`undefined` 契約の削除、
  `applyMoveWithBranch` を通すテストの追加、`special` を扱わない旨の明記）
- 別 issue: 上の「差分外で見つかった既存バグ」4項目
