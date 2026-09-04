# 対局エンジン レビュー ラウンド23

- 日付: 2026-09-03
- 範囲: ラウンド22と同じ（`src-tauri/src/engine/` と `src-tauri/tests/`、`src/entities/game-session/`、`docs/state-transitions/`）
- 範囲外: `analyzer.rs` / `bridge.rs` の中身（#371）
- 観点: rust / comment / architecture / robustness の4本。**変異試験を許したのは rust の1本だけ**
  （他3本には書き込み禁止を明示した。ラウンド17で並行実行が観測を汚染したため）

**所見13件。数は 39 → 27 → 21 → 24 → 31 → 11 → 13。**

うち**4件はラウンド22の修正が作った退行**（H1 / H2 は「直した結果、逆向きの同じ嘘になった」、
H3 / M1 は「足した機構と足した doc が、その場で現物とずれた」）。

---

## 表とテストの食い違い（3ラウンド連続）

### R23-H1 ラウンド22の直しが向きを間違え、実在するテストを「無い」と言う doc になった

`docs/state-transitions/game-session.md:285-286` と `:477`。

`4d915c9` はこう書き換えた。

```
-`(G2, E1)` は踏めていない（E1 / E4 の `is_engine` の枝は踏んである）。
+`(G2, E1)` も、E1 / E4 の「エンジン側を人間として撃つ」枝も踏めていない
+（`this side is played by an engine` を確かめるテストが無い）。
```

**変更前が正しく、変更後が偽。** `session.rs:3501` の
`a_seat_played_by_an_engine_refuses_human_moves_and_resignations` が
`（表の E1 / E4）` と自分で書いたうえで両方の `Err` を表明している。

rust が変異で確認: `accept_human_move` の `is_engine` を削ると FAILED（削除前は ok）。

**取り違えの原因は測り方。** `"this side is played by an engine"` の綴りで grep したが、
テストは `expect_err` だけで文言を見ていない。robustness も同じ grep で同じ結論に達している
——**同じ道具を使えば同じ嘘に着く。**

読んだ人が「未検証だから落ちない」と判断して `is_engine` を消すと、エンジンの席に人間が指せる。
エンジンは `go` を出したまま別の局面の `bestmove` を返す。

### R23-H2 `E16` のテスト列 `✗` が、その `E16` を名指ししているテストと正反対

`game-session.md:125`（表）と `:103`（`✗` の定義＝「踏むテストが無い」）。

`session.rs:3828` の `info_from_a_stopped_search_is_not_shown` は
`（表の E16 が `Info` にも掛かる）` と書いて `on_search_info(Black, 2, ..)` を撃ち、
`events.take().is_empty()` を表明している。

`Info` 側は踏めていて、`SearchOutcome` 側は踏めていない（`:478` の行はそう書いている）。
表だけが両方まとめて `✗` にしている。

### 所見の外: この形が3ラウンド連続で出ている

R21-H1 / H2（`(G1, E15)` と `E13`）→ R22-H2 / H3 → R23-H1 / H2。
**直すたびに別の行が壊れる。** two-strikes は既に超えているので、
次のラウンドまで持ち越さずに機械化する。

rust と comment が同じ形を提案している——テストの doc に既にある
`（表の E1 / E4）` `（表の E16 …）` `（表の ※5）` の綴りを鍵にして、
指された先が「埋まっていないセル」節に載っていないことを検査する。

---

## ラチェット自身の穴

### R23-H3 `no_doc_block_has_two_summaries` が `#[tokio::test]` を1件も見ていない

`src-tauri/tests/comment_identifiers.rs:209` の `line.trim() != "#[test]"`。

実測（`src` + `tests`）:

| 属性             | 件数 | 「〜こと。」の要約を持つ | 走査対象 |
| ---------------- | ---- | ------------------------ | -------- |
| `#[test]`        | 194  | 37（19%）                | ✓        |
| `#[tokio::test]` | 52   | 27（52%）                | ✗        |

`#[tokio::test]` の内訳は `session.rs` 43 / `bridge.rs` 5 / `manager.rs` 3 / `registry.rs` 1。
**このブランチの中心である `session.rs` のテスト doc が丸ごと死角。**

rust が変異で確認: R22-H1 で実際に起きた挿入を `session.rs:2196` に再現 → **12 passed で緑**。
同じ挿入を `#[test]` / 非 async に変えると FAILED。**差は属性の綴りだけ。**

密度は逆で、`#[tokio::test]` のほうが要約の形を守っている。doc が根拠にしている
「`#[test]` の直前に絞るのも同じ理由」は現物と食い違う。

comment はさらに、**要約行を1本も持たないブロック（155中118）には挿入しても
`summaries` が1本にしかならず `skip(1)` が何も出さない**ことを挙げている。
doc は「ブロックの1行目以外に現れたら」と書いているが、実装は「2本目以降」。

