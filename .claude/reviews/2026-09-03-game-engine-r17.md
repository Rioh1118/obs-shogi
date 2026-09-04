# 対局エンジン レビュー ラウンド17

- 日付: 2026-09-03
- 範囲: `src-tauri/src/engine/game/**` / `commands/game.rs` / `protocol.rs` / `registry.rs` /
  `state.rs` / `src-tauri/tests/**` / `src/entities/game-session/**` /
  `docs/state-transitions/{game-session,failure-surfacing}.md` / ADR-0008
- 範囲外: `analyzer.rs` / `bridge.rs` の中身（フロントに呼び手が0 → #371）
- 観点: robustness / rust / comment / architecture の4本を並列

---

## 構造（architecture）

### R17-H1 段の検査が `use super::super::` を1本も見ておらず、その綴りは既に repo にある

`src-tauri/tests/engine_layering.rs:176-207`（`imports_of` / `reaches_outside`）。

`imports_of` は先頭の識別子を1つ取るだけなので、`use super::super::state::AppState` は
`is_top_level=false` の場所では**何も返さず**、`is_top_level=true` の場所では
`"super"` という段に無い名前を返す。`dependencies_only_point_downwards` は
`layer(&to).is_none()` で捨て、`find_cycle` は `"super"` に出辺が無いので止まらない。
`reaches_outside` は `use crate::` で始まる行しか見ない。

筋道: `game/session.rs`（段5）に `use super::super::state::AppState;` を1行足すと、
ADR-0008 が「`AppState` を受け取るのは `commands` だけ」と書いた不変条件が
**4つの検査すべて緑のまま**破れる。`super::super` は正しい綴りで、
`session.rs:1683` に `use super::super::events::{...}` という**前例がある**。

さらに `analyzer.rs` から `use super::super::CLOSE_TIMEOUT;` は `crate::CLOSE_TIMEOUT` と
同じものを指すのに拾われない——`the_engine_does_not_reach_out_of_itself` の doc が
名指しした退行の再来経路そのもの。

**r16 の変異は拾える側の綴り（`use crate::engine::state::AppState`）しか試していない。**

### R17-M1 `engine/mod.rs` が段の表の外にあり、両段が共有する上限の置き場になっている

`engine_layering.rs:216-218` が `module == "mod"` を `continue` するので、
`engine/mod.rs` は graph に from としても to としても現れない。そこに
`pub const USI_OK_TIMEOUT` / `READY_TIMEOUT` があり、`analyzer`（段6）と
`game`（段5）の両方が読んでいる。同種の判断である `WRITE_TIMEOUT` は
`protocol`（段3）にあるので、**同じ種類の上限が段の上と外に割れている。**

`mod.rs` に `pub fn f(state: &crate::engine::state::AppState)` を置いて
`protocol.rs` から `use super::f;` で呼ぶと、段3が段8に届く経路が4検査とも緑で通る。

### R17-M2 `abort` を上限で包んで3通りに分類する判断が、逐語で2箇所にある

`manager.rs:78-86` と `session.rs:361-367` が同じ4行（文言も同じ、`target` だけ違う）。
`CLOSE_ABORT_TIMEOUT` が `pub` で出ているのは、この重複を成立させるためだけ。

`GameSession::abort()` の失敗の種類を増やすと、片方だけ分類が増える。古いまま残るのは
`manager.rs` 側で、そこは `Arc` が2本要るのでテストが踏みにくい。

### R17-M3 `may_use` の32辺のうち7辺に実体が無く、`commands` の表が `commands/mod.rs` の doc より広い

実体が1本も無い辺: `registry→utils` / `bridge→protocol` / `state→types` /
`state→analyzer` / `commands→protocol` / `commands→registry` / `commands→bridge`。
逆（実体があって表に無い辺）は0本。

効くのは `commands→protocol` と `commands→registry`。`send_usi(state, engine_id, line)` を
`commands/game.rs` に足して `registry.get()` → `send_command()` と書くと、
`bridge` も `game` も通さずに USI の1行がフロントの語彙になる。4検査とも緑で、
`commands/mod.rs` の「判断を書かない」に反していることを止めるものが無い。

