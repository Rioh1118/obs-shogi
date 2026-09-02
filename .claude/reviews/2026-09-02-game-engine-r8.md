# 対局エンジン レビュー ラウンド8

対象: `worktree-wt-game-engine`（`8e5643f..3f04df1` の r7 の4コミットを焦点に）
観点: rust / robustness / comment の3本を並列
日付: 2026-09-02

## 総括

**所見20件。過去最多。** ラウンドごとの件数は 20 / 17 / 16 / 15 / 16 / 20 で、**減っていない。**

| 観点       | BLOCK | HIGH | MEDIUM |
| ---------- | ----- | ---- | ------ |
| rust       | 0     | 3    | 4      |
| robustness | 0     | 4    | 4      |
| comment    | 1     | 2    | 6      |

### r7 の報告に2つ誤りがあった

1. **「H-5 が7ラウンド目で閉じた」は誤り。** macOS の Cmd+Q は `ExitRequested` を
   発火しない（R8-B1）。閉じたのはウィンドウの × を押した経路だけ
2. **「M-2 は `SideClock::new` の加算単体では到達しない」も誤り。**
   `TimeLimit::validate` に上限が無いので届く（R8-M2）

### 私が書いた doc の断言が、また3つ偽だった

| 断言                                                        | 現物                                               | 所見  |
| ----------------------------------------------------------- | -------------------------------------------------- | ----- |
| 「ここに達するのはエンジンが stdin を読んでいないときだけ」 | 列の待ちを含むので偽                               | R8-H4 |
| 「`StopEffect` を見ずに**必ず**外す」                       | 2行上に `?` がある                                 | R8-B3 |
| 「立っている間は `Ready` でも直書きさせずに積ませる」       | 3コマンドだけ。`gameover` / `ponderhit` は追い越す | R8-H6 |
| 「`Closed` を立てると…**後は本当に書かれない**」            | 既に列にあるジョブは書かれる                       | R8-H7 |

**4ラウンド続けて、私が新しく書いた断言が次のラウンドで偽になっている。**

---

## 2人以上が挙げたもの

### R8-B1 macOS の Cmd+Q では終了フックが走らない（rust HIGH）

```rust
if let tauri::RunEvent::ExitRequested { .. } = event {
```

アプリメニューの Quit は `PredefinedMenuItem::quit` ＝ `NSApp terminate:`。
`terminate:` はウィンドウに close を送らずに `applicationWillTerminate:` へ進むので、
**`Destroyed` も `RequestExit` も起きない**。届くのは `RunEvent::Exit` だけ。

レビュアーは `tao-0.35.3` / `muda-0.17.1` / `tauri-runtime-wry-2.11.4` の現物を
読んで裏を取っている。**対象が MacBook である以上、Cmd+Q は主経路。**

### R8-B2 `SHUTDOWN_TIMEOUT` が2つを1つの future で包むので、詰まると `shutdown_all` が走らない（rust HIGH / robustness HIGH）

```rust
let left = tokio::time::timeout(SHUTDOWN_TIMEOUT, async {
    let left = games.close_all(&registry).await;
    registry.shutdown_all().await;   // ← timeout が切れると1度も poll されない
    left
}).await;
```

**解析用エンジンは `shutdown_all` からしか届かない。**

内訳を数えると対局1つで最悪 **14.6秒**（`CLOSE_IDLE_TIMEOUT` 6秒 ＋
エンジン2本 ×（`WRITE_TIMEOUT` 2秒 ＋ `QUIT_GRACE` 0.3秒 ＋ `KILL_TIMEOUT` 2秒））。
**私は `CLOSE_IDLE_TIMEOUT` を数え落として10秒にしていた。**

### R8-B3 `stop_analysis` の「必ず外す」の2行上に `?` がある（rust HIGH / robustness HIGH）

