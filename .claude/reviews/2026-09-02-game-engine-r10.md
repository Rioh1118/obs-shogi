# 対局エンジン レビュー ラウンド10

対象: `worktree-wt-game-engine`（`e2f62e8..HEAD` の r9 の4コミットを焦点に）
観点: rust / robustness / comment の3本を並列
日付: 2026-09-02

## 総括

**所見20件（重複を畳んだ後）。** BLOCK 4 / HIGH 7 / MEDIUM 9。

### r9 の修正のうち3つが見かけだけだった

| r9 で報告したこと                | 現物                                                                                                              | 所見   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------ |
| 「解析の3つの入口を揃えた」      | `create_session` は `Infinite` でしか呼ばれない。時間／深度の解析は台帳に**何も書かない**ので、検査は常に空を見る | R10-B1 |
| 「flush の不変条件を構造で守る」 | 入ったのは**コメントだけ**。しかも追い越すのは別スレッドなので、コメントの前提（await 点を作らない）が成立しない  | R10-M1 |
| 「手書きの数を消した」           | **1階層上へ移っただけ**。`covered.len() == 3` が残り、`commands()` に無いバリアントを述語へ足すと3本とも緑        | R10-B2 |

### `comment_history.rs` は偽の前提の上に建てた重複だった

module doc に「あちらは `src/**` の TS を見る」と書いたが、**TS 側の `ROOTS` は
`RUST_SRC` と `src-tauri/tests` を含み、`sourceFiles` は `.rs` を拾う**。
実測で 52 個の `.rs` を歩いている。

**証拠は自分のコミットメッセージの中にあった。**「TS 側の検査がこの Rust 版の doc を
捕まえた」と書いた時点で、TS が Rust を歩いていることは明らかだった。

しかも Rust 版は TS 版より**弱い**。

- `HISTORY_WORDS` が3語少ない
- `REVIEW_TAG` / `BRANCH_NAME` を持たない
- 行頭の `//` しか見ない（TS 版は行末とブロックも拾う）

**1つの規約に語彙表が2つでき、片方にしか無い語が5つある。**

---

## 実害

### R10-B1 `ensure_no_active_session` は守ると書いた不変条件を1つも守れない（rust HIGH / robustness HIGH）

```rust
enum SessionType {
    Infinite,
    #[allow(dead_code)]
    Timed(Duration),
    #[allow(dead_code)]
    Depth(u32),
}
```

`#[allow(dead_code)]` が要ることがコンパイラの裏取り——**構築されていない**。
`create_session` の呼び出しは1箇所で引数は常に `Infinite`。

加えて検査と登録が原子でない。`ensure_no_active_session`（読みロックを取って手放す）→
`start_infinite_analysis().await` → `create_session` の順なので、2本が両方通り抜ける窓がある。

### R10-B2 写像の被覆テストが追加方向を見ていない（rust MEDIUM / comment BLOCK）

期待値 `expected_dispatch` は**本体と同じ述語を呼ぶ**ので、述語の中身を変えても両辺が同じだけ動く。
それを補うのは `covered.len() == 3` という手書きの数だけ。

**`commands()` に無いバリアントを述語へ足すと3本とも緑で通る。**
`requires_ready` に `SetOption` を足す変異（USI 的にありうる変更）がその例で、
`setoption` が起動直後の `Waiting` で積まれ、直後の `isready` に捨てられる。
**設定が1つもエンジンに届かないのに `Ok` が返る。**

`commands()` は9個で、`GuiCommand` は10バリアント。落ちている `SetOption` は本番で送っている。
doc が挙げる `Debug` / `Register` は `GuiCommand` に**存在しない**。

### R10-B3 `fail_writes` の doc が `unreachable` に付いている（comment BLOCK）

`de301fa` が `unreachable` を `fail_writes` の doc と本体の**間に**差し込んだ。
`cargo doc` は `unreachable` を「ここでやるのは3つ。詰まった印を立てて…積み置きを捨てる」と説明する。
`unreachable` は文言を1つ返すだけで、印も立てないし積み置きも捨てない。
**実際に3つやっている `fail_writes` には doc が1行も無い。**

### R10-B4 「`Closed` は2つの理由で立つ」が偽（comment BLOCK）

