# 対局エンジン レビュー ラウンド5

対象: `worktree-wt-game-engine`（`a304758..1713c78` の r4 の修正17件を焦点に）
観点: rust / robustness / comment の3本を並列
日付: 2026-09-02

## 総括

**r4 の修正のうち3つが、直っていないか新しい穴を開けた。**

| r4 の所見 | r4 で何をしたか                                  | r5 で分かったこと                                                |
| --------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| R4-H1     | `quit` / `kill_engine` に `tokio::time::timeout` | **上限になっていない**（R5-B2）。3人全員が指摘                   |
| R4-M2     | `stop` の書き込みに `timeout` ＋ `.is_ok()`      | 同上。加えて内側の `Err` を握り潰す（R5-H1）                     |
| R4-M1     | 世代とキューを1つの Mutex へ                     | **`ReadyState` の読みがロックの外に残った**（R5-B3）。同じ形の窓 |

**r4 が自分に課した規律を、r4 自身が3回破っていた。**

- 「場所を言うなら数えて並べる」→ F-23 に「`EngineFailure` の4箇所」と書いたが現物は5箇所（R5-C4）
- 「変えた側は直して読んでいる側を数え直す」→ `SearchOutcome` の改名で表の1行を落とした（R5-C2、3人全員）
- 「変更の経緯を書かない」→ r4 で足したコメントと**新しい検査3本の doc** に経緯が5箇所（R5-C7）

| 観点       | BLOCK | HIGH | MEDIUM |
| ---------- | ----- | ---- | ------ |
| rust       | 0     | 2    | 5      |
| robustness | 1     | 3    | 2      |
| comment    | 4     | 5    | 2      |

---

## 3人が独立に挙げたもの

### R5-B2 `timeout` が「詰まった書き込み」を1つも止めない（robustness HIGH / rust HIGH / comment BLOCK）

`tokio::time::timeout` は内側の future を**先に** poll し、`Pending` が返って初めてタイマーを見る。
`send_command` の中身は

```rust
let mut guard = self.handler.lock().await;   // ここまでは await
handler.send_command(command)                // 同期。await が無い
```

で、`usi-0.6.2/src/process/writer.rs:31-36` は `ChildStdin` への `write_all` + `flush`。
パイプが埋まると `poll` が返らないので、**タイマーが満了しても `Timeout` は一度も poll されない。**

上限が包めているのは `handler` の Mutex を**待つ**ときだけ。

帰結:

- `close_game` / `shutdown_engine` は返らない。`registry.rs:196` の warn も `:209` の error も出ない
- ブロックしたタスクはワーカースレッドごと固定される（複数エンジンなら複数本）
- `search.rs` の `!written` 分岐には、別タスクが Mutex を2秒以上握っている場合しか入れない

**そして「上限がある」という断言が3箇所に増えた。**
`registry.rs:181`（「返らない経路を残さない」）、`game-session.md:155-156`、`failure-surfacing.md` の F-21。
`session.rs:67` の `SETTLE_TIMEOUT` = 10秒の根拠も「`STOP_GRACE`（5秒）＋**書き込みの上限（2秒）**」と、
存在しない上限を足して算出している。

**これは4ラウンド連続で出ている「コメントが主張していることを実装がしていない」の再発**で、
しかもその対策の機械を作った同じラウンドで起きた。

### R5-C2 表の1行が改名前の `Aborted` を指したまま（3人全員）

`game-session.md:222` は `| `bestmove`を受けた | 打ち切りに応じた |`Aborted` |`。
同じファイルの `:83` は `1713c78` で `SearchOutcome::StoppedCleanly` に直っている。
**同じ文書の107行下に古い名前が残った。**

`Aborted` はリポジトリに実在する（`GameOverReason::Aborted`）ので、`:222` を読んで grep した人は
「打ち切りに応じて正常に止まった」の欄に「勝敗なしで対局が終わった」の定義を見つける。
**改名前より悪い。**

r4 で足した `docsIdentifiers` は下線を含む綴りしか拾わないので `Aborted` は候補にすら入らず、
入っても実在するので落ちない。

### R5-C1 `turn_clock` の代入に、型から消えた `None` を説明するコメント（rust MEDIUM / comment BLOCK）

`session.rs:578-580`:

```rust
// 思考が始まった時点で入れる。`hand_turn_to` が畳み待ちへ倒したら
// `None` のままになり、その間は時計が動かない
self.turn_clock = TurnClock::Settling(Instant::now());
```