### R17-M4 `GameManager` と `EngineRegistry` の対応が型に無く、外れると黙って漏れる

`GameSession::start` は `registry` を値で受けて**保持しない**。落とすときは
`close(self, registry: &EngineRegistry)` で改めて受け直す。`EngineRegistry::shutdown` は
知らない ID を `debug` 1行で**成功扱い**にする。

別の台帳を渡すと、対局は台帳から消え、プロセスは誰からも参照されずに残る。
`Result` も `warn` も出ない。**r1 の M-11 が16ラウンド未着手。**

### R17-M5 ID がすべて素の `String` で、取り違えが両側で黙って通る

TS は `submitGameMove(usiMove, side, gameId)` と書いても tsc が通る。通ると Rust は
`unknown game: 7g7f` を返し、`log_rejection` が warn を1行出して終わる——
盤は裁定できないまま止まり、30秒後に「アプリが裁定を返さなかった」で `Aborted`。

Rust 側は `GameId` と `EngineId` が同じ `String` なので `registry.shutdown(game_id)` が
型検査を通る（そして上のとおり成功で返る）。

**この repo は同じ取り違えを `KifuCursor` / `CursorKey` で型に落として止めた前例を持つ。**
r1 の M-16 が16ラウンド未着手。

### R17-M6 「解析側と同じ」と書いた絞りの間隔が、何にも紐付いていない

`commands/game.rs:53-54` の `EMIT_WARN_INTERVAL` が「解析側（`bridge`）と同じ」と
断言しているが、対する `bridge.rs:242` は名前を持たない裸の `Duration::from_secs(5)`。
`bridge.rs` を30秒に変えてもコメントは嘘になったまま緑で通る。

### R17-M7 `entities/game-session` は Rust と1対1だが、それを保つものが人間の注意しかない

245行の型が、**tsc からも vitest からも `cargo test` からも触られていない**
（`src/` 全体で `game-session` を import しているファイルは0）。

Rust の `GameSettings` に `#[serde(default)]` の無い欄を1つ足すと、
`the_wire_shape_is_camel_case_all_the_way_down` は名指しの欄しか見ないので緑、
TS は誰も import していないので tsc も緑。初めて画面を繋いだ人が実行時の
deserialize エラーで詰まる。

### R17-M8 `AnalysisResult` を Rust は段1から共有し、TS は隣のスライスへ横に取りに行っている

Rust は `game`（段5）と `analyzer`（段6）が同位なので、両方が要る型を段1へ**下げて**
共有している。TS は同じ型を `entities/engine`（同層の別スライス）から横に取っている。
lint は上位レイヤしか禁じないので止まらない。

`ADR-0007` が `engine/types.rs` を snake_case 据え置きの例外にしているが、
その注記は借り手（`game-session/api/rust-types.ts`）にある。

### 確認したこと（所見ではない）

- ADR-0008 の「まだ逆転していない境界」3つは、いま全部その状態のまま。記述は現物と合う
- `game/` に `use tauri::` は0本（`grep` が出す6行は全部コメント）
- TS と Rust のコマンドは1対1（対局9本）。型の全欄も省略可否まで一致
- 実際の依存グラフに、段の表に反する辺は1本も無い。環も無い

---

## 失敗経路（robustness）

### R17-B1 `accept_continue` の検算は「直前の手より前の食い違い」を原理的に検出できない

`session.rs:731-749`。見ているのは**末尾1手・長さの偶奇・各手の書式**の3つだけで、
`self.moves`（直前の局面）との突き合わせが1行も無い。

筋道: `initial_moves` を偶数個持つ途中局面から始め、フロントが `continue_game` に
「対局開始以降の手だけ」を渡す。末尾は直前に決まった手なので通る。偶奇も変わらないので通る。
書式も通る。`self.moves` が黙って短い列に差し替わり、次の `spawn_search` は
**根の局面に途中の手を継ぎ足した別局面**をエンジンへ送る。エンジンはその局面の合法手を返し、
フロントは現局面で非合法と裁定する——**エンジンが指してもいない手で反則負けする。**

`hand_turn_to` の `PonderHit` 判定も `ponder_move == last_move` しか見ないので、
履歴が食い違ったまま `ponderhit` が飛ぶ。

