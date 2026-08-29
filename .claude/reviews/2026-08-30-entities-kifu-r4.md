# レビュー entities-kifu ラウンド4

- 日付: 2026-08-30
- 範囲: `refactor/163-entities-kifu`（issue #163 / #164 / #165 / #166）の `origin/main` からの差分
- 対象コミット: `a81f449`
- 走らせた reviewer: architecture / react / robustness / perf / comment
- 前ラウンド: `-r1.md` / `-r2.md` / `-r3.md`

## 所見

| 番号  | 深刻度 | reviewer       | 内容                                                                                                                                                                                                                                                                 | 結果                       |
| ----- | ------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| R4-01 | HIGH   | comment        | `buildPlayer` の `@throws`「cursor の手数まで進めないとき throw する」が逆。`goto` は届かなければ黙って止まる（2手の棋譜に `goto(50)` で tesuu=1、throw なし）。doc を信じると「throw しなかった＝手数が一致した」と読み、CLAUDE.md の「stale として扱う」を踏み外す | 直した                     |
| R4-02 | HIGH   | comment, react | `gameView.player ? gameState.cursor : null` の根拠「cursor が前の棋譜のもの」が成り立たない。`jkf` と `cursor` を書く action は3つとも両方を同時に置き換える                                                                                                         | 直した（門番ごと削除）     |
| R4-03 | MEDIUM | react          | **この PR の回帰。** R2-10 で2本の effect を1本にしたとき `isOpen` の門が全体に掛かり、閉じている間の同期が消えた。常時マウントなので、開いた最初のレンダが古い `nav` で走り、0手目のプレビューと分岐一覧が1フレーム描かれる                                         | 直した（layout effect に） |
| R4-04 | MEDIUM | architecture   | `appliedForkPointers` は `normalizeForkPointers` の2つ目の実装。30万ケースで出力が参照 identity まで一致                                                                                                                                                             | 直した（統合）             |
| R4-05 | MEDIUM | robustness     | 空の変化に `{ ...f[0] }` を当てると `{}` という手を捏造して棋譜に書き戻す。R3-01 が、大声で落ちていた入力を黙って壊す入力に変えていた                                                                                                                                | 直した（throw + テスト）   |
| R4-06 | MEDIUM | comment        | `swapBranchesInKifu` / `deleteBranchInKifu` の `@throws` が `te` の範囲を網羅していない                                                                                                                                                                              | 直した                     |
| R4-07 | MEDIUM | comment        | 同じ手数の入れ子の変化が平坦化されて番号が振り直される事実が公開 doc に無い                                                                                                                                                                                          | 直した                     |
| R4-08 | MEDIUM | comment        | `BranchEditResult` にだけ doc が無く、`nextCursor: null` の意味が読み取れない                                                                                                                                                                                        | 直した                     |
| R4-09 | MEDIUM | comment        | `NavigationState.PreviewCursor` だけフィールド名が大文字始まり                                                                                                                                                                                                       | 直した                     |

## 検証で所見にならなかったもの

- **`readCandidates` のコピー方針（R2-12 → R3-01）**: robustness が入力の全 `IMoveFormat` を
  `Object.freeze` してから swap / delete を 2,052 回、木の走査で identity 重複を 8,615 回、
  カーソル保存を 6,828 回、throw 時の原子性を 20,000 回検査し、いずれも違反0件。
  R3-01 以前の実装を同じ harness に掛けると 1,145 件検出されるので、検出器が効いていることも確認済み
- **R3-01 の追加複製の代償**: perf が候補数181本の分岐点で `readCandidates` が +0.25ms と測ったが、
  同じ場面で呼び出し側が必ず走らせる `cloneJkf(state.jkf)` は 31.15ms。追加分は 0.8% で
  R2-12 の効果は目減りしていない
- **PR 全体で処理量が増えた箇所**: perf が全ファイルを追って0件。減った側は分岐編集
  （候補181本で 52.98ms → 0.133ms）、棋譜ストリームの行の組み直し（2000手200変化で 18.2ms 減）など
- **`sanitizeJkf` の回数増**: 増えたのは3経路×棋譜1枚ぶんで、`sanitizeJkf` 単体は 12000ノードで 0.0689ms。
  同じ経路のパース全体（19.8ms）の 0.05% 未満
- **`jkf` → `player` の改名**: react が差分を1行ずつ確認し、置き換え漏れ・巻き込み0件

## 別の issue へ送る

| reviewer              | 内容                                                                             | issue               |
| --------------------- | -------------------------------------------------------------------------------- | ------------------- |
| robustness [BLOCK]    | UTF-8 / Shift_JIS 以外の棋譜が「0手」として開き、1手指すと元ファイルを上書きする | #210                |
| robustness [MEDIUM]   | `JKFPlayer.logs` に再生ログが無制限に積まれ、閉じた棋譜も解放されない            | #211                |
| perf [MEDIUM]         | テストスイートの94%が2ケースの実時間 sleep で、verify を6.6秒押し上げている      | #212                |
| architecture [MEDIUM] | 「計画に沿って1手進める」規則が5箇所に手書きされ、部品は使えない場所で死んでいる | #213                |
| architecture [LOW]    | `entities/kifu` 内の import が `@/` と相対に割れている                           | #191 にコメント追記 |

**#210 は BLOCK だが、この PR の回帰ではない**（`origin/main` にも同じ構造がある）。
Rust のデコード経路に触るので範囲外とした。#204 と並べて follow-up の先頭に置くこと。

## 見ていない範囲

- Rust 側の実行。`operations.rs` / `kifu_reader.rs` は読解のみで `npm run verify:rust` は未実行。
  UTF-16LE の挙動は同じ判定手順を JS で再現して確認した。EUC-JP / ISO-2022-JP は読解まで
- WebKit（実行環境）での実測。数値はすべて V8（Node v26.5.0）と happy-dom
- SCSS とレイアウト。`BranchList` の key 変更による mount アニメーションの見え方
- 実機での操作確認。#210 / R4-03 の再現手順はコード読解とライブラリの単体実測に基づく組み立て
- `readCandidates` の最大ケース（候補1100本超）はベンチがタイムアウトして完走せず、
  候補181本までの傾向で判断した

## lint / hook で強制できるもの

- 未使用 export の検出（`knip` 等）。R2-09 / R3-09 / R3-10 / R4-04 と `kifuPlan.ts` の3件で通算7件目。
  4ラウンド連続で同じ提案が出ており、人の注意で回すのは破綻している
- `{ ...expr[0] }` のような添字アクセスの spread を `entities/kifu/lib/**` で禁止（R4-05 の型の事故）
- テスト1ケースあたりの時間の上限（#212）、テスト内での定数 `setTimeout` の禁止
- `forkAndForward` の呼び出し場所の制限（#213）
- 大文字始まりのプロパティ名（R4-09）
- 拾えないもの: `@throws` の内容の正しさ、コメントの主張とコードの一致（今ラウンドの HIGH 2件）、
  「throw していた入力を黙って通すようになった」という失敗モードの変化（R4-05）

## 次ラウンドの対象

R4-01〜R4-09 を直したうえで、修正で新しい問題が入っていないかを見る。
doc の嘘は r1 で2件、r2 で1件、r3 で1件、r4 で2件と毎ラウンド出ているので、
comment-reviewer は引き続き「根拠の行を指せるか」を全件やること。
R4-03 は「前ラウンドの修正が別の回帰を作った」形なので、react は統合した effect の等価性を
もう一度見ること。