2文とも偽。`TurnClock` に `None` は無い。入れているのは `Settling`＝**思考がまだ始まっていない**印なので
「思考が始まった時点で入れる」は逆。`3172248` が `Option` を捨てた要点そのものを、
その `Option` を前提にした説明が代入の真上で否定している。

ここを読んで `hand_turn_to` の後に `Running` を入れ直す修正を書くと、`SETTLE_TIMEOUT` が
二度と当たらなくなり、`3172248` が塞いだ無音の固まりが戻る。
**`cargo test` は落ちない**（`settling_forever_ends_the_game` は `turn_clock` を直に組む）。

---

## 2人が挙げたもの

### R5-H1 `stop` の書き込みが失敗しても「書けた」として5秒待つ（rust MEDIUM / robustness HIGH）

`search.rs:176-179`:

```rust
let written = tokio::time::timeout(STOP_WRITE_TIMEOUT, protocol.send_command(&GuiCommand::Stop))
    .await
    .is_ok();
```

`timeout` の戻りは `Result<Result<(), EngineError>, Elapsed>`。`.is_ok()` が見ているのは**外側だけ**。

**R4-B1 で `dispatch_for(Closed, _) = Refuse` を足したことで、`send_command(&Stop)` は
`Err` を返す経路を新しく獲得した。** `handler` が `None` のときの `NotInitialized` も同じ。

帰結: `stop` が1バイトも出ていないのに `STOP_GRACE`（5秒）を待ち、
`detail: "the engine did not stop searching in time"` が載る。
**送れなかったのに、エンジンが `stop` を無視したという説明が残る。**
`outcome_after_stop` の doc が「相によって説明が変わる」のを避けると書いた、その同型。

### R5-H2 `Thinking` かつ時計が動いている状態には、いまも番人が無い（H-3、5ラウンド目）

`SETTLE_TIMEOUT` が見るのは `TurnClock::Settling` だけ。`Running` には何も無い。
`on_tick` の時間切れは `timeout_enforced` を通り、`enforce_engine_timeout` は既定 `false` なので
**エンジン側では常に false**。`run_search` の第1相にも時間の枝が無い。

エンジンがハングすると: 第1相は永久に待つ → `SETTLE_TIMEOUT` に当たらない → 時間切れにもならない →
`clocks_view` は両方の期限が `now` を返し続けるので**画面は 00:00 に張り付く** →
`phase: thinking` のまま `clockUpdated` が500msごとに同じ値で飛ぶ。**エラーは1つも出ない。**

**r4 で `SETTLE_TIMEOUT` の doc に「`RULING_TIMEOUT` と対になる、`Thinking` 側の番人」と書いたことで、
`Thinking` 側が塞がったように読める。** 塞がっているのは部分状態の片方だけ。

---

## 1人だけが挙げたもの

### R5-B1 `stop` が積み置き中の `go` を追い越す（robustness BLOCK）

`requires_ready` は `UsiNewGame | Go | Position` の3つだけなので、`Waiting` の間
**`go` は積まれ、`stop` は素通りする**（`dispatch_for(Waiting, Stop) = Send`。テストが固定している）。

筋道:

1. 評価関数の読み込みに時間がかかるエンジンで「適用」→ `usinewgame` が `Queue` → `Ok` → 画面は成功
2. `readyok` の前に「解析開始」→ `position` も `go infinite` も `Queue` → `Ok` → 画面は「解析中」
3. 読み筋が出ないので「停止」→ `stop` だけがエンジンへ書かれる。まだ探索していないので何も起きない。
   セッションは台帳から外れ、画面は「停止しました」
4. 数秒後に `readyok` → flush が `usinewgame` → `position` → **`go infinite`** を書く
5. **エンジンが全スレッドで無限探索を始める。** セッションは無いので誰も止めない。
   画面は「停止」のまま CPU だけ回り続ける。復帰はエンジンの終了ボタンのみ

### R5-B3 「積む」を決めた後に `pending` を取るまでの窓（rust HIGH）

```rust
let state: ReadyState = *self.ready.borrow();      // (1) Waiting を読む
match dispatch_for(state, command) {
    Dispatch::Queue => {
        let mut pending = self.pending.lock().await;   // (2) ← await 点
```

(1) と (2) の間に watch タスクが丸ごと通れる。通ると `ready` は `Ready` になりキューは空になるが、
(1) で `Queue` を決めた側は見直さずに空のキューへ `push_back` して `Ok(())` を返す。
**そのキューを掃く者はもう居ない。**

`protocol.rs:44-50` は「世代とキューを同じロックの下に置く」ことで
「呼び出し側に `Ok` を返したまま消える」を塞いだと書いているが、
**同じロックへ入れたのは世代とキューだけで、`ReadyState` の読みは外に残っている。**

