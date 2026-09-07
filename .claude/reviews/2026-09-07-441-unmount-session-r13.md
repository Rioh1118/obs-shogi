# レビュー 441-unmount-session ラウンド13

- 日付: 2026-09-07
- 範囲: `git diff origin/main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / oss-hygiene / architecture
- 対象コミット: `512920c2`
- 前ラウンド: [r11](2026-09-07-441-unmount-session-r11.md) / [r12](2026-09-07-441-unmount-session-r12.md)

## 所見

### 1. 局面の送信そのものが落ちた回に、断りが立たない

reviewer: robustness（実測）

`syncPosition` は `set_position` の失敗を呼び手へ投げる（自動追従の口は飲むので投げ先は ▶ だけ）。
▶ はそれを捕まえずに抜けるので `error` は null のまま、`console.error` で終わる。

```
D: analyzing= false error= null candidates= [] startCore calls= 0 thrown= Error: Failed to set position: … elapsed(ms)= 2
D: 2nd press thrown= … startCore calls= 0
```

**画面は停止中のまま1ドットも変わらず、押し直しても同じところで落ちる。**
打ち切りの回は少なくとも `state.error` に載るので #277 が出口を作れば出るが、
この枝は載らないので**出口ができても永久に出ない**。

### 2. 席が欄に入る前に届いた最初の `info` が捨てられ、空のペインが残る

reviewer: react（実測）

`flushLatest` は `isAnalyzing` を見る。間引きのタイマーが `start_analysis` の commit より
先に起きると黙って落ち、タイマーの欄も空に戻るので張り直す者が居ない。

```
1) 最初の info だけの時点: []
2) 2本目の info の後: [{"rank":1,…}]
```

r12-1 で古い候補手を消したぶん、いまは**「解析中」の表示のまま最善手も候補手も
空のペイン**が次の `info` まで残る（深い局面ほど長い）。

### 3. `discard` が枠を差し替えるので、後ろに並んだ返却が飛んでいる席へ2本目を撃つ

reviewer: react（実測）

```
shots after B resolves: [ ['no-position','S1'], ['late-restart','S2'], ['no-position','S1'] ]
S1 に撃った停止の本数（1本目がまだ飛んでいる）: 2
```

**いまの provider からこの順序は組めない**（開始する口はどちらも先に `releaseHeld` を
通り、そこで枠を待ち切る）。壊れているのは**フックが自分で名乗っている不変条件**で、
`discard` の呼び手が1つ増えた時点で本物になる。

### 4. `"ignored" | "gone"` の区別に読み手が居ない。しかも門が名指す危険はその条件では捕まらない

reviewer: robustness（変異で確認）/ comment（別の入口から同じ食い違い）

- `pastRef.current.get(sessionId) !== "gone"` を `true` に変異 → **41 passed**
- `remember(_, "gone")` を全部 `"ignored"` に変異 → **40 passed**

`send` に渡る識別子は握っている席か `discard` の新しい UUID だけなので、
**返し終えた席で停止が落ちる経路が無い**。一方、門が防ごうとしている
「Rust にもう無い席を握る」は**実際に起きる**——`stop_session` は席を消してから
エンジンを止めるので、エンジン側の失敗は「席は空・`Err`」で返り、門を素通りする。
**門が名指す危険は門の条件では捕まらず、捕まる場合は起きない。** r11-4 → r12-3 に続く3回目。

### 5. フックの本体は毎描画走るのに、返す口は初回のクロージャで凍る

reviewer: react（実測: `body runs: 6` / 返る API は同一）

`remember` / `send` / `occupy` / `queueBehind` / `shootQuietly` と `new Map()` は毎描画
作られ、初回のもの以外は誰にも届かない。**危ないのは無駄より次の一手**——
描画ごとに変わる値をここで読んだ人は、初回の値を永久に読み続ける。tsc も lint も止めない。

### 6. `hold` の doc が、直前の文で自分が否定した経路を理由にしている

reviewer: comment

「消す相手が居ない」と「消すと採らない席が外れる」は同時に成り立たない。

### 7. `matches` の順序の理由が、interface の doc と実装に二重にある

reviewer: comment

`discard` / `sweepOnUnmount` も同じ形。片方だけ直すと食い違う——`matches` の順序は
まさにその形で1ラウンド分の退行誘導になった。

### 8. コメントにレビューの回次が残っている

reviewer: comment

`occupy` の「実際に r9 と r10 で2回踏んだ」、ラチェットの「手書きしていた頃」。
`CONTRIBUTING.md` が禁じている経緯そのもの。

## MEDIUM

9. **barrel が公開している4つの型のうち、外に呼び手が居るのは1つだけ**（architecture）。
   規約を書いた3行下に反例が3つ。
10. **`discardShownResults` の粒度がずれている**（architecture）。反映待ちの下書き
    （`latestResultRef` と間引きのタイマー）だけを捨てたい口が helper を使えず、手で2行書いている。
11. **F-7 の復帰導線が、同じ PR が `analysis-pane.md` から捨てた誤りを残している**（oss-hygiene）。
    `engine.md` の ※5 と不変条件3 も同じ。**表 → 台帳 → 仕様の3段のうち、一番下だけが正しい。**
12. **新設した凡例（bare な `stop_analysis` は IPC）に ※9 が従っていない**（oss-hygiene）。
13. **`app.md` の「`error` を立てない口が2つある」が A4 / A5 からしか辿れない**（oss-hygiene）。
    根のリネームは A2 / A3 でも踏める。
14. **`IDEAS.md` へ持ち越した PR テンプレートの所見が、書いた時点で既に直っている**（oss-hygiene）。
    #446 が括弧書きを落としている。
15. **`pickTopCandidate` に TSDoc が無く、context の型の案内が唯一の呼び手と違う**（comment）。
    停止中はペインのキャッシュを、しかも向きを直した後で渡している。
16. **装置表に足した棚卸しカタログが、追随の義務を宣言した当日に古い**（oss-hygiene）。
    ADR-0009 前のモジュール名のまま。
17. **`docs/spec/screens/` の「対象」3件が実在しないパスを指している**（oss-hygiene）。
    パス実在の検査は `state-transitions/` にしか掛かっていない。
18. **`IDEAS.md` の deep import の数（11）が、どの grep でも再現できない**（architecture）。
    実測は本物の import が10（`aiLibrary` 6 / `tauri` 3 / `events` 1）。
    `api/tauri` だけを載せるなら書き換えは3ファイル（範囲外1）。
19. **`by` の理由が Rust 2箇所と TS 1箇所に逐語で写っている**（comment）。
20. **`architecture-reviewer` が実在しない `buildTesuuPointer` を名指ししている**（architecture）。
    13ラウンド空振りしていた。

## 重複・矛盾した所見

- 所見1 と2 は別の reviewer が別の経路で「▶ の直後に何も出ない」を指した（原因は別）。
- 所見4 は robustness（変異）と comment（Rust の `Err` の起き方）が同じ食い違いへ到達した。
- 矛盾は無し。

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓の幅。**13ラウンド続けて未見。**
- `features/engine-position-sync` の実装本体。
- 実プロセス（本物の USI エンジン）を使った検証は誰もしていない。
- README のスクリーンショット（`docs/IDEAS.md` が持ち越し済み）。

## 修正計画

1. **所見1・2 → 開始まわりで黙って消える2つを塞ぐ。** テスト2本、変異で確認
2. **所見3 → `discard` が枠に載せるものを「前の返却とこの停止の両方」にする。**
   口を直に並べるテストを別ファイルへ（provider からは組めない順序なので）
3. **所見4・5・6・7・8 → フックを整理する。** 表を `Set` に落とし、早期 return を
   `useRef` の直後へ上げ、ラチェットに「凍る前に置くのは `useRef` だけ」を足す
4. **所見9・10・15 → 公開面と後始末の粒度**
5. **所見11〜14・16〜20 → doc とハーネス。** 復帰導線の出所を `engine.md` の ※5 に一本化し、
   `docsSourcePaths` の走査に `spec/screens/` を足す

### 次ラウンドの焦点

- 1 の `set_error` が、**要らなくなった要求の失敗まで画面に出していない**か
- 2 の `scheduleFlush()` が、停止した直後に**捨てたはずの結果を出し直して**いないか
- 3 の `Promise.allSettled` が、**枠を空けるのを遅らせて**次の開始を待たせていないか
- 5 で足した「`spec/screens/` のパス実在」が、予告を書くファイルに当たっていないか

## 修正の結果

| 所見            | 結果                                                                                                                 | コミット                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1 / 2           | 直した。送信の例外に断りを立て、開始した行で間引きを張り直す                                                         | `3d683447`（テスト2本、変異で確認） |
| 3               | 直した。枠に載せるものを「前の返却とこの停止の両方」にした                                                           | `f84b1e60`（テスト1本、変異で確認） |
| 4〜8            | 直した。`Set` に落とし、早期 return を上げ、ラチェットに1本足した                                                    | `f97951d6`（変異で確認）            |
| 9 / 10 / 15     | 直した                                                                                                               | `28d53654`                          |
| 11〜14 / 17〜20 | 直した。`docsSourcePaths` に `spec/screens/` を足し、実在しないパスで落ちることを確認した                            | `e97bc5a1`                          |
| 16              | **この時点では直っていなかった**（`OPERATING-MODEL.md` の行は1バイトも変わっていない）。r14 で指摘され、そこで直した | r14 の docs コミット                |