```rust
let effect = protocol.stop().await?;      // ← ここで戻ると

// **`StopEffect` を見ずに必ず外す。** …
if let Some(id) = self.infinite_listener.lock().await.take() {   // 到達しない
```

`stop()` が `Err` を返す経路は2つ（`Refuse` と `WRITE_TIMEOUT`）。
**しかも `fail_writes` が `Closed` を立てるようにしたことで、
`Refuse` は r7 以前より確実に起きるようになった。**

自己修復しない唯一の経路が、r7 で私が新設した `fail_writes` の側。

### R8-M4 `fail_writes` の `if` は常に真（rust MEDIUM / robustness MEDIUM）

```rust
if set_ready_state(&self.ready, ReadyState::Closed) == ReadyState::Closed {
```

`next_ready_state` は `requested == Closed` のとき現在値に関わらず `Closed` を返す。
**この `if` は false になれない。** 読み手は「1回だけ記録する仕掛け」と読む。

---

## 1人だけが挙げたもの

### R8-H4 `WRITE_TIMEOUT` は列の待ちを含む（robustness HIGH）

```rust
if self.writer.send(job).is_err() { ... }              // 列に入れる
match tokio::time::timeout(WRITE_TIMEOUT, rx).await {  // 計り始めるのはここ
```

**タイマーは投入の瞬間から回り、前のジョブの処理時間を含む。**
doc の「ここに達するのはエンジンが stdin を読んでいないときだけ」は偽で、
`fail_writes` が「接続が壊れた」と判断する根拠もそこに立っている。

**rust は「キュー待ちを含まない」として問題無しに分類した。矛盾。**
現物を読むと `timeout` が包んでいるのは `rx`（返事の受信）なので、
返事は「列を抜けて書き終わった」ときにしか来ない。**robustness が正しい。**

### R8-H5 `fail_writes` でエンジンが永久に使えなくなるが、利用者に何も出ない（robustness HIGH）

4点が重なる。

1. **文言が事実と違う。** `CLOSED` は "engine output has ended" だが、
   `fail_writes` は出力が終わっていなくても立てる
2. **台帳から外れない。** `protocol()` は成功し続けるので `NotInitialized` に落ちない
3. **フロントの `phase` は `"ready"` のまま。** 押しても何も起きず、どこにも何も出ない
4. **復帰手段が UI に無い。** `EngineProvider` の `restart` は呼び出し元が0

### R8-H6 `draining` が積ませるのは3コマンドだけ（comment HIGH）

```rust
if pending.draining && requires_ready(command) {   // UsiNewGame | Go | Position
```

`GameOver` と `Ponderhit` は `requires_ready` が false なので、
**掃いている最中でも直書きされ、積み置きの `position` / `go` を追い越す。**

筋道: flush が `position` を書いている最中に終局 → `gameover` が先に出る →
flush が続けて `go` を書く → **`gameover` の後にエンジンが探索を始める**。

**R7-B1 が塞いだと書いた窓は、この2コマンドについて開いたまま。**

### R8-H7 `fail_writes` の保証を列の構造が支えていない（comment HIGH）

```rust
/// `Closed` を立てると `dispatch_for` が以後を `Refuse` するので、
/// **「書けなかった」と言ったものより後は本当に書かれない**。
```

`Closed` が止めるのは**これから `send_command` に入る呼び出し**だけで、
**既に `writer.send(job)` を通ってチャンネルに並んでいるジョブは止まらない。**

### R8-B4 表の3行が、同じラウンドで足したフックによって嘘になった（comment BLOCK）

`※4`（:174-176）は `6cf746a` で書き換えたが、同じファイルの

- `:341` 不変条件5「呼び忘れるとプロセスが残る。これはフロント側の契約」
- `:364`「プロセスを落とす経路は `close_game` だけ」
- `:374`「`close` を呼ばずにアプリを閉じる … プロセスが残ることを確かめていない」

が残った。**1つの表の中で ※4 と `:364` が正反対のことを言っている。**