**R22-H4 / H5 / M6 で名指しした「主張が現物より強い」形が、その修正コミット自身で1件増えた。**

### R23-H4 「`body` を関門の判定に使わせない」が、型でも検査でも強制されていない

`src-tauri/tests/root_guard.rs:126-143`（doc）、`:481` / `:501` / `:536`（消費側）。

`body` は同じモジュール内の素のフィールドで、`:438` `:475` `:532` `:647` から直接読まれている。
`command.body.contains(GUARD)` と書くことを何も妨げていない。

rust の変異試験（4通り実測）:

| `root_guard.rs:481`         | `src` 側                                            | 結果          |
| --------------------------- | --------------------------------------------------- | ------------- |
| `command.calls(GUARD)`      | HEAD                                                | 17 passed     |
| `command.body.contains(..)` | HEAD                                                | **17 passed** |
| `command.body.contains(..)` | `read_file` の関門を消し、囮の `log::debug!` を置く | **17 passed** |
| `command.calls(GUARD)`      | 同上                                                | FAILED        |

**3行目が R21-B1 そのもの。** あのときは `delete_directory` から `is_project_root` が消えて
16件緑だった。同じ状態へ戻すのに要るのは `calls(` → `body.contains(` の1語。

`a_string_mentioning_the_guard_does_not_count_as_calling_it` は自分のコメントで
「**判定の口そのものを見る**」と書いているが、実際に見ているのは `calls` の単体で、
**消費側は1行も通っていない**。R22-M1 で直した `guarded_variables(code)` も同様に、
`body` へ戻す変異では緑のまま。

`body` の読み手は `takes_a_path` / `parameter_types` / `signature_of` の3つで、
**どれも署名しか読まない**。Rust の署名に文字列リテラルは現れないので `code` で足りる。

### R23-H5 ADR-0008 決定2 の核（`game/` は `tauri` を知らない）を、9本の検査が1本も見ていない

`src-tauri/tests/engine_layering.rs:239-265`（`resolve`）、
`docs/decisions/0008-engine-layering-and-dependency-inversion.md:50-56`。

`resolve` は `crate::engine::` / `crate::` / `super::` の3通りしか分けない。
`use tauri::AppHandle;` は `super::` が0個で、`game/session.rs` の `depth` は2なので
`Ordering::Less` に落ち、**辺も「外への参照」も1つも立たない**。

ADR は決定2 の帰結として「`game/` から `tauri` への `use` が1本も無くなった。
**対局の状態機械はプロセスもランタイムも無しで回せる**」と書き、決定1 が
「`engine_layering.rs` が9本の検査で強制する」と書いている。
実際に強制されているのは段の間の辺だけで、守っているのは人の注意。

`Runner` か `GameManager` に `AppHandle` を1本引くと `verify:rust` は全部緑のまま通り、
壊れるのは `test_runner` / `runner_with_events` と `manager.rs` の3本——
`DiscardEvents` だけでランタイム無しに組んでいる継ぎ目。そこを直す一番素直な形が
`app: Option<AppHandle>` で、それは ADR が「背景 2」として名指しした改修前の状態そのもの。

### R23-M4 `pub(crate) use` / `pub(super) use` が走査の入口条件から丸ごと落ちる

`engine_layering.rs:199`。`"use "` と `"pub use "` しか見ていない。
`resolve` 側の `trim_start_matches("pub ")` も `pub(crate) ` は落とせない。

`game/session.rs` に `pub(crate) use crate::engine::state::AppState;` を書くと、
段8 が段5 から見えるのに3本の検査が全部緑になる。
現物には `pub use` も `pub(crate) use` も0件なので、**いま壊れてはいない。次に書いた人を止められない。**

---

## doc が現物と食い違う

### R23-M1 ラウンド22で足したテストの doc が、指している表の行数を数え間違えている

`session.rs:3392`。「※2 の表は5行あるが」——表（`game-session.md:139-144`）は**6行**。
しかも同じ doc が「2行＋4つ」を列挙しているので、1文の中で 5 と 6 が食い違っている。

**R22-M3 で4箇所つぶした「数だけを繰り返す形」が、同じラウンドの別コミットで1件増えた。**

### R23-M2 `EngineRegistry::new` の doc が、台帳が持っていない性質を根拠にしている

`registry.rs:86-90`、参照元が `state.rs:19`。

`spawn` は `Uuid::new_v4()` で毎回新しい ID を振り、**パスによる再利用も検索もしない**。
呼び出し元は `analyzer.rs:247` と `session.rs:1736` の2つで、どちらも無条件に呼ぶ。
台帳を1つにしても、同じ実行ファイルで解析と対局を同時に走らせれば2プロセス起きる。
台帳を分けた場合でも `spawn` した側の台帳には必ず載るので、
「どちらの台帳にも載らないプロセス」は生じない。

