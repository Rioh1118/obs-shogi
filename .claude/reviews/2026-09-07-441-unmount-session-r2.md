# レビュー 441-unmount-session ラウンド2

- 日付: 2026-09-07
- 範囲: `git diff main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / rust / oss-hygiene
- 対象コミット: `4ec41372`
- 前ラウンド: [`2026-09-07-441-unmount-session-r1.md`](2026-09-07-441-unmount-session-r1.md)

## 所見

### [HIGH] 1. 手動開始の門が世代を見ない。▶ の直後に ■ を押すと、停止が握り潰されて解析が始まる

reviewer: oss-hygiene（実測）

r1-2 は再開側だけを直した。`startInfiniteAnalysis`（`provider.tsx`）の門は `unmountedRef` しか見ない。
▶ から `syncPosition` + `waitUntil`（最大2秒）を挟むので窓は広い。実測:

```
手動開始 → 応答待ちのまま stopAnalysis() → 応答を解決
{ isAnalyzing: true, sessionId: "session-late", stops: [] }
```

**しかも ※13 は「E2 で同じ窓に入る経路も同じ行で塞いである」と書いている。**
doc が塞いだと書いた穴は、次のレビューで誰も見ない。

### [HIGH] 2. 「停止が失敗したら席が残る」が Rust の順序と逆

reviewer: robustness / oss-hygiene

`stop_session` も `stop_all_sessions` も**先に台帳から消してから** `analyzer.stop_analysis()` を撃つ
（`bridge.rs`）。エンジン側の失敗では**席は既に空**。席が本当に残るのは
「他人の席だった回（`unknown analysis session`）」と「invoke that届かなかった回」だけ。

`seatRef` の doc・※12・F-7 はどれも「停止が落ちた＝席が残る」を前提にしている。
握り続ける振る舞い自体は IPC が届かなかった回のために正しいが、**理由が違う。**

### [HIGH] 3. `analysis-complete` / `engine-error` を Rust は一度も emit しない

reviewer: react / robustness / comment / oss-hygiene（4人が独立に）

`src-tauri/src` の `emit` は `analysis-update` の1本だけ（確認済み）。したがって

- `onComplete` に足した席の解放は**本番で1度も走らない**
- ※12 の「完了通知の ID が一致しなかった回」と不変条件5 の「※6 では破れる」は、
  **起こり得ない事象を根拠にしている**
- 表の E8 / E9 は `→ S0` `→ S6` と書いてあるので、この穴が塞がっているように読める
- E9 の発生源の綴り（`analysis-error`）も現物（`engine-error`）と違う

### [HIGH] 4. 「一括停止と `take_session` の順序が競合する」は、その窓では成立しない

reviewer: comment

`releaseSeat` は成功時に `seatRef` を null にするので、開始の応答待ちの間 `seatRef` は空。
そこで畳まれても `releaseSeatOnUnmount` は門で止まり、**一括停止は撃たれない**。
`provider.tsx` の2箇所と ※13 の前段が、この窓では起きない競合を理由にしている。
**同じ注の中で前段と後段が反対の前提に立っている**（r1-4 の再発）。

## MEDIUM

5. **席の欄への代入が門の前にある**（react、実測）。`seatRef.current = newSessionId` を
   門より先に書くので、打ち切られた開始が**生きている席の欄を奪って**その後 null にする。
   ■ → ▶ と続けた回で、走っている席を誰も返せなくなる。
   いまこれを防いでいるのは Rust の `take_session` であってフロントではない。
6. **同期待ちの打ち切りが、席を握っていないときに一括停止へ化ける**（robustness）。
   `releaseSeatQuietly(seatRef.current ?? undefined)`。`releaseSeatOnUnmount` は
   同じ状況で撃たない。r1-7 で揃えたはずの判断から外れている唯一の口。
7. **世代の門を成功側だけに足し、`catch` には足していない**（react、実測）。
   打ち切った後に開始が失敗すると `set_error` が残る。
8. **`onUpdate` の照合だけが遅れる写し（`sessionIdRef`）を見ている**（react）。
   `seatRef` を「権威」と書いた当のファイルで、いちばん早い `info` を落とす窓が残っている。
9. **`console.warn` が呼び出し口を名乗らない**（robustness）。4つの口で同じ文面が出て、
   `undefined` が「一括停止」と「席を握っていない空撃ち」の両方を意味する。
   復帰の助言（エンジン再起動が要るか）が枝で違うのに、証拠が同じ形で出る。
10. **※9 が `.catch(() => {})` を指しているが、その書き方はもう無い**（comment）。
11. **`releaseSeat` のコメント「既に居なくても `Ok`」が無条件に読め、同じ PR の TSDoc と食い違う**（comment）。
12. **再開の本体（`runRestartRef`）だけ頭のコメントが無く、本文に4ブロック13行**（comment）。
13. **テストのコメントが条件形でなく、直下の assert と反対に読める**（comment）。
14. **`analysis-pane.md` の「解析の停止が失敗 → `state.error` に積まれる」が嘘**（robustness / oss）。
    `stopAnalysis` に `catch` は無く、reject は `AnalysisPaneHeader` の `console.error` で終わる。
15. **同ファイルの #356 の記述が古い**（robustness / oss）。`AnalysisUpdate` は `rename_all = "camelCase"`
    が当たっている。生きているのは「完了・エラーの発火元が無い」の方（所見3）。
16. **F-7 の「次に畳まれたときに返し直す」が後始末側では成り立たない**（comment / oss）。
    畳まれた回に次の cleanup は無い。効くのは `stopAnalysis` 側だけ。
17. **F-7 の追記に `（測定日 / ブランチ）` が無い**（oss）。同ファイル冒頭の規則。
18. **`S0/P1 × E7` が `—`**（oss）。席が在る間は `analysis-update` が届く行なので、
    `S0/P0` と同じ「捨てる※3」が正しい。凡例の `—`（その状態には来ない）と矛盾する。
19. **「埋まっていないセル」から `(S4/S5, E2)` を丸ごと落としたが、テストが踏んでいるのは S4 だけ**（oss）。
    `pendingAfterRef` を立てた状態（S5）で停止を押すテストは無い。
20. **指さない停止は `take_session` の相互排除を素通りする**（rust）。
    畳んだ瞬間に開始が飛んでいると、`clear()` が新しい席を消した直後に `go infinite` が線に出て、
    **席は空・エンジンは探索中**になる。いま収束しているのはフロントが2本目の停止を撃つからで、
    **Rust 側にはその契約が書かれていない**。
21. **`analyzer.rs` の `if let Some(id) = self.infinite_listener.lock().await.take()` が
    ガードを握ったまま `await`**（rust）。いまデッドロックの環は無いが、
    `listeners` を握る側が `infinite_listener` を触ると環になる。clippy の
    `significant_drop_in_scrutinee`（nursery）で拾える。
22. **新テストが通る理由が `bridge()` の doc の名乗りと違う**（rust）。
    `analyzer.stop_analysis()` まで入っていて、`NotInitialized` が `Ok` に落ちるから緑。
23. **`stop_analysis_impl(Some(..))` を通るテストが0本**（rust）。
    `stop_analysis_impl` を「常に `stop_all_sessions` へ落とす」に書き換えても全部緑のまま。
24. **`stop_analysis_impl` の `///` が「`Err` なら席は残る」しか書いていない**（rust）。
    省いた側は席を空けてから止めるので、`Err` の意味が枝で正反対。