### R8-M1 `position` の失敗が "failed to send go" として説明される（robustness MEDIUM）

台帳が F-19 で最悪と位置づけている「失敗が別の失敗として説明される」と同じ形。
この `detail` は `over` イベントでフロントへ出る。

### R8-M2 `TimeLimit::validate` に上限が無い（rust MEDIUM）

`{ mainMs: u64::MAX, incrementMs: 1 }` は `validate` を通り、
`SideClock::new` の `main_ms + increment_ms` に届く。
debug では overflow で panic し、`invoke` が返らない。release では 0 に巻き戻る。

**r7 の報告書の「加算単体では到達しない」は、`validate` に上限が無い以上成り立たない。**

### R8-M3 `LogThrottle::new` の `Instant::now() - interval` が panic しうる（rust MEDIUM）

同じ危険を `session.rs` のテストは `checked_sub` + `expect` で避けている。
**危険を知っている repo が、本番コードの側だけ裸で書いている。**

### R8-M5 flush の失敗経路だけが `generation` を見ずにキューを奪う（rust MEDIUM）

正常な取り出しは世代を見るのに、失敗側は見ない。
いま守っているのは `abort_init` の呼び出し順という**タイミングの偶然**。

### R8-M6 台帳に r7 の失敗が載っていない（robustness MEDIUM / comment MEDIUM）

`fail_writes` でエンジンが使えなくなる／終了時に落としきれない、のどちらも
F 番号が無い。`:167` は「この6行を先に読むこと」と索引を主張しているので、
6行を読んだ人はこの経路を読まない。**R7-H4 と同じ形の再発。**

### R8-M7 終了時に main thread が最大10秒止まる（robustness MEDIUM）

その間イベントループは何も処理しない。落ちるのはログ1行だけ。

### R8-M8 `comment_identifiers` の `EXEMPT` 6件が1件も効いていない（comment MEDIUM）

6件のうち5件は `src-tauri/src` に1度も現れない。
**リストを空にしても検査の結果は変わらない。**
除外が空振りしていると、検査がどれだけ緩いかを読み手が測れない。

### R8-M9 検査の限界の記述に2つ足りない（comment MEDIUM）

`src-tauri/tests/**` を見ていないこと、行末コメントを見ていないこと。
**R7-M4（`timeout_result.rs` の doc が走査の実態と食い違っていた）は、
まさに `tests/**` で起きた故障。\*\*

### R8-M10 「ブロックコメントは追わない」の根拠が現物に無い危険（comment MEDIUM）

前半（この repo は行コメント）は正しいが、後半（文字列リテラルの `/*` を拾う）は
現物に該当が0件。同じファイルの `code_only` は `//` について既にその素朴さを持つ。

### R8-M11 `infinite_listener` の「3つの口」は現物では5つ（comment MEDIUM）

flush の失敗と `readyok` が来なかったときの2つが抜けている。
**コードは数え上げをやめたのに、コメントだけが数え上げを続けている。**

### R8-M12 `send_command` の判断が純関数と本文に割れた（comment MEDIUM）

送る／積むを決めているのは `(ReadyState, draining, cmd)` の3引数の写像なのに、
テストが当たっているのは2引数の `dispatch_for` だけ。
**R8-H6（`requires_ready` の抜け）は単体テストでは踏めない。**

---

## 重複と矛盾

**矛盾が1件。** `WRITE_TIMEOUT` が列の待ちを含むか。

- rust:「含まない実質の書き込み時間。誤爆の筋は見つからなかった」
- robustness:「投入の瞬間から回る。進んでいるエンジンを殺せる」

**現物を読んで robustness が正しいと判断した。** `timeout` が包んでいるのは
`rx` の受信で、返事は列を抜けて書き終わった後にしか来ない。

## 収束していない

件数が減っていない。`/implement` の「所見が減らないラウンドが3回続いたら
直し方ではなく**対象**を疑う」に、3回目として当たっている。

