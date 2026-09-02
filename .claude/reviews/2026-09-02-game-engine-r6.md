# 対局エンジン レビュー ラウンド6

対象: `worktree-wt-game-engine`（`dd83f93..4da3ef9` の r5 の修正10件を焦点に）
観点: rust / robustness / comment の3本を並列
日付: 2026-09-02

## 総括

**所見15件。そのほとんどが r5 の修正に由来する。**

| 観点       | BLOCK | HIGH | MEDIUM |
| ---------- | ----- | ---- | ------ |
| rust       | 0     | 2    | 4      |
| robustness | 1     | 3    | 3      |
| comment    | 3     | 2    | 3      |

**r5 で「閉じた」と書いた H-3 は閉じていない。** 締切は `spawn_search` の時点で
`kind` から決まるので、`ponderhit` で先読みから本番思考へ昇格した探索には付かない。
3人全員が指摘した。

## この PR は `/implement` の打ち切り条件に達している

> ラウンドが5を超えたら、直す対象が正しいかを疑う。
> 所見が減らないラウンドが3回続いたら、直し方ではなく**対象**を疑う。
> **同じ判断をする場所を数える。2箇所以上あるなら、機構を足す前に集約する。**

数えた。

### 番人が11個ある

| 定数                   | 置き場          | 何を見ているか                     |
| ---------------------- | --------------- | ---------------------------------- |
| `USI_OK_TIMEOUT`       | `engine/mod.rs` | `usiok` の待ち                     |
| `READY_TIMEOUT`        | `engine/mod.rs` | `readyok` の待ち                   |
| `QUIT_GRACE`           | `registry.rs`   | `quit` から `kill` まで            |
| `WRITE_TIMEOUT`        | `registry.rs`   | `quit` / `kill` の書き込み         |
| `STOP_GRACE`           | `search.rs`     | `stop` の後の `bestmove`           |
| `STOP_WRITE_TIMEOUT`   | `search.rs`     | `stop` の書き込み                  |
| `SEARCH_GRACE`         | `session.rs`    | 第1相の `bestmove`（r5 で追加）    |
| `SETTLE_TIMEOUT`       | `session.rs`    | `TurnClock::Settling`（r4 で追加） |
| `RULING_TIMEOUT`       | `session.rs`    | `AwaitingRuling`                   |
| `CLOSE_SETTLE_TIMEOUT` | `session.rs`    | 探索が畳まれるまで                 |
| `CLOSE_POLL`           | `session.rs`    | 上の聞き直し間隔                   |

**4ファイルに散り、それぞれが部分状態だけを見ている。** そして
r2 以降の毎ラウンド、**番人と番人の隙間**が新しい所見として出ている。

- r4: `Thinking` + `go` 未送信に番人が無い → `SETTLE_TIMEOUT` を足した
- r5: `Thinking` + `go` 送信済みに番人が無い → `SEARCH_GRACE` を足した
- r6: **`ponderhit` で昇格した `Running` に番人が無い**（R6-B2）

足すたびに隙間が1つずれて残る。`/implement` の「片方だけ塞ぐ」がこの repo で
6回出ているという記述の、7回目・8回目・9回目にあたる。

### `send_command` の呼び出しが18箇所、上限を通しているのは1箇所

`grep` で数えた。上限が付いているのは `search.rs:205`（`stop`）だけ。
残り17箇所は、詰まったら返らない。r5 は「上限が効くようになった」と書いたが、
**効くようになったのは `registry::terminate` の2箇所と `stop` の1箇所だけ**で、
`position` / `go` / `ponderhit` / `gameover` / `setoption` / `usinewgame` は裸のまま。

R6-B3（`close_game` が返らない）も R6-M5（締切の手前の書き込み）も、
根はここ1つ。

## 結論: 集約してから直す

**2つ集約する。所見の大半はその副作用で消える。**

### 集約1: 番人を `on_tick` に寄せる

`run_search` の中に締切を置いたのが誤りだった。あのタスクは
**`ponderhit` を観測できない**（起動時の値を握ったまま走る）。