25. **`stop_all_sessions` のログに「何席空けたか」が無い**（rust）。
    この経路の呼び手は畳まれた画面で、`console.warn` すら利用者に出せない。
    Rust のログにしか残せないのに、そこにも出ていない。

## 重複・矛盾した所見

- 所見3 は4人が独立に到達した。**修正の向きも一致**（doc に「発火元が無い」を書く／
  コードの分岐にその旨を注記する）。
- 所見2 と所見16・24 は同じ根（Rust の「消してから止める」順序を、TS 側の doc が
  読み違えている）。まとめて直す。
- 矛盾は無し。react の所見1（欄の代入位置）と comment の所見4（コメントの理由）は
  同じ行を別の側から見ている。

## 見ていない範囲

- `npm run verify:rust` 全体（fmt / clippy）は誰も走らせていない。
  `cargo test --lib engine::bridge::tests` は 6/6 green。
- `protocol.rs` の内部（`run_writer` / `ensure_ready` / 積み置き）。所見20 の窓の**幅**は未見積もり。
- `features/engine-position-sync`（`syncPosition` が畳まれた後に何をするか）。
- 実プロセスを使った検証は誰もしていない。所見20 の「エンジンが探索を続ける」は
  ソースの読みから導いたもの。
- #420 由来のファイルは範囲外。

## lint / hook で強制できるもの