※3 は「確かめないと、食い違いに気付く経路がどこにも無くなる」と書いているが、
いま書かれている検算はその食い違いを捕まえられない。

正しい列は `self.moves + [usi_move]` の1つに定まる。長さと接頭辞で見れば、
`moves.len()` の上限も自然に効く（現状は無制限で、巨大な列がそのまま `position` 1行になる）。

### R17-H7 `info` を出さないエンジンは、正常でも30秒で `engineFailure` にされる。逃げ道が無い

`session.rs:149-157`。`silent_for` を進めるのは `begin_turn` と `on_search_info` の2箇所だけで、
後者は `info` 行が来たときにしか呼ばれない。

筋道: `info` を1行も吐かない USI 実装（詰将棋ソルバ、自作の最小エンジン、depth 更新でしか
`info` を出さないエンジン）を対局者に選ぶと、**正常に読んでいる31秒目で
`EngineFailure` / `"the engine did not answer in time"` になる。** 相手に勝ちが付き、
棋譜にその英文が残る。`enforce_engine_timeout` はこの番人を見ない（doc がそう明言している）ので、
**利用者が無効化する手段が設定にも API にも無い。**

### R17-M20 `submit_game_move` が、指されなかった手に `Ok` を返す

`session.rs:701-715` / `1046-1062` / `648-655`。人間の持ち時間が尽きるのと着手が届くのが
同じ tick に入ると、`decide_move` は `finish(Timeout)` して `MoveDecided` を出さずに戻る。
にもかかわらず `accept_human_move` は `Ok(())` を返す。

しかも `finish` は `Over` を先に emit してから返事を送るので、**フロントには `over` が先に届き、
その後で `submitGameMove` の promise が `Ok` で解決する。** `await submitGameMove(...)` の後に
棋譜へ積む素直な実装は、終局後の棋譜に指されていない手を1手足す。

※1 は「その手は指されなかったものとして扱う」と書いているが、その事実が呼び出し側へ返る経路が無い。

### R17-M21 `a_bestmove_after_the_game_ended_still_gets_a_gameover` は、doc が防ぐと書いた変異で落ちない

`session.rs:2618-2655`。doc は「`Phase::Over` の早期 return を `match` より後ろへ動かすと
ここが飛ばなくなる」と書いているが、表明は `activity` が `Idle` になることだけ。

`activity` を `Idle` に落とすのは `session.rs:865-874` で、**早期 return（`:879`）より前**。
動かしても代入は動かない。移した後は `SearchOutcome::Move` の腕へ入り、
`if !self.is_to_move(side) { return; }`（`:946`）で戻るだけ——`send_gameover` は呼ばれず、
しかし表明は通る。**doc が名指しした変異を1つも捕まえない。**

同じ形が `ending_the_game_tells_the_app_before_it_tells_the_engines` にもある。
名前は「エンジンより先にアプリへ知らせる」だが、`finish` の中の emit と `send_gameover` ループを
入れ替えても通る。

### R17-M22 ※10 の「踏めている／踏めていない」が `(G2, E7)` と `(G2, E8)` で逆

`game-session.md:238-244`。`(G2, E7)` は `a_bestmove_after_the_game_ended_still_gets_a_gameover` が
`runner.phase = Phase::Over` を置いて踏んでいる。`(G2, E8)` を踏むテストは無い——
3本とも `Phase::Thinking` から始まる `(G0, E8)`。

※10 は「次にどのセルを埋めるか」を決めるために読まれるので、逆だと
**既に踏んだセルにもう一度テストを書き、空いたセルは空いたまま残る。**

### R17-M23 `stalled_turn` の doc が、先読みを外している理由として存在しない値を挙げている

`session.rs:117-118` が「先読み中は `TurnClock` が相手側の手番を指している」と書いているが、
`TurnClock`（`:551-562`）は `Running(Instant)` / `Settling(Instant)` の2値で**側を持たない。**

実際に外しているのは `on_tick`（`:986-998`）が `Phase::Thinking { side }` の側だけを渡すこと。
doc を信じて「`stalled_turn` に側を渡すのをやめてよい」と読むと、先読み側の `info` は
`is_to_move` で落ちるので `last_progress` が進まず、**正常に先読みしているエンジンが
毎手 `engineFailure` で落ちる。** ここは R13〜R16 で4回触られている。