立てるのは EOF・詰まり・**`kill_engine`** の3箇所。`kill_engine` は `handler` を `take` する前に
`Closed` を立てるので、以降は `CLOSED`（"engine output has ended"）を返す。
**こちらが落としたのに「エンジンの出力が終わった」と説明する。**
`GONE`（"engine process has been shut down"）はこの場合のために置いてあるのに、到達しない。

### R10-H1 `analyze_with_time` は正常なエンジンでもほぼ必ず `Timeout` を返す（rust HIGH）

締切をエンジンに与えた思考時間と**同じ値**にしている。エンジンは `go` を受け取ってから
`byoyomi` ぶん考えるので、`bestmove` は必ず締切の後に届く。
打ち切っても `stop` を送らないので、エンジンは探索を続けたままリスナーだけ外れる。
`time_seconds` も無検査（`GameSettings` 側には24時間の上限があるのに）。

### R10-H2 `kill_engine` に上限が掛かっていない箇所が2つ（robustness HIGH）

`spawn` の失敗側と `shutdown_all` の `starting` ループ。どちらも r9 で足した／触った場所。
`terminate` は `KILL_TIMEOUT` で包んであるのに、こちらは裸。

`fail_writes` の doc が「このプロセスは落とせない。`kill_engine` も返らない」と
自分で書いている状態を踏むと、**`initialize_engine` が永久に返らない**。
フロントは `phase: "initializing"` に貼り付き、エラーも再試行の枝も無い。

`shutdown_all` 側は `starting` のループが `processes` より**前**にあるので、
1つ詰まると `SWEEP_TIMEOUT` を丸ごと食い、**登録済みのエンジンに一度も手が届かない**。

### R10-M1 flush の順序は「別スレッドのタスク」に対して守られていない（rust MEDIUM）

「await 点を作らない」が防ぐのはこのタスク自身が譲ることだけ。`stop()` は別タスクで、
runtime は multi_thread。flush が `pending` を手放してから `writer.send` に到達するまでの間に丸ごと走りうる。

### R10-M2 `spawn` にどちらの台帳にも載っていない瞬間がある（rust MEDIUM）

`forget_starting` と `processes.insert` の間。順序を逆にすれば消える。
`shutdown_all` の後に `spawn` が始まる経路も、落とす者が居ない。

---

## 数と一意性の棚卸し（comment が全件挙げた）

`src-tauri/src/engine/**` と `docs/state-transitions/**` に **38件**。うち**偽が5件**。

| 場所                            | 断言                                     | 状態                             |
| ------------------------------- | ---------------------------------------- | -------------------------------- |
| `protocol.rs:33` / `:664`       | `Closed` の理由は2つ                     | **偽**（3つ）                    |
| `protocol.rs:421`               | 上限はここだけ                           | **偽**（8行下の本文が否定）      |
| `protocol.rs:1199` / `:1213`    | `covered.len() == 3`                     | 削除方向しか見ない               |
| `game-session.md:163`           | 上限は**全ての** `send_command` に掛かる | **偽**（`Queue` は列に入らない） |
| `failure-surfacing.md:45/83/84` | `set_error` は9箇所 / ×1 / ×8            | **偽**（10箇所 / ×2 / ×8）       |
| `game.md:101`                   | 9−2=7                                    | **偽**（10−2=8）                 |

**`failure-surfacing.md:57` は同じ表の12行下で「呼び出し箇所の数は書かない」と決めている。**
自分で決めた規則を同じ画面の中で破ったまま、数が腐った。

残り32件は現時点で真だが、**機械に支えられているのは4件だけ**。

---

## その他

- `report_dropped` の「書き込みに失敗したコマンドも届いていない」が、
  同じファイルの `WRITE_TIMEOUT` の doc（「届くかもしれない」）と矛盾（comment HIGH）
- `TimeLimit::validate` の doc が7行の間で「4つ」と「数はここに書かない」を両方言っている（comment HIGH）
- `rust-types.ts` の `TimeLimit` に TSDoc が2枚。**r9 は置き換えたつもりで足しただけ**（comment HIGH / robustness MEDIUM）
- `the_watchdogs_are_ordered` が固定した関係は、r9 自身が「偽」と認定したもの
  （`WRITE_TIMEOUT` は `send_command` の上限ではない）。散文の数も残っている（robustness MEDIUM）
