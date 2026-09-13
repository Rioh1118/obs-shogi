# レビュー 441-unmount-session ラウンド15

- 日付: 2026-09-07
- 範囲: `git diff origin/main...HEAD`（`fix/441-stop-analysis-on-unmount`）
- 走らせた reviewer: react / robustness / comment / oss-hygiene / architecture
- 対象コミット: `60b1a098`
- 前ラウンド: [r13](2026-09-07-441-unmount-session-r13.md) / [r14](2026-09-07-441-unmount-session-r14.md)

## 所見

### [HIGH] 1. ▶ が飛んでいる自動再開の開始を待たないので、■ → ▶ が Rust に断られる

reviewer: react（実測。Rust の相互排除を模した probe）

Rust は席を**取ってから** `go` を待つ（`start_infinite_analysis_impl`）。その往復
（r14 の実測で 457ms、実機の最悪は約5秒）の間に ■ → ▶ と押すと `take_session` に断られる。

```
E: ▶ の結果 error = 解析を開始できませんでした。設定でエンジンのオプションを変えて…
E: thrown = Error: Analysis already running   startCore calls = 3
E: 捨てた席への停止 = [["S2","late-restart"]]   ← 数百 ms 後にはこの席が空く
```

**数百ミリ秒待てば通る回に「エンジンを起こし直せ」と案内する。** 席の欄は空なので、
返却の枠を待つだけでは足りない（席を握っているのは飛んでいる開始の側）。

### [HIGH] 2. r14-1 の `dropPendingResult()` が、いま走っている席の最初の `info` まで落とす

reviewer: robustness（実測・変異で確認）

```
isAnalyzing= true candidates= [] stopCore calls= [["s1","restart"],["s2","late-restart"]]
AssertionError: expected [] to have a length of 1
```

コメントが名乗る前提（「ここで待っているのは捨てる席のものだけ」）が、飛んでいる開始が
2本ある窓で成り立たない。r13-2 が塞いだ症状（空のペインが残る）に別の口から到達する。

### [HIGH] 3. 「席を返せない」の断りが、実際に効く復帰手（▶ の押し直し）を書いていない

reviewer: robustness（実測）

```
after retry: isAnalyzing= true  error= null
stopCore= [["s1","stop"], ["s1","start"], ["s1","start"]]
```

2回目の ▶ が同じ席へ撃ち直して復帰している。にもかかわらず文言は「起こし直せ」で、
不変条件1 / 不変条件3 / F-7 は「▶ をもう一度」と書いている——**台帳の中で矛盾**。

### [BLOCK] 4. `stopAnalysis` の契約が実装と逆（reject するのに「resolve する」）

reviewer: comment / react（独立に、どちらも実装の `try/finally` を指した）

r14-10 で足した契約の2つのうち1つが逆。根拠として挙げた機構（`finally`）は、
**resolve させない**側の機構。この doc を読んで `await stopAnalysis(); await startInfiniteAnalysis();`
と書いた呼び手は、停止が落ちた回に2文目へ到達しない——**その回こそ ▶ が要る**。

### [HIGH] 5. ▶ の契約が、6つある失敗の出口のうち2つと逆・1つ欠け

reviewer: architecture / robustness / comment（3人）

`!isReady` と `!currentSfen` は `set_error` を通らないのに「断りは `state.error` にも載る」。
同期の打ち切りは列挙から漏れ、`failStart` も通っていない。**`!isReady` は ▶ が
`disabled` にしていないので、いちばん踏まれる枝。**

### [HIGH] 6. `shoot` の doc が名乗った事後条件が、2本ある枝の片方で成り立たない

reviewer: comment

`shoot(by, undefined)`（`sweepOnUnmount` の枝）は一致を見ずに欄を空け、`remember` に
渡すのは往復前の古い ID。doc が「巻き添えにできない」と名指した失敗そのもの。

### 7. 完了通知が席を照合していない。エラー通知は上流の英文をそのまま載せる

reviewer: robustness

Rust に `analysis-complete` を足した日に、古い席の1本で走っている解析の表示が
停止中に落ちる。`onError` は r14-4 が落としたはずの形が残っている唯一の口。

## MEDIUM

8. **ログにしか使わない `by` は閉じた型にしたのに、Rust が他人の席を殺すかどうかを
   決める `sessionId` は素の `string`**（architecture）。SFEN と同じスコープに同じ型で
   並ぶので、取り違えても tsc は何も言わない。**取り違えた回の結末は #441 の症状そのもの。**