### R17-M24 `start_game` に全体の上限が無く、取り消す口も無い

`commands/game.rs:26-44` / `session.rs:256-300`。待つ上限は段ごとに分かれている
（`SPAWN_TIMEOUT` 10s + `USI_OK_TIMEOUT` 30s + `READY_TIMEOUT` 120s）が、全体を包む
`timeout` は無く、取り消し用のコマンドも登録されていない。

`EvalDir` を1文字間違えて `readyok` を返さなくなったエンジン（F-27 が「最も起きやすい」と
書いている形）を指定すると、**`ensure_ready` が120秒返らない。** 2体目でも同じことが起きうるので
`Err` までに5分を超える。`startGame` の doc の「数十秒かかる」も実際の上限と合っていない。

---

## Rust

### R17-H8 `production_unwrap.rs` の走査が、`#[cfg(test)]` の後ろの**本番コードを丸ごと消す**

`src-tauri/tests/production_unwrap.rs:43-80`（`strip_test_modules`）。
`#[cfg(test)]` の後ろが塊でなくても「次の `{`」を探して括弧の釣り合いで削る。

実測: `protocol.rs` の `#[cfg(test)] const ALL: &'static [$name] = ...;` はブロックを持たないので、
走査は先にある `closed_set_enum! {` の `{` を開始点に取り、`protocol.rs:174-199` まで削る。
**`enum ReadyState` の宣言ごと消えている。** そこに `.unwrap()` を書いても緑で通る。
`file_system/mod.rs` でも `#[cfg(test)] pub(crate) use ...;` が次の `pub use mv::{...};` を飲む。

**`#[cfg(test)]` を `use` / `const` / `type` に付けるのはごく普通の書き方**なので、
この穴は今後書かれる場所ごとに増える。`the_scanner_still_sees_production_code` は
総文字数 >100_000 と2つの綴りしか見ないので落ちない。

違反の行番号も**削った後の文字列**で数えているので、`#[cfg(test)]` 塊より後ろの
`path:line` は現物とずれる。

### R17-H9 `start_game` がパスを受けるのに `root_guard.rs` の走査から丸ごと消えている

`commands/game.rs:26-44` / `root_guard.rs:48,58-83`。`takes_a_path` は署名の字面しか見ないので
`false`、`STRUCT_CARRIED_PATH` の3件にも入らない。実測で `path_taking` は16件、`start_game` は入らない。

`engine_path` は `canonicalize` + `is_file` を通って `Command::new().current_dir().spawn()` へ。
同じ能力を持つ `initialize_engine` は理由付きで `EXEMPT` に載っているのに、`start_game` は
**その判断の記録がどこにも無い。** `work_dir` に至っては `canonicalize` も存在確認も無く、
そのまま子プロセスの cwd になる。`every_listed_name_is_a_real_command` は綴り間違いを拾うが、
**載せ忘れは拾わない。**

（comment 側の R17-M19 と同じ場所。1つとして直す）

### R17-M25 `engine_layering.rs` の `use` 走査が、**折り返された波括弧**を1件も拾わない

`engine_layering.rs:156-173`。`rest` はその1行なので、`use crate::engine::{` で行が終わると
`inner` が空文字列になり、返るのは空集合。

**rustfmt は100桁を超える `use` を自動でこの形に折る**ので、依存が増えたモジュールほど
検査から外れる——段の違反が起きやすい側で先に穴が開く。
モジュール冒頭の doc は「波括弧を落とすと、書き方ひとつで段を跨げる」と書いているが、
塞げているのは1行に収まる波括弧だけ。

（R17-H1 の `use super::super::` と同じ関数の穴。まとめて直す）

### R17-M26 `engine_timeouts.rs` の2本が、桁が違いすぎてどの変異でも落ちない

`engine_timeouts.rs:25-34,41-48`。`CLOSE_TIMEOUT`（4s）< `MAX_TIME_MS`（24h）+ `HARD_TURN_LIMIT`。

