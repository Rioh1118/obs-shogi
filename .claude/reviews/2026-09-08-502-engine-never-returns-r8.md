# レビュー 502-engine-never-returns ラウンド8

- 日付: 2026-09-09
- 範囲: `fix/441-stop-analysis-on-unmount...HEAD`
- 走らせた reviewer: architecture / react / robustness / comment / oss-hygiene
- 対象コミット: `a6ef439a`
- 前ラウンド: [r1](2026-09-08-502-engine-never-returns-r1.md) 〜 [r7](2026-09-08-502-engine-never-returns-r7.md)

**変異を当てたのは react だけ**（r7 の「reviewer どうしが同じワークツリーで実験を壊し合う」への対処）。
他の4人は読むだけ。**その結果、r7 のような「実測が信用できない」の申告は1件も出なかった。**

## r7 の修正が効いていることの確認（react が11種類の変異で実測）

r7 で「恒真だった」と直した `test.each` が、いま**11種類の変異すべてを捕まえる**。

| 変異                                                | 落ちる本数 |
| --------------------------------------------------- | ---------- |
| `idle` の枝から `initialize()` を消す               | 11         |
| `RECOVERABLE_NOT_READY_REASONS` → `["failed"]`      | 2          |
| → `["starting","failed"]` / `[]`                    | 1 / 1      |
| 三項から `!willRetryAfterError` を削る（r6 のバグ） | 1          |
| `error` の枝を無条件 `initialize()` に              | 9          |
| `isReady` から `equalRuntime` を削る                | 1          |
| テスト側で戻す口を撃たない                          | 1          |

effect の依存に `willRetryAfterError` を足した件も実測で「再実行の回数は完全に一致」。

## 所見

### HIGH-1 私が新設した解析のテストが、ツリーを1文字も変えていない HEAD で落ちる（robustness。7回中1回）

`isAnalyzing === false` と `error` の2本は通り、**候補手だけが1本残る**。
コミットは `verify-gate` が `npm run test` を通してから許すので、
**無関係な変更が時々止まる**。しかもこの検査は #502 の受け入れ条件を見る唯一のもの。

**私は再現できなかった**——単体6回・フル5回・安定性の assert を足してさらに4回、すべて緑。
robustness も単体×3・並列×12・負荷付きフル×5 で出せず、**落ちたのはキャッシュが冷えた1回だけ**。
機構は特定できていない（robustness の仮説は `flushLatest` が `latestResultRef` を空けないこと
だが、`cutRunningAnalysis` は `dropPendingResult` でそれを空けるので、その筋では説明が付かない）。

### HIGH-2 `settings.md` の「複製」の行が現物の逆（architecture / oss-hygiene）

「**複製先へは移動しない**」——実際は `selectPreset(nextPreset.id)` を撃つので、
**複製先が「適用中」を取って一覧の先頭へ移る**。
しかも**この PR は同じ表の削除の行を書き換えている**（隣の行を通り過ぎた）。

さらに、`1cb0f10a`（`entities/engine-presets` の revert）が**同じ PR 内の独立コミット
`5e2c4a08` を飲み込んでいた**——腐ったコメントは消えたが、事実を書いた `duplicatePreset` の
TSDoc も一緒に消え、**複製の挙動を書いた場所がリポジトリのどこにも無くなっていた**。

**消えた TSDoc 自体も誤っていた**（「選ぶのでエンジンは起こし直る」——複製は起動の設定が
元と同一なので同値と見なされ、起こし直らない）。r3 の報告書の同じ主張も誤り。

### HIGH-3 `retriesAfterError` の TSDoc が経緯を書き、しかもその窓は到達しない（comment）

「**その形は実際に1度入っている**」は CONTRIBUTING の「変更の経緯を書かない」に当たり、
かつ `phase === "error" && lastTried === null` は現物では作れない。

### MEDIUM-4 三項が `EnginePhase` に対して網羅でなく、既定が「戻る側」へ倒れている（architecture）

`phase` を1つ足すと、その窓は黙って `starting` になり、
**解析が誰にも断たれないまま回り続ける**（#502 そのもの）。
`enter` の `Record` が要求するのは「**理由**が増えたら窓を書く」だけで、
doc が名指しした危険（「**枝**を足した人が表を直さない」）と軸が1段ずれていた。

### MEDIUM-5 `retriesAfterError` の引数が同じ型の nullable 2つで、取り違えが tsc を通る（architecture）

`equalRuntime` は対称なので、入れ替えても**両方が非 null の回は挙動が1ビットも変わらない**。
差が出るのは `lastTried === null` の1点——**述語を1つにして守った条件を、
引数の順序という守られていない経路が丸ごと持っていた**。

### MEDIUM-6 「三項と effect の両方が同じものを呼ぶ」が字面どおりでない（comment）

呼び出しは1箇所で、effect は値を**読む**だけ。同期を保っているのは effect の依存配列。
**字面どおりに揃えた人が effect の中で呼び直すと、`lastTriedRef` の更新を取りこぼす**
——コメントが名指ししている危険を、コメントの指示どおりに直した人が再現できる。

### MEDIUM-7 `EngineProvider` の再入の門が同一コミットで効かない（react。差分の外・実測）