`on_tick` は 100ms ごとに回り、`Phase` と `TurnClock` と `Activity` を
**全部見られる**。そこへ寄せると:

- R6-B2（`ponderhit` に締切が付かない）が**構造的に**消える。番人が
  「いつ起動したか」ではなく「いまどうなっているか」を見るため
- R6-B1（締切が `stop` を送らず `gameover` が飛ぶ）も消える。`on_tick` から
  終局させれば `Activity` は `Searching` のままなので、`finish` の
  `idle_sides` に入らない
- `SearchRequest::deadline` と第1相の締切の枝を落とせる（r5 で足したものを撤去）

### 集約2: 書き込みを1本の列にする

`spawn_blocking` を呼び出しごとに投げると、**どのスレッドが先に
`handler` の Mutex を取るかは投入順と無関係**（R6-M3）。
r5 より前は `tokio::sync::Mutex` の FIFO で順序が決まっていたので、
**これは r5 が持ち込んだ退行**。

書き込みを `mpsc` で受ける1本のタスクに集約すると:

- 投入順＝ワイヤ上の順が型で保証される（R6-M3 が消える）
- flush と直書きが同じ列に並ぶので、追い越しの窓が消える（R6-M2）
- 「まだ書いていないもの」の所在が列1つになるので、`cancel_queued_go` の
  取りこぼしが消える（R6-M1 の半分）
- **上限を置く場所が1つになる。** 18箇所に散らすのをやめられる（R6-M5 / R6-B3）

---

## 所見

### 3人が挙げたもの

#### R6-B2 `ponderhit` で昇格した探索に締切が付かない（rust HIGH / robustness HIGH / comment BLOCK）

```rust
// session.rs:1049 — 締切は spawn 時の kind だけで決まる
deadline: search_deadline(&kind, self.clocks.budget_ms(side)),

// session.rs:941-947 — ponderhit は Activity の中の kind しか書き換えない
if let Activity::Searching { kind, .. } = &mut self.player_mut(side).activity {
    *kind = SearchKind::Search;
}
self.turn_clock = TurnClock::Running(Instant::now());
```

`run_search` は起動時に `expires_at` を固定するので、`Ponder` で始まった探索は
`None` のまま。`ponderhit` の後にエンジンが黙ると:

- `SETTLE_TIMEOUT` は `Settling` しか見ない
- `timeout_enforced` はエンジン側で既定 `false`
- 第1相の締切は `None`（`std::future::pending`）

**R5-H2 が「閉じた」と書いた症状がそのまま残る。** 画面は 00:00 に張り付き、
`clockUpdated` が500msごとに同じ値で飛び、エラーは1行も出ない。

doc は3箇所で覆っていると書いている（`search_deadline` の doc /
`SearchRequest::deadline` の「本番の思考には**必ず**入れる」/ 表の ※12）。
一意性の断言を書かないという r5 の規律1にも当たる。

#### R6-H3 `close_game` の `Err` が doc にも台帳にも無い（3人）

`dd69f28` が新しく返すようになった `Err(the game is busy…)` が、
`bridge.rs` の `///` にも `tauri.ts` の TSDoc にも `failure-surfacing.md` にも無い。

入口の doc は「呼べば落ちる／呼ばなければ残る」の二択のままで、
**呼んだのにプロセスが残る**という第3の状態を書いていない。
`closeGame` を書く人が reject を握り潰すとエンジンが生き残る
（`close_all` に呼び出し元が0なので回収されない）。

`close_all` も `let _ =` で潰すので、戻した意味が消えている。

#### R6-M1 `stop` が `go` を取り消した `Ok(())` が2つの意味を持つ（3人）

`8308a22` が「書かずに `Ok` を返す」経路を足したが、
`outcome_of_stop_write` は `Ok(Ok(()))` を「書けた」と読む。

**`071f61a` の doc が「これを防ぐために3分岐にした」と書いた失敗が、
1コミット後に別の入口から戻っている。**