`HARD_TURN_LIMIT` を600秒から31秒に下げても、`CLOSE_TIMEOUT` を1時間に上げても緑のまま。
実際に固定できているのは `CLOSE_TIMEOUT < MAX_TIME_MS` という、doc が主張しているのとは別のこと。
`the_close_budget_is_deliberately_short` も 4s < 16s で、15秒にしても通る——
**「合わせに行かない」を式で持つ、が効いていない。**

### R17-M27 `HARD_TURN_LIMIT` の doc が書いている上限が、実際の上限ではない

`session.rs:88-93` が「実際に待つのは最大で `MAX_TIME_MS`（24時間）＋これ」と書いているが、
`stalled_turn` が足すのは `budget_ms` = `remaining_ms + byoyomi_ms` で、`remaining_ms` は
`consume` が着手のたびに `increment_ms` を**足す**（`clock.rs:105`）。

「10分＋10秒フィッシャー」で1手1秒で300手指せば `remaining_ms` は45分近くまで**育つ**。
`main_ms = byoyomi_ms = MAX_TIME_MS` なら48時間＋10分。
`TimeLimit::validate` は各欄が `MAX_TIME_MS` 以下かだけを見て、合計も累積も見ない。

doc の「短くしたいなら `MAX_TIME_MS` を変えること」も、1欄ごとの上限なので効かない。

### R17-M28 `CLOSE_POLL` の doc が古い値で回数を数えている

`session.rs:221-230` が「6秒で最大120回」と書いているが、ループの予算は
`CLOSE_IDLE_TIMEOUT` = **10秒**。`6175b04`（R13）で6秒から動いたときに取り残された。
現物は 10秒 / 50ms = 最大200回。

この doc は「`run_loop` を要求で埋めない上限」という**安全側の根拠**として数を書いている。

### R17-M29 指し手列の長さに上限が無く、そのまま `position` 行とエンジンの stdin へ流れる

`session.rs:1552-1583` / `:718-777`。持ち時間は `MAX_TIME_MS` で厳密に弾く一方、
`initial_moves` と `moves` は1手ずつの形だけを見て**要素数を見ていない。**

10万手を渡すと `position_argument` が約900KB の1行を組み、`check_writable` が
`to_string()` でもう1本作り、`push_pending` がさらに `clone` する。積み置きは32件まで許される。
書き込みは `WRITE_TIMEOUT`（2秒）で切れて `fail_writes` が走り、以後何も送れなくなる——
対局は `EngineFailure` で終わるが、**理由は「the engine stopped reading stdin」としか出ない。**

時間の欄だけ厳密に弾いてここが素通りなのは、`MAX_TIME_MS` の doc の方針と揃っていない。

### `cargo test --tests` は green であることを確認したうえでの所見

（rust reviewer が実際に走らせている）

---

## 見ていない範囲（4人の申告をまとめたもの）

- 実プロセスを使った動作確認。**`run_search` の第1相→第2相の遷移と `protocol` の
  積み置き掃き出しの実際の並びを見た結合テストは、リポジトリに1本も無い**
- `analyzer.rs` / `bridge.rs` の中身（#371）。`EngineRegistry` を跨いだ相互作用は片側だけ
- フロント側の購読タイミング、裁定が `RULING_TIMEOUT` 以内に返るか
- `docs/state-transitions/game-session.md` の57セル（r14 が済ませたものとして踏襲、
  ただし今回 `(G2, E7)` / `(G2, E8)` の食い違いが出た）
- `protocol.rs` の `start_listening` / `ensure_ready` の世代管理 /
  `discard_pending`（**5ラウンド続けて未読**）

---

## コメント・doc

### R17-H2 台帳 F-28「ログには1行も残らない」が、その F-28 を引いて足したコードと矛盾している

`failure-surfacing.md:100`。commit 順が `7f01fc1`（doc 修正）→ `c6d580f`（`log_rejection` 追加）で、
**同じラウンドの中で自分が偽にした。** `log_rejection` の doc は「→ 台帳の F-28」と
その行を引いているのに、引かれた側は「1行も残らない」と言い続けている。

6コマンドのうち `get_game_state` 以外の5つは `warn` を残す。
この表は「直したのに行が古いままなら、この表は台帳として嘘をつく」を自分の契約に掲げている。

