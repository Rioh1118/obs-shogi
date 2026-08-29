# レビュー entities-kifu ラウンド8

- 日付: 2026-08-30
- 範囲: `refactor/163-entities-kifu`（issue #163 / #164 / #165 / #166）の `origin/main` からの差分
- 対象コミット: `95b3a8a`
- 走らせた reviewer: architecture / robustness / comment（react と perf は所見が既送 issue に収束したため外した）
- 前ラウンド: `-r1.md` 〜 `-r7.md`

## 入力検査の網羅を証明した

ラウンド4〜7は「前ラウンドの直しの網が1形ずつ粗い」を4回繰り返した。
今回は5度目を探すのではなく、robustness に**値の全域を表で埋めさせた**。

`BranchIndex` / `forkIndex` / `te`・`tesuu` の3軸について
`null` / `undefined` / 負 / 0 / 範囲内 / 範囲外 / 小数 / `NaN` / `±Infinity` / `-0` / `1e21` /
`2**53` / 文字列 を実際に走らせ、どの関数が最初に弾くかを埋めた。

結果:

- `assertBranchIndex` を素通りするのは `-0` だけで、それは `0` と完全に同義
  （`splice` も `buildTesuuPointer` も `-0` を区別しない）
- `cursor.forkPointers` / `cursor.tesuu` を素通りする値はあるが、実行時に必ず
  `JKFPlayer.getForkPointers()` / `player.tesuu` 由来なので到達しない
- **検査そのものが欠けていたのは `forkIndexFromBranchIndex` の1つだけ**（R8-02）

**漏れていたのは値の形ではなく、値の出所だった。**

## 所見

| 番号  | 深刻度 | reviewer              | 内容                                                                                                                                                                                 | 結果                                                                                         |
| ----- | ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| R8-01 | MEDIUM | architecture, comment | `assertBranchIndex` の第2引数が `readonly unknown[]` で、doc が名指しした2つの取り違え（`forks` / `BranchOption[]`）がどちらも型検査を通る。doc だけが「brand で潰した」と言っていた | 直した（`Candidates` に brand を付けて `model` へ。`forks` を渡すと tsc が落ちることを確認） |
| R8-02 | MEDIUM | robustness, comment   | `forkIndexFromBranchIndex` だけ整数検査が無く、`0.5 → -0.5` / `NaN → NaN` / `"1" → 0` が通る。doc の「防いでいる向き」の説明も逆                                                     | 直した（両向きを対称に。変異で確認）                                                         |
| R8-03 | MEDIUM | comment               | `cursor` 由来の throw が `writeCandidates` の**あと**に起きるので、例外が出たのに `kifu` だけ書き換わる。`@throws` も `q` と `cursor` を1行に畳んで両方とも不正確                    | 直した（検査を書き換えの前へ。原子性をテストで固定）                                         |
| R8-04 | MEDIUM | architecture          | `relocateCursorOnDelete` の2つの return が逐語で同一。`target` は分岐に効いておらず、存在しない場合分けを読ませていた                                                                | 直した                                                                                       |
| R8-05 | MEDIUM | architecture          | `buildPlayer` を作ったのに `leafTesuu` だけ `new JKFPlayer` + `goto` の手書きが残っていた                                                                                            | 直した                                                                                       |
| R8-06 | MEDIUM | robustness            | `parseKifuContentToJKF` の `@throws` が KIF / KI2 / CSA で成り立たない。壊れたファイルは throw せず「0手の棋譜」として返る                                                           | doc を実態に。0手の検査は #210 へ                                                            |
| R8-07 | MEDIUM | comment               | テスト名と中身が合っていない（下限の検査が「候補数を超える値」に混ざる）。`as never` が正規の変換で作れる値にも使われている                                                          | 直した（R8-01 と同じコミット）                                                               |
| R8-08 | MEDIUM | comment               | `model` の doc が `lib` の非公開関数を名指ししている（R7-02 と同じ腐り方の再生産）                                                                                                   | 直した（R8-02 と同じコミット）                                                               |

## 別の issue へ送る

| reviewer            | 内容                                                                   | issue             |
| ------------------- | ---------------------------------------------------------------------- | ----------------- |
| robustness [BLOCK]  | コメントの保存が失敗しても「保存済み」と出て、書いた本文が消える       | #227              |
| robustness [HIGH]   | 棋譜ストリームの行が「計画」を報告し、以降の行の削除が無言で行き止まる | #196 に実測を追記 |
| robustness [MEDIUM] | 読めなかった入力が0手として返る件の引き金は文字コードに限らない        | #210 に実測を追記 |
| robustness [MEDIUM] | 局面検索の「続き」が失敗を全部「（続きなし）」にする                   | #187（既送）      |

**#227 は BLOCK。** `origin/main` からある構造でこの PR の回帰ではないが、
「エラーが出ない」（#186）ではなく「積極的に成功と表示して本文を捨てる」ので、
follow-up の先頭に置くこと。

## 検証で所見にならなかったもの

- **消し忘れ・使われていない export は無い**（architecture が34ファイルを洗った）。
  削除した識別子（`appliedForkPointers` / `mergeForkPointers` / `cloneJKF` / `BranchOption.id` /
  `Opt.branchIndex` / `selectedBranchIndex` など）の参照は `src` / `docs` / `.claude` に0件。
  この PR が入れた export はすべて production から呼ばれている
- **`model/__tests__` の前例はこの PR が作ったものではない**（`analysis` と `game` に既にある）
- **依存の向きに新しい違反は無い。** `entities/kifu` のセグメント順は `api → lib → model` の一方向
- **`resolveLine` の `mv!.forks![p.forkIndex]` は実行時に安全。** `isUsableFork` が true なら
  optional chain が短絡していないので `mv` と `mv.forks` は必ず存在する
- **R7-06 で削除した5箇所のコメントで失われた情報は無い**（comment が `git show` で確認）

## 見ていない範囲

- Rust 側。この PR に `src-tauri/` の差分が無いため `npm run verify:rust` は未実行
- 実機での操作確認。表と再現はすべて Node（型ストリップで実体を import）とコード読解
- SCSS / レイアウト / a11y
- WebKit での実測（perf はラウンド6で総括済み、ラウンド8では走らせていない）
- React コンポーネントのレンダ（`KifuForkMenu` の `normalizeSelected` などは
  コードを読んで入力値の到達範囲だけ確かめた）

## lint / hook で強制できるもの

- `readonly unknown[]` / `unknown[]` を引数型に書くことの禁止（`src` 全体でこの1箇所だけだった。
  書かれたら brand を検討する合図になる）
- 同一モジュールからの `import` 文の重複禁止（`import/no-duplicates` 相当）
- `model/**` の doc 内から `lib/**` の識別子名を参照することの禁止（R7-02 / R8-08 で2回目）
- テストファイルでの `as never` の許可リスト化（R3-08 で直った書き方が新規ファイルで復活していた）
- 「`throw` を含む関数を呼ぶ公開関数に `@throws` があるか」の静的検出。
  6ラウンド連続で外している `@throws` の網羅性のうち、今回落ちていた `cursor` 由来の1件はこれで見つかる
- 未使用 export の検出。8ラウンド連続で提案が出ている
- 拾えないもの: 「計画と実際が一致しているか」（#196）、「catch が UI に理由を渡しているか」（#227）

## 次ラウンドの対象

R8-01〜R8-08 を直したうえで、修正で新しい問題が入っていないかを見る。
値の全域は表で埋め切ったので、次は**型と doc の対応**（brand が実際に何を保証しているか）を
architecture と comment に確かめさせる。
