# レビュー 441-unmount-session ラウンド12

- 日付: 2026-09-07
- 範囲: `git diff origin/main...HEAD`（`fix/441-stop-analysis-on-unmount`。`origin/main` を #487 まで取り込んだ後）
- 走らせた reviewer: react / robustness / comment / oss-hygiene / architecture
- 対象コミット: `77858d25`
- 前ラウンド: [r10](2026-09-07-441-unmount-session-r10.md) / [r11](2026-09-07-441-unmount-session-r11.md)

## 所見

### [HIGH] 1. ▶ で始め直すと、前の局面の候補手がそのまま新しい局面の結果として出る

reviewer: react / robustness（独立に、どちらも `state` を観測して実測）

自動再開は `go` の前に画面の候補手を捨てているが、手動の ▶ は捨てていない。
`start_analysis` は `currentPosition` だけを差し替える（`reducer.ts`）ので、
**■ → 盤を動かす → ▶** で次の組が1コミット確定する。

```
4) right after ▶ at P5: analyzing = true currentPosition = P5
   candidates = [{"rank":1,"pv_line":["7g7f"],"evaluation":{"type":"cp","value":123}}]  ← P1 のもの
```

`AnalysisPane` は `isAnalyzing` の間 `state.candidates` をそのまま描き、読み筋の基準を
`state.currentPosition`（= P5）に取るので、**P1 の評価値が P5 の評価値として出て、
P1 の読み筋が P5 の盤に当てて変換される**。さらにキャッシュの書き込み条件
（`state.currentPosition === currentSfen`）も満たすので、**P1 の候補手が P5 の鍵で
焼き付く**——停止中に戻るたび出続ける。棋譜を閉じて別の棋譜を開いた回も同じ
（`P5 after reopen ▶: candidates 1 pos Q1`）。

`main` から在るが、この PR は不変条件4 を doc に立て、`clearResults` を context から
外している。**席の照合が塞いだ穴が、別の口で開いたまま。**

### [BLOCK] 2. `matches` の公開 doc「握っているときは厳密一致」が、実装ともテストとも逆

reviewer: comment

r11-2 で「手放した席を先に見る」に変えた後も、doc は前の順序のままだった。
`provider.test.tsx` の「捨てた席を握り直しても、その席の info は採らない」が
**握っている席の `info` を落とすこと**を固定しているので、doc だけを読んだ人は
r11-2 が直した順序に戻す。**公開面の doc が、直したばかりの退行への誘導になっている。**

### [HIGH] 3. `hold` の `delete` 2行は、コメントが名指しする経路からは到達しない

reviewer: comment / react

「捨ててから握り直す枝」は `send` の catch で、そこは欄へ直接書いて `hold` を通らない。
席の識別子は Rust が UUID で振る（`bridge.rs` の `new_session_id`）ので、`hold` に渡る ID が
過去に集合へ入っていることも起きない。**書いてある理由では走らず、走る理由も無い。**
危ないのは次の一手で、握り直しを `hold` に寄せた人がこの `delete` を働かせると、
r11-2 がそのまま戻る。

### [HIGH] 4. `sweepOnUnmount` の「→ #463。だから後ろに並ぶ」が、並ぶ機構では塞げない窓を理由にしている

reviewer: comment

枠（`releasingRef`）に載るのは停止だけで、飛んでいる開始は `startInFlightRef`（provider 側）。
開始を待っている間は `releaseHeld("start")` が枠を空けているので、#463 の窓では**並ばない**。
実際に塞いでいるのは「席の欄が空なら撃たない」門と、後から返った席を返す `discard`。
いまのコメントを信じると、その門を「席が無いなら撃つ必要が無いだけ」と読んで消せる。

### 5. 枠を取る手順が4つの口に手書きで複製されている

reviewer: architecture / comment（独立に、同じ抽出を提案）

新設のラチェット自身がその症状を書いている——「6箇所を1つずつ変異させて落ちるのは1箇所」。
**同じ不変条件を6回手書きしているせいで、5回ぶんが振る舞いで守れない。**
r9-2 → r10-2 で同じ形を2回踏んでいる。

### 6. `by` が省略可能で、集合が閉じていない。8つの値も4つの口へ排他に分かれているのに型が1本

reviewer: comment / architecture

省くと Rust のログに union に無い `"unnamed"` が出る（`bridge.rs`）。
`releaseHeldQuietly("unmount")` も `discard("stop", id)` も tsc を通るが、取り違えても
Rust は止まるので**壊れるのはログだけ**——#441 の再発を追う人が読む唯一の手掛かり。

### 7. 「採らない席」と「Rust がもう持っていない席」が別々の集合で、上限が片方にしか無い

reviewer: react / robustness / comment（3人）

3経路とも両方に同時に足しているので育つ速さは同じ。33件目から2つの記録が同じ席について
食い違い、`returnedRef` の側は消える口が無いまま育ち続ける（`AnalysisProvider` は
`RuntimeProviders` 側に居るので普通は畳まれない）。`send` の catch の括弧書きは
「空ける口」と書いて**入れる**2口を挙げていた。

## MEDIUM

8. **`IGNORED_LIMIT = 32` の根拠が、数えている単位と違う**（comment）。
   数えるのは `info` ではなく席。
9. **局面が無くなった effect の「2回走る」に条件が無い**（comment）。
   停止が届かないまま停止中になっていた回は1回で終わる。
10. **`app.md` の `(A2〜A5, E2)` が「`/` に戻す」一律**（oss-hygiene）。
    `setRootDir` / `chooseAiRoot` は**意図して** `error` を立てない。