### R17-H3 台帳 F-19「`warn` のみ」が、終局の扱いを変えた後も更新されていない

`failure-surfacing.md:91`。**これも同じラウンドの自傷**（`7f01fc1` → `e516f13`）。
`over` は `warn` ではなく `error` で、throttle を通らない。

筋道: 運用で `warn` だけを拾う設定にすると、**いちばん拾いたい `over` の失敗**
（＝画面が 00:00 で静止する原因）だけが落ちる。

### R17-H4 `EXEMPT` の doc が「いまは空」と書いているが13件入っている

`src-tauri/tests/comment_identifiers.rs:44-87`。doc ブロックが2つ融合していて、
`いまは空` の段落と `このリポジトリの外にある綴り。` の段落が連結している。

読んだ人はこの検査が**免除ゼロで回っている**＝それだけ厳しい、と見積もる。
実際は13件（`is_a` のような短い綴りまで含む）。
**この doc 自身が「検査がどれだけ緩いかを読み手が測れなくなる」ことを問題として挙げている。**

### R17-H5 `serde_naming.rs` が「いま起きている食い違い」として挙げる例が、現物では起きていない

`src-tauri/tests/serde_naming.rs:7-8` が「`AnalysisUpdate` が `session_id` で出しているのに
`events.ts` が `payload.sessionId` を読んでいる」と書いているが、`bridge.rs:39-44` には
`#[serde(rename_all = "camelCase")]` が付いていて線に出るのは `sessionId`。一致している。

検査の存在理由として挙げられた**唯一の実例が偽**。「読み手が増えるまで無害」と
書いてあるので、実在すると信じた人が誤った方向の判断をしかねない。

### R17-H6 状態遷移表が `bridge.rs` を対局の Tauri コマンド層として指している

`docs/state-transitions/game-session.md:3-4`。冒頭の対象一覧が `bridge.rs`（Tauri コマンド）で、
末尾の「実装との対応」（`:444`）は `commands/game.rs`。**同じ文書の中で割れている。**

`:419` の「`manager.rs` / `bridge.rs` には `#[test]` が0個」も外れ。`bridge.rs` には
`#[tokio::test]` が5本ある。0個なのは `manager.rs` だけ。
`game/events.rs`（`GameEventSink` を決めている口）が対応表に無い。

### R17-M9 `(G2, E7)` を「まだ踏んでいない」と書いた doc と、覆うと主張するテストが両立していない

`game-session.md:238-241` と `session.rs:2618-2655`。doc の後半（「早期 return を動かす変更が
引っ掛からない」）は**正しい**——テストが見ているのは `A0` に戻ることだけ。
「セルは踏んでいる」と「不変条件3 は守られていない」を分けて書く必要がある。

### R17-M10 テストが自称するセル `(G2, E8)` は、実際には `(G0, E8)` を踏んでいる

`session.rs:2554-2589`。開始状態は `Phase::Thinking`。表の記法では `(G0, E8)`。
doc 側（`:243`）はこれを根拠に「`(G2, E8)` は踏めている」と書いている。

このテストの固有の価値は「`Over` の emit が `send_gameover` より先」であって、セル記号ではない。

### R17-M11 変更の経緯がコメントに残っている（6箇所）

`game/events.rs:8-9,40-42` / `session.rs:1747-1749,2560-2561` / `engine_layering.rs:4-5,198-199`。

`commentHistory` の `HISTORY_WORDS` は `だった` を意図的に外している
（「読み込み中だったら」を巻き込むため）ので、`だったころ` `持てなかった` `なっていた` が素通りする。

### R17-M12 ADR-0008 の段の表が全順序に見えるが、強制側は `game` / `analyzer` を同位として扱う

ADR:27-45 の番号付きの段は「6 は 5 を使ってよい」と読める。実際に `analyzer` から `game` を
`use` すると `dependencies_only_point_downwards` が落ちる。
`utils` の説明も ADR と `LAYERS` で既に1行ずれている。**表を2箇所に持っている。**

### R17-M13 ADR-0008「判断は1箇所に置く」の3つ目が、1つ目と同じ主語を持っている

