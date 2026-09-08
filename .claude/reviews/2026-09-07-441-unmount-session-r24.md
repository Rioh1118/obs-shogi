# レビュー 441-unmount-session ラウンド24

- 日付: 2026-09-09
- 範囲: `git diff origin/main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / oss-hygiene / architecture（5人とも走り切った）
- 対象コミット: `8c640b41`（**`main` を取り込んだ直後**。#404）
- 前ラウンド: [r22](2026-09-07-441-unmount-session-r22.md) / [r23](2026-09-07-441-unmount-session-r23.md)

## 所見

### [HIGH] 1. 捨てた席の後始末が、間引きの1周期（80ms）しか効いていない

reviewer: react（実測）。こちらでも再現した。

`commitLatest` が見るのは `analyzing.current` だけで、**席も世代も見ていない**。
`dropPendingForLostSeat` は「枠を落とす」ので、**落とす前にタイマーが起きていれば手遅れ**。

```
（既存テストの待ちを 50ms → 120ms にしただけ）
× 開始が断られた回も、反映待ちを残さない
AssertionError: expected [ { rank: 1, pv_line: [ '7g7f' ] } ] to have a length of +0 but got 1
```

**死んだエンジンの読み筋が、盤が別の局面を映したまま「解析中」の表示で残る。**
r23 で「出口を1本に畳んだ」が、畳んだのは**出口**であって守れる**窓**ではない。
既存テスト2本が緑なのは、着地を 80ms 以内に起こしているからでしかない。

### [HIGH] 2. エンジンの選択を外した直後の窓で「もう無いプリセットのオプションを変えろ」と案内する

reviewer: robustness（実測）

```
PROBE while shutting down (desiredRuntime=null): failed     ← 選んでいないのに failed
PROBE after shutdown resolved: no-engine
```

r23 で入れた導出は `error` を `desiredRuntime` より**先**に見る。`desiredRuntime` が null に
なってから `phase` が `idle` へ戻るまでは本物の IPC 往復（プロセスの終了）なので、その間
ずっと `ENGINE_FAILED_MESSAGE`＝「設定でエンジンのオプションを変えて保存すると
起こし直せます」を配る。**起動に失敗したプリセットの選択を外す**という、この状況で
いちばん自然な復帰操作の直後に出る。r23 の所見1 と同じ形が逆向きに残っていた。

### [BLOCK] 3. マージで F-38 へ繰り下げた行を、2箇所が F-37 のまま指している

reviewer: oss-hygiene / comment / robustness（3人が独立に）

`app.md` の「差し戻しそのものは F-37」と、`failure-surfacing.md` §4「まだ出口が無いもの」の
一覧。いま F-37 は `main` 側の「AI フォルダの作成」で、**toast が出ている**。

- §4 は「`console.error` だけ／読み手0／何も出ない」を抽出条件にしているのに、
  **出口が在る行**が載っている。同じファイルの §0 は「toast の2件（F-13 / F-37）」と書いており自己矛盾
- **本当に出口が無い F-38（設定の書き込み失敗）が §4 から丸ごと落ちている**

§4 は「次にどの失敗へ出口を作るか」の唯一の索引。**これはこちらがマージで作った腐り。**

### [HIGH] 4. `useResultFlush` の doc 2つが、実装と逆／実装に無い条件を書いている

reviewer: comment

- `dropPending` は反映待ちとタイマーを**両方消す**のに、doc は「触らない」「そのタイマーは
  起きて commit される」と書いている。provider 側の段落（反実仮想）を写したときに主語が縮んだ
- `schedule` の「反映待ちを**持っているなら**張り直す」は、`latestRef` を見ていないので条件が無い。
  「張り直す」も違う——既にタイマーが在れば**何もしない**。同じ PR の `scheduleRestart` は
  同じ語を「張る前に必ず消す」の意味で使っている

### [HIGH] 5. `RESULT_FLUSH_MS` を移したのに、持ち主を指す2つの doc が provider のまま

reviewer: comment / architecture（独立に）

`game-session.md` の `(G0, E13)`（「間引きは受け手側にある」の唯一の出典）と
`state_table_terms.rs` の免除の理由。**綴りは別ファイルに生きているので機械は両方とも緑**
——r21 で入れた検査が止められない形そのもの。

### [HIGH] 6. ※5 の行132 が、断りが `no-engine` に落ちる条件と別のことを言っている

reviewer: comment

「`phase` は `ready` のままなので、`phase` だけで割ると『選んでください』に落ちる」——
`phase` が `ready` のままなら `ready && desiredRuntime` の枝で `starting` になる。
落ちるのは `phase` が `ready` **でなくなった** `idle` の段。同じ注の後段（正しい説明）と矛盾する。

## MEDIUM

7. **`EXEMPT` の新しい検査が、TS の検査名しか知らない**（architecture。実測）。
   `state_table_terms`（Rust の検査名）も `ownedSpelling`（`.test.ts` を持たない検査本体）も
   **緑のまま入る**。`ratchetIndex` が既に両方の母数を持っているのに、写しを作った。
8. **`asyncResultUse` は引数か戻り値に `{` を含む宣言を丸ごと落とす**（architecture。実測）。
   現物には該当0件だが、doc の `{` の説明は「安全側の性質」として書かれていて限界を告げない。
9. **`useResultFlush` と `useEngineSeat` が、同じ要求（effect の依存に載る同一性）に
   別の仕掛けを使っている**（react）。`useMemo` は意味論的保証ではない。
   `seatSlotShape` のラチェットは片方しか見ていない。
10. **実時計の 2.1 秒を `advance(2400)` で跨ぐテストが6本あり、余白は 264ms**（react。実測で1回落ちた）。
    並走する機械では、コードを触っていないコミットがランダムに止まる。
11. **※15 の `ENGINE_FAILED_MESSAGE` / `NO_ENGINE_SELECTED_MESSAGE` に、新しい入口が無い**
    （robustness）。`NOT_READY_REFUSALS` を引く口は3つあり、どれも3値すべてを取りうる。
12. **`docs/**` という走査範囲の写しが5箇所ある**（oss-hygiene）。実際は `scannedDocs()` の範囲で、
    `docs/**` の 56 本のうち 26 本が範囲外。r23 で Rust 側の写しを畳んだ先が、その範囲を誤って書いている。
13. **`EXEMPT` に doc ブロックが2つ並び、規約のほうが宙に浮いている**（comment / oss-hygiene）。
    **r23 の所見11 は「直した」と記録したが、直ったのは前半だけ。**
14. **r23 の「修正の結果」の数値が実測と違う**（oss-hygiene / architecture）。
    `ref 18 → 5` は誤りで、実測 **18 → 16**、`effect` は 10 のまま。
15. **`analysis.md` の「対象」に `useResultFlush.ts` が無い**（architecture）。同じ表の ※3 は引いている。
16. **`entities/engine` の barrel が、このブランチが作った契約の境界になっていない**（architecture）。
    `AnalysisSessionId`（#441 の中心の型）が公開面に無く、スライス間は barrel 5 : 深い import 3。

## 確かめて問題が無かったもの

- **畳んだ後に残るタイマーは0本**（react / robustness が別々に計器で測った）
- **立たないまま終わる ▶ の枝は無い**（robustness が降り口を全部辿った）
- **「埋まっていないセル」の5行は本当に未検証**（robustness）
- **マージで React 側に落ちたものは無い**（react が確認。衝突6ファイルに `.tsx` は無い）
- 依存の方向の違反は0件。`npm audit --omit=dev` は 0 件

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓。**24ラウンド続けて未見。**
- 実プロセスでの検証。誰もしていない。

## 修正計画

順は「振る舞い → マージの腐り → 機械 → doc」。

1. **所見1 → 門を commit する側へ移す。** `useResultFlush` に `canCommit` を渡し、
   `commitLatest` が席を見る。`flushNow` は門の外（`onComplete` が `closeFinished` を先に呼ぶ）。
   **80ms を跨ぐテスト**を足す。所見10 の注入が要るので先に片付ける
2. **所見10 → 上限と刻みを注入できるようにする**（実時計を跨がない）
3. **所見2 → 選んでいるかを先に見る。** テスト1本
4. **所見3 → F-38 への参照を直す**（こちらがマージで作った腐り）
5. **所見4・5・6・15 → doc が指す条件と持ち主**
6. **所見7・8・9・13 → 機械と流儀。** `ratchetIndex` の母数を共有し、`useResultFlush` を
   `useEngineSeat` と同じ形に揃える
7. **所見11・12・14 → 表と記録**
8. **所見16 → barrel**（`sliceBarrels` が3ファイルを offender にするので同じコミットで寄せる）

**壊しうるもの。** 1 は `flushNow` の扱いを間違えると完了通知の最後の1本が消える。
2 はテストの前提を全部触る。16 は3ファイルの import を同時に動かす。

### 次ラウンドの焦点

- 1 の門が、**席を握る前に届いた1本**（応答より早い `info`）を落としていないか
- 2 の注入が、**現物の上限**（2000ms / 100ms）を変えていないか
- 3 の番号が、**§4 の抽出条件**と揃っているか

## 修正の結果

（このラウンドの修正はこれから）
