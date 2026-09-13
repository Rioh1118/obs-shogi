# レビュー 502-engine-never-returns ラウンド6

- 日付: 2026-09-09
- 範囲: `fix/441-stop-analysis-on-unmount...HEAD`
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 対象コミット: `a89c0a4f`
- 前ラウンド: [r1](2026-09-08-502-engine-never-returns-r1.md) / [r2](2026-09-08-502-engine-never-returns-r2.md) / [r3](2026-09-08-502-engine-never-returns-r3.md) / [r4](2026-09-08-502-engine-never-returns-r4.md) / [r5](2026-09-08-502-engine-never-returns-r5.md)

**r1〜r5 の所見は1件も再掲されなかった。**

## 対象そのものを疑う

**所見の中身が入れ替わった。** r5 まで所見を生んでいたのは `entities/engine-presets`
（3ラウンド続けて別の BLOCK を作った）で、それは base へ戻して #518 へ送った。
**r6 の所見は「私が書いたテストが、名乗っている条件を観測していない」に集中している。**

| 名乗り                                       | 実際に見ていたもの                                      |
| -------------------------------------------- | ------------------------------------------------------- |
| 「起こし直している間も `starting`」          | `no-engine` の不在と、最終的に ready へ着くこと**だけ** |
| 「この回は窓が開かない」                     | **何も**（`act` の中で中間の commit が畳まれる）        |
| 「`runtimeConfig` は null を通らない」（r4） | **何も**（同上。r5 で判明）                             |

`starting` はテスト名とコメントに4回出るのに、**期待値に一度も現れていなかった**——
comment が当てた変異（`phase === "error" || phase === "idle" ? "failed" : "starting"`）は
**1028 テスト全部を素通り**した。#502 が守る性質そのものが無検査だった。

**根は、性質そのものではなくその周りを assert していたこと。** r6 では
`EngineNotReadyReason` の全値を回して**分類を現物の振る舞いから引き直す** `test.each` を置いた
——理由が増えた回に「窓の作り方が無い」で落ちるので、0件で黙らない。

**そして、この穴が本物の欠陥を1つ隠していた**（下の HIGH-1）。

## 所見

### HIGH-1 `failed` を無条件に終端と分類していた（robustness。再現済み）

`EngineProvider` は `desiredRuntime` が前回試した値から動いていれば**自分で起動し直す**
（`error` の枝）。その窓で解析だけが `failed` を終端と読んで打ち切るので、
**エンジンは数秒後に黙って戻り、盤の下は止まったまま「使えなくなった」の断りが残る。**

踏む筋: 解析中にプリセット A→B へ切替 → B の初期化を待つ間にもう一度 C へ切替 →
B の初期化が落ちる（`lastTried = B`、`desiredRuntime = C`）→ 理由は `failed` → 断つ →
直後に engine が C で起動し直す → `isAnalyzing` は false なので張り直す口が1つも通らない。

**同じ PR のテスト「設定が変われば failed からは再トライする」が、`failed` が終端とは
限らないことを固定している。分類の側だけがその条件を落としていた。**

### HIGH-2 テストが名乗る `starting` を、どの assert も見ていない（react / comment）

上の節に書いた。3本の `it` が `starting` を名乗り、期待値には `no-engine` の不在しか無い。

### HIGH-3 `engine-presets` の2本目が、同じファイルの doc が禁じる形で書かれていた（react / comment / architecture の3本）

1本目は「**`act` の外で解決させる。** 中に入れると畳まれて、どう壊しても緑になる」と
書いているのに、**30行下の2本目がその形**。非選択の削除にも窓を開ける変異を当てても
2本とも緑だった（3人が独立に確認）。

### MEDIUM-4 `cutRunningAnalysis(refusal: string)` が、表の取り違えを型で止めていない（architecture）

`ON_START_REFUSALS` は `WHILE_ANALYZING_REFUSALS` の鍵の上位集合なので、**添字は通る**。
実際に差し替えて `tsc -b` が緑になることを確認された。救っているのはテスト3本だけ。

### MEDIUM-5 断った2本だけが、解析を元に戻す手順を書いていない（robustness）

`cutRunningAnalysis` は `isAnalyzing` を倒すので、案内どおり起こし直しても
**盤の下は止まったまま**。他の断りは全て「もう一度 ▶」で終えており、
ファイル冒頭の規約（ADR-0004 決定1）もそう要求している。**この2本だけが例外。**

### MEDIUM-6 分類が、それを決めている effect と機械的に結ばれていない（architecture）

`RECOVERABLE_NOT_READY_REASONS` は `types.ts` の中でしか読まれておらず、
doc が主張する「engine を変えた人の手元で赤くなる」が現物に無い。

### MEDIUM-7 テストの `as unknown as` が1つも仕事をしていない（architecture）

`EnginePreset` に必須欄を足しても、このテストはエラー一覧に出てこない。
**同じ PR の隣のファイルは逆をやっている**（`let engine: EngineReadiness` と型を付け、
理由をコメントに書いた）。同じ規則が3スライスのうち1つにしか掛かっていない。

### MEDIUM-8 「それで1度入っている」——直った欠陥の記録が現在形と区別できない（comment）

現物にその形は無いのに「入っている」と読める。CONTRIBUTING の「変更の経緯を書かない」に当たる。