- **doc が名乗るイベント名が Rust の `emit` に実在するか**の走査（所見3）。
  `state_transition_cells.rs` と同じ形で書ける。今は片側だけ消しても両方の `verify` が green。
- **`failure-surfacing.md` の触った行に `（測定日 / ブランチ）` があるか**（所見17）。
  `verify-gate.sh` が既に docs を verify 側へ流しているので置き場はある。
- clippy `significant_drop_in_scrutinee`（所見21）。
- 所見1・2・4〜16・18〜20・22〜25 は機械では止まらない。

## 修正計画

### 束ね方と順

所見2・16・24 は同じ根（Rust の順序の読み違え）。所見3 は doc とコードの4箇所に散っているが1つの事実。
所見1・5・7 は**振る舞いの穴**なので先に直す（doc はその後でないと書けない）。

1. **所見1 → 手動開始にも世代の門。** ※13 が「塞いである」と書いてしまっている以上、
   doc を弱めるのではなく塞ぐ。テストを1本足す
2. **所見5 → 席の欄への代入を門の後ろへ移す**（再開・手動開始の2箇所）
3. **所見7 → `catch` の先頭にも同じ門**
4. **所見6 → 打ち切りは握っているときだけ撃つ**
5. **所見8 → `onUpdate` の照合を `seatRef` にし、`sessionIdRef` を落とす**
6. **所見9 → `console.warn` に呼び出し口の識別子を足す**
7. **所見25 → `stop_all_sessions` が空けた席をログに出す**
8. **所見23 → `stop_analysis_impl(Some(..))` のテストを1本**
9. **所見22・24 → `bridge()` と `///` の doc を、通る理由・`Err` の意味に合わせる**
10. **所見2・4・11・12・13 → コメントを実装に合わせる**
11. **所見3・10・14〜19 → doc。** 発火元の無いイベント、※9、`S0/P1 × E7`、
    `(S5, E2)`、F-7 の限定と測定日、`analysis-pane.md` の2行
12. **所見20・21 → issue。** どちらも Rust の設計に踏み込む（世代を持たせる／
    ロックの取り方を変える）ので、この PR の範囲外

### 次ラウンドの焦点

- 所見1・5・7 の門が**4箇所で同じ形**になっているか（`unmountedRef` と世代の両方を見ているか）
- 席の欄に非 null を書く行が、**全部門の後ろ**にあるか
- 所見3 の直し方が、`onComplete` / `onError` を「消す」ではなく「注記する」で
  止まっているか。消すと Rust に emit を足したときに戻す作業が増える
- doc の記述が、直した後のコードとまた食い違っていないか（r1-4 → r2-4 と2回続けて同じ形）

## 修正の結果

| 所見                 | 結果                                                                           | コミット / 送り先                               |
| -------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------- |
| 1 / 5 / 7            | 直した。手動開始にも世代の門、席の欄への代入を門の後ろへ、`catch` にも門       | `3c154885`（テスト1本追加、変異で確認）         |
| 2 / 4 / 11 / 12 / 13 | 直した。コメントを Rust の順序に合わせ、再開の本体に頭のコメント               | `5ce97e72`                                      |
| 3 / 10 / 14〜19      | 直した。E8 / E9 を「飛ばない」と書き、不変条件5 の破れ口を差し替え             | `b47ede9b`                                      |
| 6                    | 直した。打ち切りは席を握っているときだけ撃つ                                   | `e82570c8`                                      |
| 8                    | 直した。照合を席の欄に。`sessionIdRef` を畳んだ                                | `95337f3a`（テスト1本追加、変異で確認）         |
| 9                    | 直した。`console.warn` に呼び出し口の識別子                                    | `dc5ae557`                                      |
| 20                   | **issue #463** へ。Rust に世代を持たせるか、契約として明文化するかの判断が要る | `126b5da1` で `///` に前提を書き、#463 へ繋いだ |
| 21                   | `docs/IDEAS.md` へ1行。症状が無く、6週間以内に着手しない                       | `ad2f8a9c` 相当（docs コミット）                |
| 22 / 23              | 直した。公開の口を通した停止のテストを1本、フィクスチャの doc を実態に         | `b8d1c612`（変異で確認）                        |
| 24                   | 直した。`Err` の意味を枝ごとに書いた                                           | `126b5da1`                                      |
| 25                   | 直した。空けた席の件数と ID をログに出す                                       | `ac21e5bb`                                      |