`if (state.phase === "initializing")` は描画のクロージャを見ているので、StrictMode の
setup → cleanup → setup で `initialize` が**2回**走る（実測）。
**2プロセスにならないのは `engineInitializer` 側の in-flight の畳み込みだけが理由**で、
この門ではない。他の provider は StrictMode 安全性を明示して固定しているのに、ここだけ例外。

### MEDIUM-8 `engine.md` ※7 の脚注が、起こり得ない `?` を折れる先に名指し（oss-hygiene。Rust を読んで反証）

`EngineAnalyzer::shutdown` は**常に `Ok`** を返すので、`initialize_engine` 先頭の `?` は一度も折れない。
F-39 を塞ぐ人が「放っておけば `failed` へ落ちる」と結論する筋が通ってしまう。

### MEDIUM-9 ※7 の `starting` の列挙に、述語の3つ目の枝が無い（robustness）

`lastTried` が無い回も `starting` なのに、列挙は「S3 で runtime が**動いた**窓」で止まっている。

### MEDIUM-10 `analysis.md` ※1 の分類に、この PR の主役の経路が入っていない（robustness）

「席の欄に触らないまま撃つ経路は1つだけで、しかも踏めない」と読めるが、
**`cutRunningAnalysis` がまさにその例外**。

### MEDIUM-11 テストの `type Window` が DOM のグローバルを覆い、`finish` が何を finish するか読めない（comment）

### MEDIUM-12 テストのコメントが、そのテストが作っていない窓（起こし直し）を名乗っている（comment）

### MEDIUM-13 `analysisRefusals` のモジュール doc が「見るのは2つ」のまま、検査は4つ（comment）

「5枝」も現物と合わない数。

## 重複・矛盾した所見

- **HIGH-2 は architecture と oss-hygiene が独立に指摘**し、oss-hygiene が revert の巻き添えまで辿った
- **MEDIUM-8 と MEDIUM-9 は同じ ※7 の別の行**
- architecture は **r6 の異議（`cutRunningAnalysis` の型付け）を取り下げた**——
  「型で消せるものを正規表現で代用している」という主張が誤りだったと自ら訂正

## 見ていない範囲

- `perf` / `ui` / `rust` reviewer は8ラウンドとも走らせていない
- **実プロセスでの確認は8ラウンドを通して1件も無い**
- **HIGH-1 の機構は特定できていない**（私も robustness も再現できず）
- 基底ブランチ側でも `analysis.md` が動いている。マージ時の衝突は見ていない

## 修正の結果（`/review-fix`）

| 所見                         | 結果                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| HIGH-2                       | `f6ded400`。`settings.md` の複製の行を現物に合わせ、起こし直しが起きないことも書いた           |
| HIGH-3 / MEDIUM-5 / MEDIUM-6 | `f6ded400` / `8fa6dba9`。経緯を落とし、引数を名前で受け、`notReadyReason.ts` へ分けた          |
| MEDIUM-4                     | `f6ded400`。`reasonForPhase` の `switch` で網羅（**`phase` を足すと tsc が落ちることを確認**） |
| MEDIUM-7                     | `f6ded400`。門を ref にし、StrictMode で1回であることを固定（**門を外すと落ちることを確認**）  |
| MEDIUM-8 〜 MEDIUM-13        | `f6ded400` / `8fa6dba9`                                                                        |
| HIGH-1                       | **直しきれていない**（下）                                                                     |

### HIGH-1 について（未解決であることの明示）

**再現できなかったので、原因は分かっていない。** やったのは
「落ち着いた後にもう一度候補手を見る」assert を足したことだけ——
~~遅れて戻る形が在るなら**毎回**赤くなるようにした~~（いまは緑）。

> **訂正（r9）。** その assert は**どの変異でも赤くならない**——
> `cutRunningAnalysis` が `stop_analysis` を撃つので `analyzingRef` が false になり、
> 生き残ったタイマーが起きても `flushLatest` は先頭の門で降りる。3行上の assert の
> 逐語コピーだった。**私は「毎回赤くなる」を確かめずに書いた**（r4/r5 で自分に課した
> 「名指しした assert が赤くなることまで見る」を守っていない）。r9 で落とした。

**これは修正ではない。** 次に落ちた人が同じ探索をやり直さずに済むよう、
観測（7回中1回・キャッシュが冷えた回・手前の2本は通る）をここに残す。
`RESULT_FLUSH_MS` を実時計でまたぐ形が土台にあるので、
偽タイマーへ寄せるのが本筋（`Date.now()` を読む打ち切りがあるので
`shouldAdvanceTime` が要る）。**この PR ではやらない**——
`entities/analysis` のテスト64本が同じ `advance` の上に載っており、
まとめて移す変更は #502 の範囲を超える。

## 次ラウンドの焦点

1. **`reasonForPhase` / `retriesAfterError` を新しいファイルへ移した。** 置き場と名前、
   `equalRuntime.ts` に残ったものとの関係
2. **再入の門を ref にした**ことで、`initialize` の早期 return の順序が変わった。
   `seqRef` との関係で取りこぼす窓が無いか
3. **HIGH-1 の flake が、安定性の assert を足したことで形を変えていないか**
4. `settings.md` / `engine.md` ※7 / `analysis.md` ※1 の書き足しが、互いに矛盾していないか
