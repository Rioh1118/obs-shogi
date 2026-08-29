# レビュー entities-kifu ラウンド2

- 日付: 2026-08-30
- 範囲: `refactor/163-entities-kifu`（issue #163 / #164 / #165 / #166）の `origin/main` からの差分
- 対象コミット: `526e175`
- 走らせた reviewer: architecture / react / robustness / perf / comment
- 前ラウンド: `2026-08-30-entities-kifu-r1.md`

ラウンド1の修正で新しく入った問題を見た。ラウンド1の所見と、範囲外として #186〜#196 に
送った所見は再掲していない。

## 所見

| 番号  | 深刻度 | reviewer            | 内容                                                                                                                                                                                     | 結果                                                  |
| ----- | ------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| R2-01 | HIGH   | comment             | R1-01 で書き直した `write.ts` の doc が今度は逆に外している。`create_kifu_file` は `operations.rs:179` で `normalize()` を呼ぶ。新規作成だけ正規化されるという非対称がコードから読めない | 直した                                                |
| R2-02 | MEDIUM | comment             | `swapBranchesInKifu` / `deleteBranchInKifu` が「引数の `kifu` をその場で書き換える」「throw する」を書いていない。私有型の `Candidates` には6行の doc があるのに公開面が裸               | 直した                                                |
| R2-03 | MEDIUM | comment             | 「一致しない」という断定が2つ。通常の場合は一致するので「一致するとは限らない」が正しい                                                                                                  | 直した                                                |
| R2-04 | MEDIUM | comment, robustness | `sanitizeJkf` の doc の理由（複数箇所で掛けると `forkIndex` が読めなくなる）を起こせない。`sanitizeJkfMoves` は冪等。実際の危険は「番号が繰り上がる」こと                                | 直した                                                |
| R2-05 | MEDIUM | comment             | `KifuStreamList` だけ `new JKFPlayer` に複製を挟んでいて、理由がどこにも無い                                                                                                             | 複製が不要と確かめて外した（#194 を close）           |
| R2-06 | MEDIUM | comment             | `branchEdit.ts` とテストに「枝」が残る。指しているのは本譜も含む候補なので「変化」でも正確でない                                                                                         | 直した（候補 / 本譜 / 変化 の3語に）                  |
| R2-07 | MEDIUM | comment             | `parse.test.ts` の「tsshogi の出力がそのまま返る」が、sanitize を通すようになって成り立たなくなった                                                                                      | 直した                                                |
| R2-08 | MEDIUM | architecture        | `cloneJkf` を抜いた `entities/game/lib/jkf.ts` に残ったのは `buildPlayer` 1本で、game 固有の識別子が0。置き場のせいで `features/position-search` が同じ2行を手書きしている               | 直した（`entities/kifu/lib/cursorRuntime.ts` へ移動） |
| R2-09 | MEDIUM | architecture        | R1-09 で契約を `sanitizeJkf` に移した結果、契約なしの実体 `sanitizeJkfMoves` が公開のまま残った                                                                                          | 直した（export を外した）                             |
| R2-10 | MEDIUM | react               | `PositionNavigationModal` の nav リセット `useEffect` が2本あり本体が同一。片方に `isOpen` の門が無く、閉じている間も `setNav` を撃つ                                                    | 直した（1本に統合）                                   |
| R2-11 | MEDIUM | react               | `plannedCursor ?? state.cursor!` の `state.cursor` はその瞬間必ず null。さらに `openComment` が閉じていても全行ぶんカーソルを組み立てている                                              | 直した                                                |
| R2-12 | MEDIUM | perf                | `readCandidates` の深いコピーは、呼び出し側の `cloneJkf(state.jkf)` と重複している。書き換えるのは各候補の先頭の手だけ                                                                   | 直した（実測 67.3ms → 27.5ms / 10001ノード）          |
| R2-13 | MEDIUM | robustness          | 新しい `branchEdit.test.ts` が cursor を全部 `null` で呼んでおり、R1 で変えた `patchForkPointersForDeleteNonReloc` / `relocateCursorOnDelete` を1本も通していない                        | 直した（5ケース追加、3変異で落ちることを確認）        |

## 重複・矛盾した所見

- R2-04 は comment（「二重適用では並びは変わらない」）と robustness（「空を落とすと番号が詰まる」）が
  別の角度から同じ doc を指した。両立するので、危険を「`ForkPointer` を作ったあとに掛けると
  値の指す先が変わる」に統一した。
- perf と robustness と architecture が独立に「`readCandidates` の候補は元の棋譜と共有していない」を
  確認し、結論が一致した（別名化なし）。perf だけが「だから深いコピー自体が不要」まで踏み込んだ。

## 別の issue へ送る

| reviewer            | 内容                                                                           | issue |
| ------------------- | ------------------------------------------------------------------------------ | ----- |
| robustness [HIGH]   | 分岐の削除・入れ替えの失敗が画面に出ず、「押しても反応しない」と区別が付かない | #198  |
| robustness [MEDIUM] | 空の変化の `forkIndex` の付け方が Rust の索引と TS で食い違う                  | #199  |
| robustness [MEDIUM] | 分岐の削除に確認も取り消しも無く、押した瞬間にファイルが上書きされる           | #200  |

## 見ていない範囲

- Rust 側は `kifu.rs` / `file_system/operations.rs` / `file_system/utils.rs` / `search/index_builder.rs` の
  該当関数のみ。本 PR に Rust の差分が無いため `npm run verify:rust` は未実行
- SCSS とレイアウト。`BranchList` の key が変わったことで手数をまたいで DOM が再利用されるようになり、
  mount 時アニメーションの発火タイミングが変わりうる（ui-reviewer を走らせていない）
- WebKit（実行環境）での `structuredClone` の速度。perf の測定はすべて V8（Node v26）
- `shogi_kifu_converter`（Rust）が「不戦勝で始まる変化」をどう読むか（#199 の向きに関わる）
- 実機での操作確認。所見はすべてコード読解とユニットテスト環境での計測に基づく

## lint / hook で強制できるもの

- `new JKFPlayer(...)` の直接生成を `entities/kifu/lib/cursorRuntime.ts` 以外で禁止する `no-restricted-syntax`。
  R2-08 の再発を止められる。現在の生成箇所は4つで、除外リストは現実的な大きさ
- `no-unnecessary-type-assertion`（型情報付きルール）。R2-11 の `state.cursor!` は機械で拾える
- 「枝」の禁止語 grep hook（`src/entities/kifu/**`）
- `entities/kifu/lib/branchEdit.ts` での `cloneJkf` 使用禁止。呼び出し側が複製済みの層で
  深いコピーを足す変更を止められる
- 拾えないもの: doc と実装の食い違い（R2-01 / R2-04）、同じ本体の `useEffect` の重複、
  テストのコメントと期待値の食い違い

## 次ラウンドの対象

R2-01〜R2-13 を直したうえで、修正で新しい問題が入っていないかを同じ5観点で見る。
今回も doc の書き換えが多く、R2-01 は「ラウンド1の修正が別方向に外れた」ものだったので、
comment-reviewer の「理由の行を指せるか」を引き続き重点にする。