- `bypasses_draining` に `IsReady` を足した**結果**が doc に無い。
  掃きの最中に `isready` が通ると、`Ok` を返した積み置きが捨てられる（robustness MEDIUM）
- `comment_history` は読めなかったファイルを「違反0」と数える（`unwrap_or_default`）（robustness MEDIUM）
- `unreachable()` は「到達しない」と読める名前（comment MEDIUM）
- `engine::types::Duration` が `std::time::Duration` と同名（comment MEDIUM）
- テスト名に数が埋まっている（`the_three_ways` / `the_four_ways`）（comment MEDIUM）
- doc が指す行番号が実物とずれている（`engine.md` / `analysis.md`）。**行番号は誰も検査していない**（comment MEDIUM）
- `Runner.app: Option<AppHandle>` の `None` が何を意味するか書かれていない（comment MEDIUM）
- `ReadyState::Waiting` の doc が生成直後の値を説明できていない（rust MEDIUM）
- `lib.rs` の終了予算の算術が散文で、`WRITE_TIMEOUT` を `quit` の上限として使っている（rust MEDIUM）

---

## 収束の見通し

件数: 20 / 17 / 16 / 15 / 16 / 20 / 20 / 20。**8ラウンド減っていない。**

だが r10 で**対象が有限の一覧になった**。comment が挙げた38件が、この観点の全量。

**r10 の方針: 一覧を消し切る。**

1. 偽の5件を直す
2. 機械に支えられていない32件を、消すか、数を持つ側（定数・`match`・テスト）を指すだけにする
3. `comment_history.rs` を落とし、足りない語を TS 側へ移す。1つの規約は1本の検査に持たせる
4. 写像の被覆を `GuiCommand` のワイルドカード無し `match` で型に持たせる

## 見ていない範囲

3人とも共通:

- **実機のエンジンを1つも起動していない。macOS の Cmd+Q も試していない**
- 対局のフロント UI は存在しない

個別:

- `session.rs` の `run_loop` 本体と `on_search_outcome` のコメント
- `game-session.md` の `E1`〜`E18` × `G0`〜`G2` の全セル（r7 から4ラウンド持ち越し）
- `failure-surfacing.md` の F-1〜F-18 と G-1〜G-9
- `docs/state-transitions/` の他の表
- 持ち越し（H-6 / R2-H5 / M-3 / M-6 / M-7）

## 3人が「見たが問題が無かった」と明記した範囲

- `spawn` の失敗と `shutdown_all` の**二重 kill は起きない**（`take()` が `None` を返す）
- `forget_starting` の `Arc::ptr_eq` は正しく1件だけ外す
- `spawn_players` の巻き戻しは正しい
- `dispatch_for` の写像は全域を回り、R9-B2 の穴は塞がっている（**削除方向については**）
- `analyze_with_depth` の `stop_sent` は正しく1回に絞れている
- `engine/` の非テストコードに `unwrap()` / `panic!` は無い
- ロックの取得順に環が無い。`MutexGuard` を `.await` にまたがせている箇所も無い
- `clock.rs` は `saturating_*` で統一され、3箇所の式が一致している
- USI への改行注入は塞がれている。外部プロセスの引数はシェルを経由しない

---

## 修正計画

### 第0群: 一覧を消し切る

1. 偽の5件（`Closed` の理由 / 上限の在り処 / `send_command` の上限 / `set_error` の件数 ×2）
2. 機械に支えられていない数を、消すか機械へ移す
3. 写像の被覆を型に持たせる（`GuiCommand` のワイルドカード無し `match`）

### 第1群: 実害

4. **R10-B1** `ensure_no_active_session` を原子にし、3つの入口が全部席を取る
5. **R10-H1** `analyze_with_time` の締切を「与えた時間＋猶予」に。`stop` を撃つ。上限を入れる
6. **R10-H2** `kill_engine` の2箇所に `KILL_TIMEOUT`。`starting` と `processes` の順序
7. **R10-B3** doc の付け替えを戻す
8. **R10-B4** `unreachable()` に `GONE` を足す
9. **R10-M1** flush の順序を構造で守る
10. **R10-M2** `spawn` の登録順