台帳を1つにする本当の理由は**終了フックが `shutdown_all` を呼ぶ先が1つで済むこと**。
いまの doc を読んだ人は `registry` が実行ファイル単位で重複排除すると思い、
`get` で既存プロセスを引き当てられる前提のコードを書く。

### R23-M3 `CONTRIBUTING.md` の検査表が、`comment_identifiers` の2つ目の検査を書いていない

`CONTRIBUTING.md:316`。表の行は識別子検査と `EXEMPT` の話しかしていないが、
このファイルにはいま `no_doc_block_has_two_summaries`（逃げ道なし、走査範囲は `tests/` も含む）
が同居している。`ratchetIndex.test.ts` は**ファイル名だけ**を突き合わせるので索引に載らない。

表の doc は自分の役割を「赤くなった人が最初に開く」と宣言している。
要約の重複で落ちた人が開くと、**この失敗に対応する行が無いように読める。**

### R23-M5 「`stop` に応じなかった」の文言が、`Stall::detail()` を作った後も2箇所に手書きで残っている

`session.rs:272`（`Stall::detail()`）/ `:1078`（`StopTimedOut`）/ `:1346`（`Handover::Unusable`）。

同じ物理状態を別の検出器で見たものなのに、`the` の有無だけ違う2つの文字列になる。
`GameResult::detail` は「なぜ終わったかを説明する唯一の文字列」で、
`GameOverReason` は5経路を `EngineFailure` の1値に潰している。

`Stall` に4つ目の腕を足すとき、`detail()` は網羅の `match` なので数え直させられるが、
literal は何も要求しない。

---

## 失敗経路

### R23-M6 `usinewgame` の書き込みだけ、残り時間の検査が手前に1つも無い

`session.rs:88-91`（`START_TIMEOUT` の doc）と `:1781-1789`（`send_setup`）。

doc は「跨ぎうるのは `setoption` 1件の書き込みと、失敗したときの後始末」と列挙しているが、

1. `ensure_ready(READY_TIMEOUT.min(remaining(..)?))` — 渡した上限が掛かるのは**待ちだけ**。
   `protocol.rs:1112-1113` の `send_command(&GuiCommand::IsReady).await?` は
   `tokio::time::timeout` の**外**にある
2. `send_command(&GuiCommand::UsiNewGame)` — **`remaining()` が手前に1つも無い。**
   `ensure_ready` が残りを使い切った直後でも無条件に書きに行く

筋道: `readyok` が遅いエンジンで `ensure_ready` が残りを使い切る → `remaining` を見ずに
`usinewgame` を書く → 列で詰まって `WRITE_TIMEOUT` まで掛かる →
`start_game` は `START_TIMEOUT` ＋2段ぶん返らない。しかもその `usinewgame` は、
直後に2体目の `prepare_engine` が `Err` を返して**落とされるエンジン**へ送っている。

同じ列挙が `src/entities/game-session/api/tauri.ts:19-22` にもあり、待ち UI の根拠になる形。

### R23-M7 `log_rejection` は絞っていないのに、`closeGame` の doc は「そのまま呼び直すこと」と書いている

`engine/commands/game.rs:130-136` の「絞らない。ここを通るのは利用者の操作かフロントの裁定で、
1手に数回しか出ない」は**呼び出し側についての仮定**で、その呼び出し側
（`src/entities/game-session/api/tauri.ts:104-106`）には
「**そのまま呼び直すこと。握り潰すとプロセスが残る**」と書いてある。

`manager.rs:103-134` の busy 経路はミリ秒単位で返る。doc どおりに呼び直す実装は
1秒に数百件の `warn` を書く。ログは `lib.rs:74-75` で 200KB ＋ `KeepOne`。

筋道: エンジンが stdin を読まなくなる → `fail_writes` が `error` を1行残す（F-26）→
画面から `closeGame` → `busy` → 呼び直す → 200KB を数秒で一周 →
**なぜ壊れたかを説明していた `error` の行が消える。**

同じファイルの `clock_warn` は**まさにこの理由**で絞っている。

### R23-M8 `the_watchdogs_are_ordered` が固定しているのは「書き込み1件ぶん」だが、doc は「最大2回通す」と書いている

`session.rs:3203-3206` の `CLOSE_ABORT_TIMEOUT > WRITE_TIMEOUT` と、
`:311-312`（`abort` は `finish` の中で `gameover` を最大2回通す）。

先後は別プロセス＝別の書き込み列なので2件は直列に待つ。最悪値は `2 * WRITE_TIMEOUT`。