9. **同じ概念に `currentPosition` / `position` / `sfen` の3つの名前**（comment）。
   `// SFEN` の行末注釈が要っていること自体が、名前が概念を運べていない証拠。
10. **待ちの刻み `16` が名前も理由も持たないまま2箇所にある**（comment）。
11. **▶ の頭に新設した doc が、本体のコメントを逐語で写している**（comment）。
12. **▶ と自動再開が同じ5段を別々に書き下ろしている**（comment）。
    r12 以降の修正がどれも「片方だけ直った」形で入った原因。
13. **スライス唯一の公開部品 `AnalysisProvider` が裸**（comment）。
    「畳まれない位置に置くこと」は呼び手が守る前提なのに、どこにも書いていない。
14. **`entities` の型の doc が widget の private な `useRef` を契約として書いている**（architecture）。
15. **※1 と不変条件1 が「▶ の返却が落ちた回は `console.error` だけ・S0」と書いている**（oss-hygiene）。
    この PR が `set_error` を足したので **S6**。同じファイルの ※4 / ※15 と正反対。
16. **▶ から踏める `(S6/P0, E5)` と `(S0/P1, E11)` / `(S6/P1, E11)` が `—` のまま**（oss-hygiene）。
17. **5つ目の断り（自動再開の失敗）が ※15 にも F-2 にも無い**（oss-hygiene）。
    しかも F-2 は「▶ で直りうるのは上限切れだけ」と書いている。
18. **`CONTRIBUTING.md` のラチェットの行が、2本ある検査の片方しか説明していない**（oss-hygiene）。
19. **`AGENTS.md` が `vp check` / `vp test` を検証として案内している**（oss-hygiene）。
    それだけでは `test:hooks` も Rust 側も走らない。
20. **ADR-0004 の「`clearError` は6スライスすべて」が現物と違う**（comment）。実測4。

## 重複・矛盾した所見

- 所見4 は comment（BLOCK）と react（MEDIUM）が独立に同じ行を指した。
- 所見5 は3人が別の入口（契約の列挙・実測・doc の数え上げ）から同じ結論に達した。
- 所見1 と所見2 は**同じ窓の別の側面**。1 を直すと 2 の再現手順は組めなくなるが、
  2 の門（席を握っていたら落とさない）はフックの不変条件として独立に要る。
- 矛盾は無し。

## 見ていない範囲

- `analyzer.rs` / `protocol.rs` の内部と #463 の窓の幅。**15ラウンド続けて未見。**
- 実プロセス（本物の USI エンジン）を使った検証は誰もしていない。
- `RESTART_FAILED_MESSAGE` の枝はテストが1本も無い（r15 時点。この修正で足した）。

## 修正計画

1. **所見1・2 → ▶ が飛んでいる開始を待つ／落とすのは席を握っていないときだけ。** テスト1本
2. **所見3・5・7 → 断りの向きと枝を揃える。** 前置きの2つの門にも断りを立て、打ち切りも
   `failStart` に通し、完了通知に席の照合を足す
3. **所見4 → 契約を実装に合わせ、settle の向きをテストで固定する**
4. **所見6・11・13・14 → doc**
5. **所見8 → 席の識別子に brand を付け、鋳造をラチェットで固定する**
6. **所見9・10 → 名前**
7. **所見12 → 開始の後半を `beginSession` に寄せる**
8. **所見15〜20 → doc / 索引 / `AGENTS.md`**

### 次ラウンドの焦点

- 1 の待ち合わせが、**畳まれた回に飛んでいる開始をぶら下げたまま**にしていないか
- 5 の brand が、`api/events` の受け口で**素通り**していないか
- 7 の `beginSession` が、**手動だけに要る後始末**（`desiredSfenRef`）を落としていないか
- 2 で足した断り（前置きの門）が、**押せないボタンの説明**になっていないか

## 修正の結果

| 所見            | 結果                                              | コミット                            |
| --------------- | ------------------------------------------------- | ----------------------------------- |
| 1〜7            | 直した。断りを全枝で立て、向きを揃えた            | `add45cbe`（テスト3本、変異で確認） |
| 8               | 直した。`AnalysisSessionId` の brand とラチェット | `14860982`（変異で確認）            |
| 9〜11 / 13 / 14 | 直した                                            | `ca0e5602`                          |
| 15〜20          | 直した。表・台帳・索引・`AGENTS.md`               | `5d62981d`                          |
| 12              | 直した。開始の後半を `beginSession` に寄せた      | `b05f63ba`                          |