具体: `set_position` が `Queue` を決めた直後に `readyok` が着地すると、`Position` は誰も flush しない
キューへ落ちて `Ok`。次の `start_infinite_analysis` は `Ready` を読むので `go infinite` を**そのまま**送る。
エンジンは**前の局面**を無限解析し、画面には別局面の読み筋が出続ける。エラーは1行も出ない。

関連して `kill_engine` は handler を `take` しても `ready` を `Waiting` のまま残すので、
同じキューが**死んだプロセス向けに**積める。

### R5-B4 `GameManager::close` の「`close_all` が拾う」は成立しない（comment BLOCK）

```rust
let session = self.sessions.write().await.remove(game_id);   // :51 先に台帳から外す
...
    Err(session) => {
        // 誰かが操作中。中断だけ通してエンジンは残す。
        // 残ったプロセスは `close_all` が拾う
```

`close_all` は `self.sessions` の key を舐めるだけ。この経路のセッションは `:51` で**既に消えている**ので、
`close_all` を何度呼んでも二度と現れない。`engine_ids` を持つ `GameSession` はここで drop され、
**プロセスを落とす手掛かりが消える。**

`game-session.md:158-160` は同じ件を「受け皿とされている `close_all` に呼び出し元が0」と書いていて、
**呼び出し元の有無以前に受け皿として機能しない**ことを両方とも見落としている。

### R5-H3 flush 中に `abort_init` が入ると、`Ok` を返したコマンドが1行も残さず消える（rust MEDIUM）

`discard_pending` の doc は「捨てるものがあったら**必ず1行残す**」と絶対の断言をしている。
だが flush は `std::mem::take(&mut pending.queue)` でキューをローカルへ移してから書くので、
`abort_init` が `h.abort()` した時点で `pending.queue` は既に空。
まだ書いていないコマンドは `report_dropped` も `discard_pending` の warn も通らずに消える。

窓は狭い（`readyok` の直後、flush が終わる前にもう一度 `isready` か `kill_engine`）。
ただし r1 から4ラウンド持ち越して r4 でようやく塞いだ形と同じものなので、
断言を残すなら穴を塞ぐ必要がある。

### R5-C3 `TurnClock` の doc が「番人を置けなかった」と過去形で書いている（comment HIGH）

```rust
/// `AwaitingRuling` に `RULING_TIMEOUT` が居るのに対して、こちら側には番人を置けなかった。
```

現物は `SETTLE_TIMEOUT` が `on_tick` で `Settling` を見て終局させ、テストが固定している。
番人を探しに行った人が「まだ無い」と読んで二重に足す。
加えて `Option<Instant>` は現在の型に無い＝**変更の経緯**。

### R5-C4 F-23 の「`EngineFailure` の4箇所」は5箇所（comment HIGH）

現物は `session.rs:696` / `:706` / `:752` / `:795` / `:941` の5箇所。
**`:795` は同じラウンドの `3172248` が足した `SETTLE_TIMEOUT` の番人。**
r4 が自分に課した「場所を言うなら数えて並べる」を、その規律を書いたラウンドの最後のコミットが破っている。

### R5-C5 表に `SETTLE_TIMEOUT` の終局が1行も無い（comment HIGH）

`SETTLE_TIMEOUT` は doc 全体で0ヒット。tick 由来の終局は `E14`（時計が尽きた）と
`E15`（裁定が返らない）が行として立っているのに、3本目だけ行が無い。
この表は「対局がどう終わりうるか」を数え上げる索引なので、UI を作る人が
`EngineFailure` の発生源を1つ取りこぼす。

### R5-C6 `running_clock` の「3箇所は呼ぶだけ」が6行下で破れている（comment HIGH）

```rust
/// **時計が動くかを決めるのはここ1本。** `on_tick` も `clocks_view` も
/// `decide_move` もこれを呼ぶだけで、独立した判定を持たない。
...
fn clocks_view(&self) -> ClocksView {
    let Some(now) = now_epoch_ms() else {
        return self.clocks.view(None, 0);   // running_clock を呼びもしない
```

これは `types.rs` と `rust-types.ts` が `running: null` の**4番目の原因**として独立に数えているもの。
「呼ぶだけ」を信じた人が壁時計の枝を「重複した番人」と見て消すと、`view(running, 0)` が呼ばれ
**1970年基準の `mainZeroAt`＝常に 0 秒**を画面へ出す。

### R5-C7 「〜だった時期がある」型の経緯が5箇所（comment HIGH）