解析側の筋道: `readyok` の前に「解析開始」→「停止」を押すと、`stop` は
積み置きの `go` を落として `Ok`。`process_analysis_stream` は `bestmove` でしか
抜けないので**永久に待つ**。リスナーも外れず、以後の解析の `info` が
死んだストリームにも配られ続ける。

対局側は現状 `send_setup` が `ensure_ready` を通すので到達しないが、
到達した瞬間に「`go` を1度も受け取っていないエンジンが
`EngineFailure("engine did not stop searching in time")` で負ける」。

### 2人が挙げたもの

#### R6-B1 締切が `stop` を送らず、探索中のエンジンへ `gameover` が飛ぶ（robustness BLOCK / rust HIGH）

```rust
// search.rs — 締切の枝
settled = Some(SearchOutcome::Failed(...));
break;
// → settled が Some なので第2相（stop → STOP_GRACE）を丸ごと飛ばす

// session.rs:700-703
self.player_mut(side).activity = match outcome {
    SearchOutcome::StopTimedOut => Activity::Unresponsive,
    _ => Activity::Idle,          // ← 締切由来の Failed もここ
};
```

`c494e86` 以前、第1相の `Failed` は「エンジンの出力が終わった」でしか出なかったので
`Idle` に戻して `gameover` を送っても相手は死んでいた。
**締切の枝が「エンジンは生きていて、まだ探索中」の `Failed` を作った。**

結果、`finish` が `idle_sides` にこの側を入れて **探索中のエンジンへ `gameover` を送る**。
不変条件3 の直接の違反。`stop` も1バイトも送っていないので、
エンジンは `close_game` を押すまで全スレッドで探索を続ける。
`searches_settled` は `Idle` を見て `true` を返すので、`close` の畳み待ちも素通りする。

**`an_engine_that_will_not_stop_is_not_marked_idle` がこの経路を
`StopTimedOut` について固定しているのに、`_ => Idle` のワイルドカードが
`Failed` を握り潰して緑のまま通した。**

### 1人だけが挙げたもの

#### R6-B3 `close_game` の busy 経路の `abort()` に上限が無い（robustness HIGH）

```rust
// manager.rs:66（dd69f28 で足した Err 分岐）
let _ = session.abort().await;          // 上限なし
// session.rs:244（Ok 分岐は同じ abort を必ず包む）
let _ = tokio::time::timeout(CLOSE_SETTLE_TIMEOUT, self.abort()).await;
```

`abort` → `run_loop` → `finish` → `send_gameover` → `send_command`（上限なし）。
詰まると `close_game` の Promise が永久に pending。
`run_loop` が止まるので `on_tick` も回らず、**`SETTLE_TIMEOUT` と
`RULING_TIMEOUT` の番人も同時に死ぬ。**

#### R6-B4 表の「埋まっていないセル」が ※4 と正反対（comment BLOCK）

`game-session.md:352` は「セッションは台帳から外れているので `close_all` でも
拾えない」と書き、同じ文書の :166-168 は「台帳へ戻し `Err` を返す」と書いている。
現物は後者。`dd69f28` が ※4 だけ直して186行下を残した。

**「埋まっていないセル」は次に何を直すかを拾う索引**なので、
この行を読んだ人は塞がった穴を塞ぎに行くか、`insert` を消して退行を戻す。

#### R6-H1 「持ち時間0＋加算のみ」で人間が開始 0.1 秒で時間切れ負け（robustness HIGH）

`fischer(0, N)` は `budget_ms()` が **0**（加算は `consume` の中でしか足されない）。
`TimeLimit::validate` は通すし、`clock.rs:223` が通したい形として固定している。

- 人間側: 2回目の tick（≈100ms）で `has_expired(100)` が真 → **開始 0.1 秒で負け**。
  `validate` のコメントが「初手で必ず時間切れになる」形を弾くと書いている、まさにその現象
- エンジン側: `search_deadline` = 0 + 30秒固定。1分加算の設定では、
  エンジンが持ち時間どおりに考えている最中に締切が当たる