### MEDIUM-9 F-38 / F-39 の出典が、マージすると消えるブランチ名（comment）

台帳の規約は「迷ったらコミットハッシュで書く」と逃げ道を用意している。

### MEDIUM-10 F-28 の「段」が `Phase` の意味のまま（oss-hygiene）

r5 の MEDIUM-10 は2箇所を名指ししたのに、**直したのは片方だけ**だった。
しかも絶対形の規則を足したので、残った1箇所が §3 と正面から矛盾する。

### MEDIUM-11 r4 の記述2箇所に訂正済みの印が無い（oss-hygiene）

r5 が同じ形を MEDIUM-11 として立て、`b330ac46` で1箇所だけ印を付けた。
**同じ PR の中で作法が割れている。**

### MEDIUM-12 プリセットを消すと解析が切れることが、その操作を持つ画面仕様に無い（oss-hygiene）

`analysis.md` の ※5 だけが持っている。`settings.md` の削除の行は「最後の1枚は消せない」だけ。

### MEDIUM-13 IDEAS の `console.log` の項目が、着手範囲を現物の 1/4 でしか見積もっていない（oss-hygiene）

`console.log` は4件ある。除外リストの説明も `entities/analysis` の3カテゴリしか挙げておらず、
**台帳が失敗の唯一の出口として数えている `console.error` 群**（F-10 / F-13 / F-15 / F-16 / F-18）を
巻き込む形になっていた。

### MEDIUM-14 IDEAS の deep import の件数が、同じ段落が書いている `rg` の結果と合わない（architecture）

## 重複・矛盾した所見

- **HIGH-2 / HIGH-3 / MEDIUM-6 / MEDIUM-7 は全て「テストが名乗るものを見ていない」**。
  MEDIUM-6 の直し（分類を振る舞いから引く `test.each`）が、この束の要
- **HIGH-1 は HIGH-2 が隠していた**——`starting` を assert していれば、
  「再トライを待つ窓が `failed` になる」は最初のラウンドで落ちていた
- react と comment と architecture が**同じ2つのテストの空振りを独立に再現**した

## 見ていない範囲

- `perf` / `ui` / `rust` reviewer は6ラウンドとも走らせていない
- **実プロセスでの確認は6ラウンドを通して1件も無い**
- HIGH-1 の3段目（B の初期化が現物のタイミングで落ちるか）は未確認
- 基底ブランチ側でも `analysis.md` が動いている。マージ時の衝突は見ていない

## 修正の結果（`/review-fix`）

| 所見                  | 結果                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| HIGH-1                | `97066f32`。三項が見る条件を、起動し直すかを決めている effect の枝と同じにした                    |
| HIGH-2 / MEDIUM-6     | `97066f32`。3本に `toContain("starting")` を足し、**分類を振る舞いから引く `test.each`** を置いた |
| HIGH-3                | `97066f32`。2本目を1本目と同じ形へ                                                                |
| MEDIUM-5 / MEDIUM-8   | `97066f32`。断りを ▶ の押し直しで終え、直った欠陥の記録を落とした                                 |
| MEDIUM-7              | `97066f32`。`satisfies` へ                                                                        |
| MEDIUM-9 〜 MEDIUM-14 | `97066f32`                                                                                        |
| MEDIUM-4              | **見送り（下の反論）**                                                                            |

**変異を当てて確かめたもの**——今回も**名指しした assert が単独で赤くなること**まで見た。

- `failed` を無条件に終端へ戻すと、「初期化が落ちた後に設定が動いたら、再トライを待つ窓は
  starting」が落ちる。**`test.each` は落ちない**（あちらの `failed` の窓は同じ設定なので
  本当に終端）——**穴の形が違うので、両方要る**
- 非選択の削除にも窓を開ける変異で、`engine-presets` の2本目が落ちる（**直す前は緑だった**）

### 反論（MEDIUM-4 を直さなかった理由）

`cutRunningAnalysis(reason: TerminalNotReadyReason)` にして表の引きを関数へ入れる案は、
**指摘のとおり型で取り違えを止められる**。だが `failStart` の側は6つの入口を持ち、
そちらを直さないと「2つの `string` が混ざる」形は残る——**片方だけ直すと、
型で守られている面と守られていない面が同じファイルに並ぶ**（この PR が
`ON_START_REFUSALS` / `WHILE_ANALYZING_REFUSALS` の非対称で1度作った形）。

**断りの型付け全体は #277 / ADR-0004 の「読み手を作る」作業と同じ場所を触る**ので、
そちらへ寄せる。いまの守りはテスト3本で、**表を取り違えると赤くなることは確認済み**。

## 次ラウンドの焦点

1. **`willRetryAfterError` を三項に足したことで、`lastTriedRef` を描画中に読む形が入った。**
   その値が動くのは `initialize` の中だけ（直後に dispatch が走る）だが、
   **読んだ描画と effect が見る値がずれる窓が無いか**
2. **`test.each` が「戻る側」に対して弱い**（「戻らない側へ落ちていない」しか見ていない）。
   `starting` の窓で本当に ready へ進むことまで見るべきか
3. **断りに ▶ を足したことで、文言が長くなった。** 3つの入口すべてで実行できる案内のままか
4. doc の4箇所（不変条件2 / ※5 / spec / F-38・F-39）と `settings.md` が矛盾していないか
