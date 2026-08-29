# レビュー entities-kifu ラウンド7

- 日付: 2026-08-30
- 範囲: `refactor/163-entities-kifu`（issue #163 / #164 / #165 / #166）の `origin/main` からの差分
- 対象コミット: `0750685`
- 走らせた reviewer: architecture / react / robustness / comment（perf はラウンド6で総括を出し所見0のため外した）
- 前ラウンド: `-r1.md` 〜 `-r6.md`

## 所見

| 番号  | 深刻度 | reviewer            | 内容                                                                                                                                                                                                              | 結果                                                      |
| ----- | ------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| R7-01 | MEDIUM | architecture        | `assertBranchIndex` の上限が裸の `number` で、`BranchIndex` の brand で潰したはずの ±1 の取り違えが第2引数側に残っている。`forks.length` や `options.length` を渡しても tsc が通る                                | 直した（候補配列そのものを受ける）                        |
| R7-02 | BLOCK  | comment, robustness | `neighborBranchIndex` の doc が、R6-01 で消したエラーメッセージ `"swap indices out of range"` を引用したまま。grep しても doc 自身しかヒットしない                                                                | 直した                                                    |
| R7-03 | MEDIUM | comment             | `assertBranchIndex` が2条件を1つのメッセージに潰しており、`0.5 is out of range (0..2)` と言う。`@throws` からも「整数でないとき」が抜けている                                                                     | 直した                                                    |
| R7-04 | MEDIUM | robustness          | `branchIndexFromForkIndex` が負を通し、`branchIndexFromSelection(-1)` が `MAIN_LINE` を返す。その値で削除すると**本譜が消える**。R6-01 で足したのは `Number.isInteger` だけだった                                 | 直した（下限も検査。`model/branch.ts` のテスト9件を新設） |
| R7-05 | MEDIUM | comment             | `isUsableFork` の「判定はここ1つ」が `resolveLine` の `!mv.forks[p.forkIndex]` で成り立っていない。`BranchOption.forkIndex` の doc「`ForkPointer` の値ではない」は事実と逆。整数検査テストのコメントが `1.9` で嘘 | 直した                                                    |
| R7-06 | MEDIUM | comment             | 直上の doc を逐語で繰り返す本文コメントが5箇所。swap の範囲外テストだけ別 describe に隔離されている                                                                                                               | 直した                                                    |

## 重複・矛盾した所見

- R7-02 は comment（BLOCK）と robustness（MEDIUM）が独立に同じ行を指した。
- R7-04 は「R6-01 の網が1形ぶん粗い」形で、**ラウンド4→5→6→7 と4ラウンド連続で同じ型の見落とし**。
  R4-05（空配列だけ）→ R5-01（`[null]` を追加）→ R6-01（`NaN`/小数を追加）→ R7-04（負を追加）。
  検査を足すたびに1形ずつ漏れている。R7-04 でようやく `model/branch.ts` にテストを置いた。

## 検証で所見にならなかったもの

- **UI が `NaN` / 小数 / 負の `BranchIndex` を作る経路は無い**（react が全経路を辿った）。
  R6-01 / R7-04 の throw は今日の UI からは発火しない。手で組む JKF と将来の呼び出し側への境界
- **`swapBranchesInKifu` の上限 throw も UI からは届かない。** `KifuForkMenu` の `canDown` が
  `options.length - 1` で、`readCandidates` の候補数は平坦化のぶん同じか多いので UI 側が常に保守的
- **`entities/kifu/model` に述語と変換関数と型が同居していること**は、`entities/position/model/shogi.ts`
  （`createPiece` / `convertJkfPiece` / `isPiece` が型と同居）や `engine-presets/model/types.ts` の
  `isPresetConfigured` と同じ形で、この repo の慣習に沿っている（architecture が10スライスを数えた）
- **依存の向きに新しい違反は無い。** `entities/kifu` 内のセグメント順は `api → lib → model` の一方向で、
  production の lib→lib は `applyMoveWithBranch → eqMove` の1本のみ

## 別の issue へ送る

| reviewer     | 内容                                                                                                   | issue |
| ------------ | ------------------------------------------------------------------------------------------------------ | ----- |
| react        | 分岐メニューで「本譜」を押すと、本譜へ戻らず変化が確定する                                             | #225  |
| react        | コメントを保存すると、見ていた変化の計画が消える（`branchPlan` の作り方が5経路で揃っていない）         | #226  |
| robustness   | 行が「計画」を持つため削除が画面に無い候補に当たる。**`assertBranchIndex` では止められない**根拠を追記 | #196  |
| architecture | `buildTesuuPointer` が `branch.ts` にあり、型の持ち主 `cursor.ts` が使えず手書きしている               | #190  |
| architecture | `JKFSpecial` / `isValidJKFSpecial` も呼び出し側0件                                                     | #192  |

## この PR の最終形（architecture の総括）

`origin/main` から良くなった点:

- `JKFData` の不変条件（空の変化を含まない）の責任が `api/parse` の出口1箇所に集約された
- `structuredClone` の実装が3本から `lib/cloneJkf.ts` 1本になった
- `new JKFPlayer` + `goto` が `entities/game` から `entities/kifu/lib/buildPlayer.ts` へ下り、
  `features/position-search` からも使えるようになった
- 「中身のある変化か」の判定が3実装から `model/jkf.ts` の `isUsableFork` 1本になった
- `BranchIndex` の範囲検査が `branchEdit` 内の手書き2箇所から `model` の `assertBranchIndex` へ上がり、
  整数・下限・上限を型と検査で守るようになった

紐づかない変更は `selectedBranchIndex` → `selectedOptionIndex` の改名1件だけで、
これは #166 の「派生フィールド」ではなく「添字を `BranchIndex` と紛らわしい名前で持っている」という別の話。
付けた doc に取り違え防止の価値があるので残し、PR 本文で説明する。

## 見ていない範囲

- Rust 側。この PR に `src-tauri/` の差分が無いため `npm run verify:rust` は未実行
- 実機での操作確認。R7-04 / #225 / #226 の再現はすべて `vite-node` での直接呼び出しとコード読解
- SCSS とレイアウト
- WebKit での実測（perf はラウンド6で総括済み）

## lint / hook で強制できるもの

- doc 中にエラーメッセージ文字列を引き写すことの禁止（R7-02 は R6-01 の修正で腐り、7ラウンド見つからなかった）
- `entities/kifu/lib/**` での `forks[...]` の truthy 判定の禁止（R7-05 の `resolveLine` は
  `[0]` を書かずに同じ穴を開けていたので、R6 の提案では拾えなかった）
- `branchPlan:` に `mergeBranchPlan(...)` 以外を渡すことの禁止（#226）
- `` `${x},${JSON.stringify(y)}` `` と `as TesuuPointer` を `model/cursor.ts` 以外で禁止（#190）
- 未使用 export の検出。通算14件、7ラウンド連続で同じ提案
- ユニオンのメンバの直前に置かれた JSDoc の検出（R7-05）
- 拾えないもの: `@throws` の網羅性（5ラウンド連続）、`state.cursor` と `branchPlan` の取り違え
  （型が同じ `ForkPointer[]` である限り再発する。brand を付けるのが唯一の機械的な防ぎ方）

## 次ラウンドの対象

R7-01〜R7-06 を直したうえで、修正で新しい問題が入っていないかを見る。
**入力検査は4ラウンド連続で1形ずつ漏れている**ので、robustness には
「`BranchIndex` と `forkIndex` が取りうる値の全域」を表で埋めさせる。