11. **E2 を「読み書き」へ広げたのに、`failure-surfacing.md` に受け皿の行が無い**（oss-hygiene）。
    F-1 は読み込みに閉じている。
12. **`(S6/P0, E7)` だけ `—`**（oss-hygiene）。r11-16 の直しが半分で終わっていた。
13. **`(S4/P1, E10)` の「+ `stop_analysis`」が現物と合わない**（robustness。実測で invoke 0本）。
14. **`analysis-pane.md` の復帰導線が実装と違う**（robustness）。`restart` は `runtimeConfig` の
    変化で走るので、プリセットが1つでもオプションを変えれば席は空く。**復帰手段があるのに
    案内が行き止まりを指している。**
15. **`OPERATING-MODEL.md` の装置表に `docs/spec/` とルートの2つの仕様書が無い**（oss-hygiene）。
16. **`entities/analysis` の barrel が `sortByRank` を公開しているが、外に呼び手が0**（architecture）。
    同じ PR が「載せるのは外に呼び手が居るものだけ」を型の doc に書いている。
17. **`entities/engine` の barrel が `api/tauri` を公開しないまま、この PR が
    跨ぐ symbol を1つ増やした**（architecture）。(a) barrel に載せる／(b) `string` に戻す、の選択を求めている。

## 重複・矛盾した所見

- 所見1 は react と robustness が独立に、別の probe で同じ再現に到達した。直し方も一致。
- 所見5 は architecture と comment が別の入口（構造／コメントの重複）から同じ抽出を提案した。
- 所見7 は3人が独立に指した。
- 矛盾は無し。

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓の幅。**12ラウンド続けて未見。**
- `features/engine-position-sync` の実装本体。
- 実プロセス（本物の USI エンジン）を使った検証は誰もしていない。
- README のスクリーンショットと現物の一致（`docs/IDEAS.md` が持ち越し済み）。

## 修正計画

1. **所見1 → 捨てる手順を1つに寄せる**（`discardShownResults`）。開始する2つの口が同じものを通る。
   テスト1本、変異で確認。**壊しうるもの**: 置く位置を `startInfiniteAnalysisCore()` の後ろに
   すると、席が欄に入る前に届く `info` を落とす（既存テストが赤くなる）
2. **所見7・3・2・8 → 記録を1つの表に畳む**（`Map<string, "ignored" | "gone">`）。
   上限が1箇所で決まり、`hold` の `delete` は消える。`matches` の doc も実装の順序に直す
3. **所見5・4 → `occupy` / `queueBehind` を切り出す。** ラチェットを
   「無条件に空けていないか」から「`occupy` の外から書いていないか」に強める
4. **所見6 → `by` を必須にし、口ごとの部分集合に割る**
5. **所見16 → barrel から落とす**
6. **所見10〜15 → doc**
7. **所見17 → 直さない**（下記）

### 次ラウンドの焦点

- 1 の `discardShownResults` が、**採るべき最初の `info` を落とす**筋を作っていないか
- 2 で畳んだ表の `"gone"` が、上限に押し出された後に**握り直してはいけない席を握らせ**ないか
- 3 の `queueBehind` が、並んだ側の席の読み直しで**返すべき席を取り違え**ないか
- doc の直しが、また別のセルと矛盾していないか（**12ラウンド続けて出ている**）

## 修正の結果

| 所見          | 結果                                                                          | コミット                            |
| ------------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| 1             | 直した。`discardShownResults` に寄せ、開始する2つの口が通る形にした           | `947c64f2`（テスト1本、変異で確認） |
| 2 / 3 / 7 / 8 | 直した。`Map<string, "ignored" \| "gone">` に畳み、上限を1箇所にした          | `a062247b`（変異で既存2本が落ちる） |
| 4 / 5         | 直した。`occupy` / `queueBehind` に寄せ、ラチェットを構造で見る形に強めた     | `9061c7c4`（変異で確認）            |
| 6             | 直した。`by` を必須にし、`Blocking` / `Quiet` / `Discard` の3つに割った       | `825856e9`                          |
| 16            | 直した。`sortByRank` を barrel から落とし、規約を barrel 側に移した           | `7c4f8ae8`                          |
| 10〜14 / 15   | 直した。台帳に1行を新設し（**`main` の取り込みで F-38 へ番号がずれた**。F-37 は #404 の側）、表の2セルと凡例、`analysis-pane.md` の復帰導線を直した | `5f6acd86`                          |
| 9             | 直した                                                                        | `d3310219`                          |
| 17            | **直さない。** 理由は下記                                                     | —                                   |

### 所見17 を直さない理由

`@/entities/engine/api/*` を barrel を通さずに読んでいるのは、**この PR より前から
11箇所**（`aiLibrary` が6、`tauri` が3、`events` が2。うち8箇所は `main` から在り、
`features/settings` と `features/engine-position-sync` が持つ）。
`entities/engine` の `api/` を深く読むのはリポジトリの既存の作法で、この PR が
作ったものではない。

reviewer の (a)（barrel に載せる）を採ると、`sliceBarrels` が既存の3ファイルを
違反として落とすので、`features/engine-position-sync` を含む**範囲外のスライスを
同じ PR で書き換える**ことになる。(b)（`string` に戻す）は、r11 で2人の reviewer が
「値が閉じていることがこの引数の唯一の価値」と指した所見を戻す。

**どちらも #441 の範囲を超える。** 作法をどちらかに寄せる判断は
`entities/engine` の公開面をまとめて決める作業に属するので、`docs/IDEAS.md` へ送る。
