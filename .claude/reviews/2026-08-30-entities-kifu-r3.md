# レビュー entities-kifu ラウンド3

- 日付: 2026-08-30
- 範囲: `refactor/163-entities-kifu`（issue #163 / #164 / #165 / #166）の `origin/main` からの差分
- 対象コミット: `585546e`
- 走らせた reviewer: architecture / react / robustness / perf / comment
- 前ラウンド: `-r1.md` / `-r2.md`

## 所見

| 番号  | 深刻度 | reviewer                   | 内容                                                                                                                                                                                                                           | 結果                                                      |
| ----- | ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| R3-01 | HIGH   | comment, react, robustness | `Candidates` の doc「各候補の先頭の手は私有」が変化側について偽。`f.slice()` は配列しか複製せず、`writeCandidates` の `main[0].forks = forkSegs` が入力の手を in-place で書き換える。R2-12 で複製を削った根拠がこの doc だった | 直した（doc を真にする側に寄せ、identity テストを追加）   |
| R3-02 | MEDIUM | comment                    | `buildPlayer` の doc「`inputMove` を呼ぶなら複製」が、実際の主経路 `applyMoveWithBranch`（`player.kifu` を直に編集）を外している                                                                                               | 直した                                                    |
| R3-03 | MEDIUM | comment                    | `buildPlayer` に `@throws` が無い。同じラウンドで `branchEdit` には足しており基準が割れていた                                                                                                                                  | 直した                                                    |
| R3-04 | MEDIUM | comment                    | `KifuStreamList` のコメントが「`forward` / `backward` / `forkAndForward` しか呼ばない」と列挙しているが、`getReadable*` / `currentStream` も呼ぶ                                                                               | 直した（契約への参照に縮めた）                            |
| R3-05 | MEDIUM | comment                    | `sanitizeJkf.test.ts` のコメントが「並べ替えると読み込みのたびに順序が変わる」と書くが、並べ替えは実装のどこにも無い                                                                                                           | 直した                                                    |
| R3-06 | MEDIUM | comment                    | `PositionNavigationModal` の `gameView.player ? gameState.cursor : null` の理由が書かれていない。簡約されると開けない棋譜で前の棋譜の手数から始まる                                                                            | 直した                                                    |
| R3-07 | MEDIUM | comment                    | `jkf` が `JKFData` と `JKFPlayer` の両方を指す                                                                                                                                                                                 | この PR で触った2ファイルだけ揃えた。残り4ファイルは #209 |
| R3-08 | MEDIUM | comment                    | テストが `as never` で `BranchIndex` の brand を破っている。破る必要は無い                                                                                                                                                     | 直した                                                    |
| R3-09 | MEDIUM | architecture               | `mergeForkPointers` の呼び出しが0件。生きている同じ合成は `entities/game/lib/cursor.ts` にある                                                                                                                                 | 直した（削除）                                            |
| R3-10 | MEDIUM | architecture               | `applyCursorToPlayer` の外部呼び出しが、R2-08 の移設で0件になった                                                                                                                                                              | 直した（非公開化）                                        |

## 重複・矛盾した所見

- R3-01 は3人が独立に同じ箇所を指した。comment が HIGH、react と robustness が MEDIUM。
  提案は「doc を実態に合わせる」と「doc を真にする」に割れたが、**後者を採った。**
  複製は候補数ぶんのオブジェクト1個ずつで、R2-12 で削ったコピー量（棋譜1枚ぶん）は戻らない。
  「呼び出し側が複製を渡しているから安全」という条件付きの安全は、条件が破れたときに
  黙って入力を壊す形になるので、条件を要らなくする方に倒した。
- robustness は fuzz（深さ3のランダム木で swap / delete を40,000回）で別名化・空 fork の生成・
  手の集合の変化がいずれも0件であることを確認した。react は `deleteBranchInKifu` を実際に走らせて
  identity を確認した。両者の実測が R3-01 の根拠になっている。

## 別の issue へ送る

| reviewer              | 内容                                                                                             | issue |
| --------------------- | ------------------------------------------------------------------------------------------------ | ----- |
| robustness [BLOCK]    | コメントノートを開いたまま棋譜を切り替えると、前のファイルの本文で上書き保存される               | #204  |
| robustness [HIGH]     | 再現できない手を含む棋譜で、棋譜ストリームが「表示中にエラー」に置き換わり復帰できない           | #203  |
| perf [MEDIUM]         | 矢印キー1打ごとに全行が作り直され、行の `memo` が効かない（実測 300手で12.6ms、500手で20.6ms）   | #205  |
| architecture [MEDIUM] | `tesuuPointer` を持たないカーソルの型が無く、各層がダミーを作るか `buildPlayer` を手写ししている | #206  |
| architecture [MEDIUM] | `entities/game/lib/cursor.ts` は game 固有の型を1つも持たない                                    | #207  |
| architecture [MEDIUM] | `widgets/kifu-stream` の `lib` が `ui` から `RowModel` を読んでいる                              | #208  |
| comment [MEDIUM]      | `jkf` が `JKFData` と `JKFPlayer` の両方を指している（残り4ファイル）                            | #209  |

**#204 は BLOCK だが、この PR の回帰ではない**（`origin/main` にも同じ構造がある）。
`features/kifu-comment-note` と `shared/ui/live-markdown-note` の設計に触るので範囲外とした。
データが失われる側の不具合なので、follow-up の先頭に置くこと。

## 見ていない範囲

- Rust 側。本 PR に差分が無いため `npm run verify:rust` は未実行
- SCSS とレイアウト。`BranchList` の key 変更による mount アニメーションの発火は未確認
  （react は `IntersectionObserver` と `cardRefs` の挙動だけ追い、悪化しないことは確認した）
- WebKit（実行環境）での実測。perf の数値はすべて V8（Node v26）と happy-dom
- `KifuStreamList` を `GameProvider` ごとマウントした状態での実測。行の再レンダは
  `KifuMoveCard` を301個並べた合成ベンチ
- 実機での操作確認。#203 / #204 の再現手順はコード読解と Node 上でのライブラリ実測に基づく組み立て

## lint / hook で強制できるもの

- 未使用 export の検出（`knip` 等）。R2-09 の `sanitizeJkfMoves`、R3-09 の `mergeForkPointers`、
  R3-10 の `applyCursorToPlayer` で3件目。人の注意で回すのは既に無理がある
- `src/widgets/*/lib/**` → `../ui/**` の import 禁止（#208）
- `src/**` での `as never` 禁止（`TSAsExpression > TSNeverKeyword`）。brand の抜け道を止める
- `JKFPlayer` 型の識別子に `jkf` を使わない `no-restricted-syntax`（#209）
- `no-unnecessary-type-assertion`（型情報付きルール）
- 拾えないもの: doc と実装の食い違い（今ラウンドの所見10件中6件）、
  レンダ中に throw しうるライブラリ呼び出し、上位 state の変化で「開いている面」を閉じ忘れること

## 次ラウンドの対象

R3-01〜R3-10 を直したうえで、修正で新しい問題が入っていないかを見る。
R3-01 は `readCandidates` のコピー方針を2ラウンド連続で変えた箇所なので、
robustness に別名化の再確認をさせる。