- `protocol.rs:429` —「（`IsReady` だけ `dispatch_for` を通らない時期があった）」
- `protocol.rs:789-790` —「`send_command` がこの写像を通さずに分岐していた時期があるため」
- `types.rs:336` —「`rename_all_fields` を足すまで snake_case のまま出ていた」
- `docsIdentifiers.ts:39-41` / `docsIdentifiers.test.ts:14-15` — **r4 で足した検査の doc**
- `commentHistory.test.ts:58-59` — 同上

理由は経緯抜きで書ける。`protocol.rs` なら「呼び出し側の順序に依存させない」、
`types.rs` なら「`rename_all` はバリアント名にしか効かない」で足りる。

**`commentHistory.test.ts` は自分自身を走査から外している**ので、この経緯は構造上いつまでも止まらない。

### R5-C8 `docsIdentifiers` が doc に書いた限界が、実際の限界より狭い（comment MEDIUM）

2点、記述が現物より甘い。

1. **部分一致。** `includes` なので、消えた名前が生きている別の識別子の部分文字列なら緑になる。
   現物に該当する対がある（`WRITE_TIMEOUT` ⊂ `STOP_WRITE_TIMEOUT`）。
   接尾辞を足す改名（`FOO` → `STOP_FOO`）は最も普通の改名なのに、
   「綴りごと消えた名前だけは止められる」に当てはまらない
2. **下線を含まない綴りは1つも見ていない。** 型名・バリアント名は全部対象外。
   **上の R5-C2 がそこをすり抜けている。**

加えて `EXEMPT` の2件（`go_ponder` / `position_sfen`）は `docs/` に1件も出現せず、何も免除していない。

### R5-C9 表が第2相の4つ目の終わり方を数えていない（rust MEDIUM）

`3172248` は第2相に4つ目の終わり方（書き込みが上限に達して `outcome_after_stop` を通らずに
`StopTimedOut` を返して return）を足したが、表は「3つに分かれる」と数え、
`E12` は「`STOP_GRACE`（5秒）を超えた」を `StopTimedOut` の定義として書いている。
**表を読んだ人は「5秒待っても返さなかった」と読むが、現物はその5秒を1度も待たずに来る場合がある。**
`detail` も同じ文言なのでログからも区別できない。

`git show --stat 3172248` は `docs/` を1行も触っていない。

### R5-M1 Tauri コマンド9本のうち2本だけ doc が裸（comment MEDIUM）

`get_game_state` と `list_games`。TS 側も同じ2本だけ TSDoc が無く、両方 `index.ts` から公開されている。
`GameSnapshot` は読み手が知らないと必ず誤読する欄を持つ（`moves` は写し、`clocks.running` は4通りの
理由で `null`、`phase` は取得時点の値）のに、**入口の関数から辿れない。**

---

## 重複と矛盾

**矛盾はゼロ。** 3人の所見が食い違った箇所は無い。

**重複は3件。** R5-B2 が3人、R5-C2 が3人、R5-C1 と R5-H1 が2人ずつ。
R5-B2 を3人が別々の言い方で挙げたことに意味がある——
rust は「タイマーが poll されない」、robustness は「`close_game` が返らない」、
comment は「断言が3箇所に増えた」。**同じ1つの穴が、3つの観点すべてで最上位に来た。**

## この PR の危険な傾向

r4 と r5 で同じ形が繰り返されている。

> **「上限を置いた」「1本に閉じた」「必ず残す」と書いて、実際には片側しか塞いでいない。**

- R4-H1 → 上限が Mutex の待ちにしか効かない（R5-B2）
- R4-M1 → ロックに入れたのは世代とキューだけで、状態の読みは外（R5-B3）
- R4-M1 の doc → 「必ず1行残す」に flush 中の穴（R5-H3）
- R4-M2 の doc → 「`Thinking` 側の番人」だが `Running` は見ていない（R5-H2）

`/implement` の「ラウンドが5を超えたら、直す対象が正しいかを疑う」に**到達している。**
共通するのは **`UsiProtocol` の書き込みが同期ブロッキングであること**で、
4件ともその上に上限や不変条件を積もうとして片側だけ塞いでいる。
**次のラウンドは、上に積むのをやめて書き込みそのものを非ブロッキングにするところから始める。**

## 見ていない範囲

3人とも共通:

- **実機のエンジンを1つも起動していない。** `usi-0.6.2` のソースは読んだが、
  ブロッキング write が実際に詰まる様子は再現していない