ADR:67-71。3項目目が「先読みの `info` を落とすか」の写しになっているが、
`cannot_reach_text` は先読みとは無関係（`killed` / `stalled` から文言を選ぶ）。
**「同じ判断を2箇所に書かない」を決めている節の一覧が、写しで壊れている。**

### R17-M14 定数の値を散文に写した箇所が残っていて、どれも機械で固定されていない

`session.rs:53,186` / `registry.rs:78` / `rust-types.ts:190,200` /
`game-session.md:87,151,231`（同じ文書の `:156` が「**この表は秒数を書かない**」と宣言している）。

値はいま全部合っている。問題は動かしたときに何も落ちないこと。
`session.rs:53` は**モジュールを跨ぐ等値**を散文で主張している。

### R17-M15 `closeGame` の TSDoc が失敗の片方しか書かず、もう片方に対して誤った指示になっている

`src/entities/game-session/api/tauri.ts:65-77` が「そのまま呼び直すこと」と書いている。
未知の `game_id`（既に閉じた対局、取り違えた ID）では**呼び直しても同じ `Err`**。
書いてあるとおり実装すると無限に呼び直す導線ができる。

### R17-M16 「外に出るのは3つだけ」の断言が、同じファイルの型で破れている

`game/types.rs:1-5` と `tauri.ts:4-6`。`SetOptionValue` / `ponder` / `start_sfen` /
USI の指し手文字列は境界を越える。列挙した4つ（`readyok` / `usiok` / `position` 文字列 /
`go` のパラメータ）が出ていないのは事実なので、嘘なのは「**だけ**」の側。

### R17-M17 `shogiMoveValidator.ts` の「6メソッド」が現物と1つ違う

`game-session.md:22-24`。現物は7つ。この数は「詰み・千日手の判定はどちらにも無い（#354）」の
根拠として置かれているので、数が合わないと根拠全体が疑われる。
同じ文書は他の箇所で「数はここに書かない」を採っている。

### R17-M18 コメントは「より長い」と言っているのに、式は等値を許している

`session.rs:2486-2488` の `assert!(SEARCH_GRACE >= SETTLE_TIMEOUT)`。同じテストの他4本は `>`。

`SEARCH_GRACE == SETTLE_TIMEOUT` にすると、両方の番人が同じ tick で当たりうるので
`Stall::NotStopping` と `NotAnswering` のどちらが付くかが腕の順序に依存する——
**このテスト自身が守ろうとしている性質が崩れる。**

### R17-M19 実行ファイルのパスを構造体で受ける `start_game` が、`root_guard` の台帳に無い

`src-tauri/tests/root_guard.rs:48,58-83`。`initialize_engine` は同じ性質を
1行の理由付きで台帳に残しているのに、`start_game` はどちらの一覧にも名前が出ない
（引数名にパスが現れないので `takes_a_path` に拾われない）。

守っているのは `registry.rs:88-91` の `canonicalize` + `is_file` だけで、
その事実は `commands/game.rs` のどの doc にも書かれていない。

---

## 修正計画

（4本が揃ってから書く）

## 結果

39件すべてを処理した。**内訳は「直した 34 / issue へ送った 3 / 記述を実態に合わせた 2」。**

### 走査の穴（これが緑なので他が見えなかった）

| 所見         | どう直したか                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| R17-H8       | `#[cfg(test)]` の後ろが塊とは限らないので、`{` と `;` のどちらが先かで item の終わりを決める。落とした行は改行に置き換えて行番号を保つ |
| R17-H1 / M25 | `use` を `;` まで連結し、`super` を数えた数と `engine/` からの深さを突き合わせる。一致＝直下、足りない＝中の枝、多い＝外               |
| R17-H9 / M19 | 引数の型を辿って `*_path` / `*_dir` に届くものを拾い、`STRUCT_CARRIED_PATH` と突き合わせる検査。`work_dir` も `canonicalize` する      |
| R17-M26      | `MAX_TIME_MS` を足すのをやめ、下限（`WRITE_TIMEOUT` / `KILL_TIMEOUT`）も置く                                                           |