**対象は「私が書く doc の断言」。** 上の表のとおり、4ラウンド続けて
新しく書いた断言が次のラウンドで偽になっている。共通しているのは:

> **保証の範囲を、実装が支えている範囲より広く書く。**

「必ず」「ここ1箇所」「本当に書かれない」「N つの口」。
どれも書いた時点では自分の頭の中で真だが、実装の別の枝を数えていない。

**r8 では、断言を書かないのではなく、断言を機械が引ける形にする。**
`dispatch_for` を3引数に畳めば R8-H6 と R8-M12 が同時に消え、
写像の表がテストになる。これが今回の集約。

## 見ていない範囲

3人とも共通:

- **実機のエンジンを1つも起動していない。** `WRITE_TIMEOUT` の実発火頻度、
  `draining` 中の実際の interleaving は測っていない
- **macOS の Cmd+Q を実機で試していない。** R8-B1 は依存クレートのソースを
  読んだ静的な結論。1行のログを `RunEvent::Exit` に入れれば数十秒で確かめられる
- 対局のフロント UI は存在しない

個別:

- `game-session.md` の `E1`〜`E18` × `G0`〜`G2` の全セル（r7 から持ち越し）
- `failure-surfacing.md` の F-1〜F-18
- `src-tauri/tauri.conf.json` の capabilities / permissions（r5 から4ラウンド持ち越し）
- 持ち越し（H-6 / R2-H5 / M-3 / M-6 / M-7）

## lint / hook 案

| 何を                        | どう                                                                         | 止まる所見      |
| --------------------------- | ---------------------------------------------------------------------------- | --------------- |
| `RunEvent` の取りこぼし     | `if let` を `match` にする。次にバリアントが増えたとき数え直す機会が来る     | R8-B1           |
| 死んだ `EXEMPT` 項目        | 各綴りが少なくとも1つのコメントから参照されていることを見る `#[test]`        | R8-M8           |
| `Instant::now() - Duration` | `src-tauri/tests/` の文字列検査。該当1件、誤検出なし                         | R8-M3           |
| 常に真の比較                | 機械では止まらない。`set_ready_state` が `Option` を返す形にすれば型で止まる | R8-M4           |
| 上限の合計                  | `const` 同士の `assert!` を `#[test]` に置く（いま入れると赤）               | R8-B2           |
| **機械で防げないもの**      | doc が保証の範囲を実装より広く書くこと／表の1行だけが更新されないこと        | R8-H6 / H7 / B4 |

---

## 修正計画

### 第0群: 集約（断言を機械が引ける形にする）

1. **`dispatch_for` を3引数に畳む**（R8-H6 / R8-M12）。写像の表をテストにする
2. **`WRITE_TIMEOUT` を `run_writer` の中へ移す**（R8-H4 / R8-H7）。
   `Err(Timeout)` が「その1件が本当に書けなかった」を意味するようになり、
   `fail_writes` の根拠が成立する。列に残ったジョブも中断印で断る

### 第1群: 実害

3. **R8-B1 / R8-B2** 終了フックを `ExitRequested | Exit` の両方で受け、
   `shutdown_all` を無条件に走らせる
4. **R8-B3** `stop_analysis` の `?` を後ろへ
5. **R8-M2** `validate` に上限。算術を `saturating_add` に
6. **R8-M3** `LogThrottle::new` の `checked_sub`
7. **R8-M5** flush の失敗側でも世代を見る
8. **R8-M4** `fail_writes` の `if`
9. **R8-M1** `position` / `go` のラベルを分ける

### 第2群: 機械化

10. `EXEMPT` の死んだ項目を落とし、参照されていることを見るテスト（R8-M8）
11. `Instant::now() -` の検査（R8-M3 の再発防止）

### 第3群: doc

12. R8-B4 / R8-H5 / R8-M6 / R8-M7 / R8-M9 / R8-M10 / R8-M11

## 結果

（`/review-fix` で書き戻す）