#### R6-H2 「4つに分かれる」と書いた直後に5つ並べている（comment HIGH）

`a5e5b13` が R5-C9（「3つと書いてあるが4つ」）を直したその同じコミットで、
`outcome_of_stop_write` の2分岐を表に起こしたので総数が5になった。
**数え直しの指摘を受けて数え直した箇所が、また1つずれた。**

#### R6-M2 flush 中に `Ready` が立っているので追い越される（robustness MEDIUM）

`Ready` を立てるのが flush の**前**なので、その窓で `dispatch_for(Ready, _) = Send`
になった直書きがキューを飛び越す。エンジンが `position A` より先に
`go infinite` を受け取る経路がある。

**しかも `send_command` のコメントが「flush は既にキューを空にして去っている」と
書いていて、この窓を否定している。**

#### R6-M3 `write_command` が投入順を保証しない（rust MEDIUM）

`spawn_blocking` を呼び出しごとに投げるので、どのスレッドが先に
`handler.blocking_lock()` を取るかは投入順と無関係。
**r5 より前は `tokio::sync::Mutex` の FIFO で順序が決まっていたので、これは退行。**

#### R6-M4 `spawn_blocking` のスレッドが恒久的に残る（robustness MEDIUM）

`JoinHandle` を落としても `spawn_blocking` は中断されない。詰まった `write_all` は
スレッドを1本占め続け、その間 `handler` の Mutex を握るので後続の `kill_engine` の
`blocking_lock()` も待ち、**2本目も固定される**。`terminate` は1エンジンにつき最低2本。

F-21 は「プロセスが残る」までは書いているが、スレッドが残ることと、
残ったプロセスを指す ID が台帳から消えることを書いていない。

#### R6-M5 締切の手前の `position` / `go` に上限が無い（rust MEDIUM）

締切は「`go` を送り終えた後」からしか数えない。`write_command` が返らないと
第1相にすら入らず、`cancel.cancel()` も `select!` の前なので誰も観測しない。

#### R6-M6 `docsIdentifiers.test.ts` に経緯が2箇所（comment MEDIUM）

`4cda2be` が同じファイルの経緯2段落を消したときに残った。
「〜していなかった」型は `HISTORY_WORDS` のどの語にも当たらないので機械を素通りする。

#### R6-M7 `commentHistory` の doc が実際より広い網を主張（comment MEDIUM）

「形を問わず止めてある」と書いているが、実装は `HISTORY_WORDS` のリテラル一致で、
該当する語彙は1つだけ。**「上限を置いたと書いたら本当に上限か確かめる」と同じ形で、
「止めてあると書いたら本当に止まるか確かめる」が抜けている。**

#### R6-M8 `settle` が2つの別の意味で使われている（comment MEDIUM）

`SETTLE_TIMEOUT`（`TurnClock::Settling` を見る、10秒）と
`CLOSE_SETTLE_TIMEOUT`（`Activity` が畳まれるのを見る、6秒）。
述語も所有者も違うのに同じ語で、名前の包含関係と値の大小が逆に読める。

---

## 重複と矛盾

**矛盾はゼロ。** 3人の所見が食い違った箇所は無い。

**重複は4件。** R6-B2 / R6-H3 / R6-M1 が3人、R6-B1 が2人。

## 見ていない範囲

3人とも共通:

- **実機のエンジンを1つも起動していない。** 「書き込みが詰まる」「`ponderhit` が当たる」
  「`readyok` が遅れる」はどれもコードから導いたもので再現していない
- `npm run verify` / `verify:rust` はレビュアーは走らせていない
- 対局のフロント UI は存在しない
- `tokio` のブロッキングプールの性質（`JoinHandle` を落としても中断されない、
  既定 512 スレッド）は一般的性質として書かれており、**この repo で計測していない**

個別:

- `game-session.md` の `E1`〜`E18` × `G0`〜`G2` の全セル
- `failure-surfacing.md` の F-1〜F-18
- `docs/state-transitions/` の他の表との整合
- `src-tauri/tauri.conf.json` の capabilities / permissions（r5 から持ち越し）
- 持ち越し（H-5 / H-6 / R2-H5 / M-2 / M-3 / M-5〜M-7 / R2-M9）。
  `close_all` の呼び出し元が0であることと `lib.rs` に終了フックが無いことは
  今回も現物で確認した（6ラウンド目）

## 3人が「見たが問題が無かった」と明記した範囲

r5 の修正のうち、次は問題が無いことを確認済み。

- `write_command` の `blocking_lock()` は `spawn_blocking` の中なので panic しない
- ロックの取得順は `pending` → `watch` の一方向。逆順は無い
- `MutexGuard` を `.await` またぎで保持している箇所は `engine/` に無い
- flush のループの停止性と二重書き（R5-H3 の断言は成立している）
- `close_all` のループ（`Err` で戻し入れても再訪しない）
- `kill_engine` の所有権と `std::mem::forget`（二重 panic を確かに避けている）
- 本番コードの `unwrap()` は 0
- 外部プロセスの引数はシェルを経由しない。USI へ流す文字列は制御文字を弾いている

## lint / hook 案

| 何を                                                                        | どう                                                                                                       | 止まる所見      |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------- |
| `send_command` を上限なしで `await` しないこと                              | `timeout_result.rs` と同じ作りで `engine/**` を見る。**集約2の後なら例外は数箇所**                         | R6-B3 / R6-M5   |
| `SearchOutcome` にバリアントを足したら `on_search_outcome` の写像も触ること | `_ =>` のワイルドカードを禁じて全変種を明示させる                                                          | R6-B1           |
| 「〜は N つに分かれる」と直後の表の行数のずれ                               | `docs/**` で `\*\*(\d+)つ` を拾い、続く表の行数と突き合わせる                                              | R6-H2           |
| 過去形の経緯                                                                | `HISTORY_WORDS` に `"ていなかった"` を足す（現物の該当は1件、誤検出なし）                                  | R6-M6           |
| `#[tauri::command]` で `Result` を返す関数の doc に `Err` の語              | `src-tauri/tests/` の検査                                                                                  | R6-H3           |
| **機械で防げないもの**                                                      | 番人と番人の隙間／決定と実行の間に状態が動く窓／`Ok(())` が2つの意味を持つこと／doc に**行が足りない**こと | R6-B2 / M1 / M2 |

---

## 修正計画

**集約を先にやる。所見を1件ずつ潰すのをやめる。**

### 第0群: 集約

1. **集約2（書き込みの列）** — `UsiProtocol` に書き込みタスクを1本置き、
   `mpsc` で受けて順に書く。`write_command` の呼び出し順＝ワイヤ上の順。
   上限もここ1箇所に置く。→ R6-M3 / R6-M2 / R6-B3 / R6-M5 が消える
2. **集約1（番人を `on_tick` へ）** — `SearchRequest::deadline` と第1相の締切の枝を
   撤去し、`on_tick` に `TurnClock::Running` の番人を置く。
   → R6-B2 / R6-B1 が構造的に消える

### 第1群: 集約で消えない実害

3. **R6-M1** `stop` の口を分ける（`StopEffect::{Written, CancelledQueued}`）
4. **R6-H1** `fischer(0, N)` の扱いを決める。`validate` で弾くか初手ぶんを積む

### 第2群: 機械化

5. `on_search_outcome` の `_ =>` を禁じる（R6-B1 の再発防止）
6. 「N つに分かれる」と表の行数（R6-H2）
7. `HISTORY_WORDS` に `"ていなかった"`（R6-M6）
8. `#[tauri::command]` の `Err` の doc（R6-H3）

### 第3群: doc

9. R6-B4（表の矛盾）/ R6-H2 / R6-H3 / R6-M4（F-21）/ R6-M6 / R6-M7 / R6-M8

## 結果

（`/review-fix` で書き戻す）