**2つとも単体テストを付けたら穴が出た。** `strip_test_modules` は `protocol.rs` の
26行（`enum ReadyState` ごと）を消していて、そこに `.unwrap()` を書いても緑だった。
`imports_of` は `use super::super::` を1件も拾わず、その綴りは既に repo にある。
`root_guard` は `start_game` を対象に一度も入れていなかった。
足した検査が `save_presets` の載せ忘れも拾った。

### 対局が壊れる

| 所見    | どう直したか                                                                                |
| ------- | ------------------------------------------------------------------------------------------- |
| R17-B1  | 「いまの写し＋決まった手」を長さと接頭辞で検算する。偶奇の検算は冗長になるが残す            |
| R17-M29 | `MAX_PLIES`（2000）を `validate_settings` と `accept_continue` に置く                       |
| R17-H7  | 沈黙は `has_spoken` のエンジンにだけ掛ける。記録は**落とす前**に取る                        |
| R17-M20 | `decide_move` が採ったかを返し、`Ok` の意味を「`MoveDecided` が出た」に揃える               |
| R17-M24 | `START_TIMEOUT`（90秒）。**`timeout` で包まない**——包むと台帳に載ったプロセスの ID が消える |

### 構造

R17-M1（`mod.rs` の定数を `protocol` へ／表の外に置けなくする検査）、
R17-M2（`abort_within_budget` に集約）、R17-M3（実体の無い7辺を落とし、検査を足す）、
R17-M4（`GameManager` が `Arc<EngineRegistry>` を持つ）、
R17-M5（`GameId` は brand / newtype）、R17-M6（`EMIT_WARN_INTERVAL` を `utils` へ）、
R17-M7（`include_str!` で TS の写しを突き合わせる）。

### doc

R17-H2 / H3（**同じラウンドの中で自分が偽にした2行**）、H4、H5、H6、
M9〜M18 をすべて現物と突き合わせた。書き換えた台帳の8行に測定日を添えた。

### issue へ送ったもの

| 所見                 | 送り先 | 理由                                                                   |
| -------------------- | ------ | ---------------------------------------------------------------------- |
| R17-M21              | #377   | `gameover` を観測する継ぎ目が無い。作るには `UsiProtocol` の逆転が要る |
| R17-M8               | #378   | `entities/engine` を触る。この PR は対局側に絞っている                 |
| R17-M5 の `EngineId` | #379   | `analyzer` / `bridge` に波及する（#371 の面）                          |

### 記述を実態に合わせたもの（直さずに書き換えた）

- **R17-M21 の2本のテスト**。doc が「防ぐ」と書いた変異を捕まえていないのは事実だが、
  捕まえるには継ぎ目が要る（#377）。doc から過大な主張を落とし、
  「セルは踏んでいるが不変条件3 は未検証」を表と doc の両方に書いた
- **R17-M22 の `(G2, E7)` / `(G2, E8)`**。踏めている／いないを入れ替えた

### 自分が作った退行

- **R17-H2 / H3。** 台帳を先に直してからコードを変えたので、`7f01fc1` の2行が
  `c6d580f` と `e516f13` で偽になった。順序が逆だった

### 変異で確かめたもの

- `strip_test_modules` の `;` 分岐を外す → 塊でない `#[cfg(test)]` の後ろが消える
- 改行の置き換えを外す → 行番号が詰まる
- `session.rs` / `analyzer.rs` に `use super::super::X` を1行足す → 3検査が落ちる
- `start_game` を `STRUCT_CARRIED_PATH` から外す → 載せ忘れの検査が落ちる
- `HARD_TURN_LIMIT` を3秒 / `CLOSE_TIMEOUT` を1秒 / `SWEEP_TIMEOUT` を1秒 → 3本が落ちる
- 接頭辞の検算を外す / `MAX_PLIES` の検算を外す → それぞれ落ちる
- 沈黙の腕から `has_spoken` を外す / 落とした `info` を記録しない → それぞれ落ちる
- `remaining` を外す → 断る理由が締切から起動の失敗に変わる
- `accept_human_move` が `Ok` を返す → 落ちる
- `GameSettings` の欄の綴りを変える → TS の写しの突き合わせが落ちる

### 検証

`npm run verify`（660 tests）/ `npm run verify:rust` ともに green。