### 第2群: 検査の整理

11. `comment_history.rs` を落とし、語を TS へ移す

### 第3群: doc

12. 残り

## 結果

11コミット。`npm run verify` / `npm run verify:rust` とも green。

| 所見       | 直した内容                                                                         | コミット  |
| ---------- | ---------------------------------------------------------------------------------- | --------- |
| **R10-B1** | `take_session` / `release_session` が検査と登録を1つの write ロックで済ませる      | `7f9ee22` |
| **R10-B2** | `expected_dispatch` を述語から切り離し、`kind_of` の `_` 無し `match` で被覆を型へ | `af23ba6` |
| **R10-B3** | `fail_writes` へ doc を戻し、`cannot_reach` に自前の doc を付けた                  | `db5b4de` |
| **R10-B4** | `killed` を分けて立て、優先順を `cannot_reach_text` に集約。文言をテストで固定     | `db5b4de` |
| **R10-H1** | 締切を「与えた時間＋猶予」に。当たったら `stop` を撃つ。考慮時間に上限             | `5285ea1` |
| **R10-H2** | 上限を `kill_engine` の中へ閉じ、裸で呼ぶ口を無くした                              | `568e22b` |
| **R10-M1** | `enqueue_write`（同期）を切り出し、キューのロックを握ったまま列へ入れる            | `7be845c` |
| **R10-M2** | `processes.insert` → `forget_starting` の順へ                                      | `568e22b` |
| 棚卸し     | 偽の5件を含む散文の数を、落とすか、数を持つ側を指す形にした                        | `4047862` |
| 検査の整理 | `comment_history.rs` を落とし、語を TS 側へ移した                                  | `09b6cec` |
| doc        | 状態遷移表の行番号32件を落とし、同じ形が入らないよう機械で止めた                   | `13b1d51` |
| doc        | `Runner.app` の `None` はテストのときだけ、と書いた                                | `e1b3d00` |

### 直し方を変えたもの

**R10-H2** は所見が「2箇所に `KILL_TIMEOUT` を掛ける」だったが、掛けなかった。
呼び出し側に上限を置く形は、包み忘れた口が1つできるだけでそこが行き止まりになる。
上限を `kill_engine` の中へ移し、裸で呼ぶ口を作れなくした。

**R10-M1** も「`pending` のロックを跨いで持つ」ではなく、`enqueue_write` を
**同期の関数**に切り出した。同期の関数の中には await 点を作れないので、
順序が保たれる理由が規律から型へ移る。

### 足した機械

- `the_exempt_list_points_at_real_lines`（`timeout_result.rs`）——
  行番号で書いた免除がずれても誰も見ない。実際 `engine/registry.rs:229` が
  死んだまま残っていた
- `行番号で指していない`（`docsSourcePaths.test.ts`）——
  行番号は無言でずれる。ずれたことに気付く者がいないので死んだパスより悪い

### 変異で確かめたもの

| テスト                                                     | 当てた変異                               | 落ちた |
| ---------------------------------------------------------- | ---------------------------------------- | ------ |
| `the_dispatch_map_is_total`                                | `requires_ready` に `SetOption` を足す   | ✓      |
| `who_stopped_the_engine_is_not_flattened_into_one_message` | `killed` と `stalled` の優先順を入れ替え | ✓      |
| `a_time_only_analysis_is_never_cut_short_by_depth`         | `reached_depth(_, None)` を真に          | ✓      |
| `the_target_depth_itself_counts_as_reached`                | `>=` を `>` に                           | ✓      |
| `the_exempt_list_points_at_real_lines`                     | 免除の行番号をずらす                     | ✓      |
| `行番号で指していない`                                     | doc に行番号を1つ戻す                    | ✓      |

### 自分で作った退行

- `take_session` を入れたとき、`analysis.md` が `ensure_no_active_session` を
  指したまま残った。`docsIdentifiers` がコミットを止めた
- `lib.rs` のコメントを1行増やしたとき、`timeout_result` の免除の行番号がずれた。
  これも機械が止めた
- `new_session_id` が種類しか見ていなかったので `Timed` / `Depth` の payload が
  dead code になり、clippy が2件警告した。席の名前に条件まで出す形にして解消