- `npm run verify` / `verify:rust` はレビュアーは走らせていない
- 対局のフロント UI は存在しない

個別:

- `tokio::time::timeout` が内側 future を先に poll する件は tokio の一般的性質として書かれている。
  **この repo で計測した数値ではない**
- `game-session.md` の `E1`〜`E16` 各セルと現物の突き合わせ（`:222` と `:84` 以外）
- `failure-surfacing.md` の F-19〜F-23 と現物の突き合わせ（F-23 の件数以外）
- `docs/state-transitions/` の他の表との整合
- 持ち越し（H-5 / H-6 / R2-H5 / M-1〜M-7 / M-18 / M-20〜M-25 ほか）
- `src-tauri/tauri.conf.json` の capabilities / permissions

## lint / hook 案

| 何を                                                | どう                                                                                                                                        | 止まる所見           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **ブロッキング IO を async の中で直接呼ばないこと** | `engine/**` の `#[cfg(test)]` 外に `handler.send_command(` / `handler.kill(` / `.listen(` が現れたら、`spawn_blocking` の中であることを要求 | R5-B2                |
| `timeout` の内側の `Result` を捨てないこと          | `tokio::time::timeout(` に続く数行の `.is_ok()` / `.is_err()` を落とす。いま1件                                                             | R5-H1                |
| doc の CamelCase 識別子と `Enum::Variant`           | `docsIdentifiers` の抽出を広げ、`includes` を語境界に変える                                                                                 | R5-C2 / R5-C8        |
| doc の「`X` の N箇所」という断言                    | `` `Ident` の(\d+)箇所 `` を拾い、出現数と突き合わせる                                                                                      | R5-C4                |
| 「〜時期があ」型の経緯                              | `HISTORY_WORDS` に足す。`commentHistory.test.ts` の自己免除を外す                                                                           | R5-C7                |
| enum 定義を変えたら表も触ること                     | `verify-gate.sh` で `engine/game/{search,session}.rs` の enum 定義行の変更に `game-session.md` の変更を要求                                 | R5-C9                |
| `#[tauri::command]` に doc が無いこと               | `src-tauri/tests/` で属性の直前行に `///` を要求                                                                                            | R5-M1                |
| **機械で防げないもの**                              | timeout が実際には何も包んでいないこと／表に**行が足りない**こと／「受け皿がある」という誤った主張／決定と実行の間に状態が動く窓            | R5-B1 / B3 / B4 / C5 |

---

## 修正計画

**第0群を先にやる。** r4 は「上に積む」修正を4件入れて4件とも片側しか塞げなかった。
根を直してからでないと、同じことを繰り返す。

### 第0群: 書き込みを非ブロッキングにする

1. **R5-B2** `handler` への書き込み（`send_command` / `kill`）を `spawn_blocking` に出す。
   これで `timeout` が本物になり、ワーカースレッドも塞がらない。
   r1 の M-4（async の中のブロッキング IO、5ラウンド持ち越し）も同時に閉じる

### 第1群: 実際に壊れているもの

2. **R5-H1** `.is_ok()` を3分岐に割る。純関数へ切り出してテスト
3. **R5-B1** `Waiting` の `stop` が積み置きの `go` を取り消すようにする
4. **R5-B3** `pending` を取ってから状態を読み直す。`kill_engine` に `Closed` を入れる
5. **R5-H3** flush をローカルへ移さず、1件ずつ `pending` を取り直す
6. **R5-B4** `close` の `remove` を `try_unwrap` の成功後に移す（または失敗時に戻す）
7. **R5-H2** 第1相に締切を置く（H-3、5ラウンド目）

### 第2群: 機械化

8. `timeout` の内側 `Result` を捨てる形の検査（R5-H1 の再発防止）
9. `docsIdentifiers` を語境界＋`Enum::Variant` に広げる（R5-C2 / R5-C8）
10. `HISTORY_WORDS` に「時期があ」を足し、`commentHistory` の自己免除を外す（R5-C7）

### 第3群: doc

11. **R5-C1** `turn_clock` の代入のコメント
12. **R5-C2** 表 `:222` の `Aborted`
13. **R5-C3** `TurnClock` の doc から経緯と過去形を落とす
14. **R5-C4** F-23 の件数を5に
15. **R5-C5** 表に `E17`（`SETTLE_TIMEOUT`）を足す
16. **R5-C6** `running_clock` の doc に壁時計の例外を書く
17. **R5-C7** 経緯5箇所
18. **R5-C9** 表の第2相を4つに
19. **R5-M1** Tauri コマンド2本の doc

## 結果

（`/review-fix` で書き戻す）