いまの値（2秒 / 6秒）では成り立つので**現時点の不具合ではない**。式が守っていないのが問題で、
`WRITE_TIMEOUT` を4秒へ上げると `8 > 6` になり、**エンジン対局を裁定待ちのまま閉じるたびに**
`"close: abort timed out; the session is stuck"` が出る。
このファイルが `CLOSE_IDLE_TIMEOUT` の doc で名指しして避けている形と同じ。

---

## 修正計画

**この2種類しか残っていない**——「機械の主張が機械より強い」と「doc が現物とずれる」。
ラウンド22と同じ内訳で、件数も同水準（11 → 13）。

### 順

1. **表とテストの食い違いを機械化する**（R23-H1 / H2）。
   直してから、同じ間違いを再現する変異で赤くなることを見る。**3ラウンド連続なので今回で機械へ移す**
2. **ラチェットの穴**（R23-H3 / H4 / H5 / M4）。H4 は `body` を消して型で強制する
3. **doc と現物**（R23-M1 / M2 / M3 / M5）
4. **失敗経路**（R23-M6 / M7 / M8）

### 測り方についての申し送り

R23-H1 は**私と robustness が同じ grep で同じ嘘に着いた**。
「文言で grep して0件だから無い」は、`expect_err` のように**文言を見ないテスト**を取り落とす。
テストの有無を確かめるときは、**そのセル名・表の記号で grep する**こと
（テストの doc が自分から `（表の E1 / E4）` と名乗る習慣が既にある）。

## 結果

**13件すべて着手。うち2件は所見の直し方に倒さず、別の側へ倒した。**

| 所見             | 直し方                                                                                    | コミット            |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------- |
| R23-H1 / H2 / M3 | 表を現物に直し、**セルとテストの突き合わせを機械に移した**（`state_transition_cells.rs`） | `06cda64` `8b71c5b` |
| R23-H3           | `#[tokio::test]` を対象に入れる。**判定は据え置き、doc の主張を落とす**——下記             | `c55b1bb`           |
| R23-H4           | `Command` から `body` を消す。取り違えが型で書けなくなった                                | `028e617`           |
| R23-H5 / M4      | `LAYERS` に `forbids` を足して `game → tauri` を落とす。`pub(crate) use` も走査に入れる   | `35541b7`           |
| R23-M1           | 表の行数を数え直す形を落とし、既に踏めていた腕をテスト名で指す                            | `11bda8f`           |
| R23-M2           | 「二重起動を防ぐ」を落とし、**終了時の掃除の宛先を1つに保つ**ためだと書く                 | `5696f51`           |
| R23-M5           | `Stall::detail()` を唯一の口にする                                                        | `032b7be`           |
| R23-M8           | `CLOSE_ABORT_TIMEOUT > WRITE_TIMEOUT * SIDES.len()`。`SIDES` を置いて数を式から追い出す   | `7820095`           |
| R23-M6           | `usinewgame` の手前に `remaining`。`ensure_ready` の上限に書き込みも含める                | `da67afa`           |
| R23-M7           | `log_rejection` を `op` ごとに絞る                                                        | `16ae26f`           |

### 所見に倒さなかった2件

**R23-H3。** 所見は「doc は『1行目以外』、実装は『2本目以降』で食い違う」と指摘し、
現物を doc に合わせることを勧めていた。合わせると**要約が2行に折り返している doc**と
**本文の段落が「〜すること。」で終わる doc** を巻き込む（実測で2件）。
誤検出を出さないほうを採り、**拾えない形を doc に書いた**。

**R23-H5 の一部。** `bridge` には `forbids` を掛けていない。`EngineBridge` は
まだ `AppHandle` を持つので、掛けると即座に赤くなる。ADR-0008 が
「まだ逆転していない境界」と書いているとおりに残す。

### 変異試験

すべて baseline 差分。

- 新しいラチェット4本 — `E16` のテスト列を `✗` に戻す／`✓` にする／属性を `#[test]` に絞る
- `blank_out_strings` — 2つの真偽値をそれぞれ反転
- 要約の重複 — 現に起きた挿入を `#[tokio::test]` の doc に再現
- 関門 — 囮の文字列に置き換える／`body` を見る形に戻す（**後者はコンパイルが通らない**）
- 段 — `game` に `tauri` を引く／`pub(crate) use` で上の段を引く／`use_body` から括弧の処理を落とす
- 上限 — `WRITE_TIMEOUT` を3秒に上げる（旧い式では緑、新しい式では赤）

### 未検証で入れたもの

**R23-M6。** `send_setup` も `ensure_ready` も `EngineProcess` を要求するので、
実プロセス無しに呼ぶ口が無い。`game-session.md` の「埋まっていないセル」の
前置きどおりで、この PR では継ぎ目を作らない。

### 残した所見

無し。
