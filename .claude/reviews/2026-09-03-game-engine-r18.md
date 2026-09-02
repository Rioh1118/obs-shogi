# 対局エンジン レビュー ラウンド18

- 日付: 2026-09-03
- 範囲: ラウンド17と同じ。**ラウンド17で入れた変更を重点的に疑わせた**
- 範囲外: `analyzer.rs` / `bridge.rs` の中身（#371）
- 観点: robustness / rust / comment の3本を並列

**所見のほとんどがラウンド17の自傷。** 直した数だけ新しい穴が開いている。

---

## 実装（robustness）

### R18-M1 `MAX_PLIES` の境界が入口2箇所で1手ずれ、通した設定で1手も指せない

`session.rs` の `validate_settings`（`> MAX_PLIES`）と `accept_continue`（`> MAX_PLIES`）。

`initial_moves` がちょうど 2000 の対局は `start_game` が `Ok` を返し、時計も動く。
最初の手が決まった後、フロントが規約どおり「根からの全手 2001 手」を返すと
`accept_continue` が断る。**フロントが返せる列は接頭辞と長さで一意に固定されている**ので、
やり直しても必ず同じ `Err`。対局は `AwaitingRuling` に留まり、30秒後に
`Aborted { detail: "no ruling came back from the app" }` で畳まれる——
**フロントは裁定を返しているのに、棋譜と画面には「アプリが裁定を返さなかった」が残る。**

逃げ道は `end_game_by_rule` だけだが、最大手数の判定はフロントにまだ無い（#354）。

### R18-M2 `on_tick` が `stalled_turn` へ渡す隣り合う2つの `bool` を、どのテストも見ていない

`session.rs` の `on_tick`。`thinking_is_an_engine` と `has_spoken` は型が同じで隣接し、
**入れ替えてもコンパイルが通り全テストが緑のまま**。

`stalled_turn` を見る6本は全部が関数を直に叩く `#[test]`。`on_tick` を通る3本は
`two_humans` なので `spec.is_engine()` が常に false で、`Running` の枝を踏まない。

入れ替えると、`info` を出していないエンジンで `thinking_is_an_engine` が false になり、
`stalled_turn` は `Running` の枝に一切入らない——沈黙の腕だけでなく
**`budget + HARD_TURN_LIMIT` の最後の上限も消える。**

R17-H7 の変異確認は関数側で済ませてあり、この配線は覆っていない。

### R18-M3 `the_typescript_copy_has_every_field` が `AnalysisCandidate` の欄を1つも見ていない

`types.rs`。見本の `AnalysisResult::default()` は `candidates` が空配列なので、
`rank` / `first_move` / `pv_line` / `evaluation` / `depth` / `nodes` / `time_ms` が
一度も `wire` に入らない。

検査の doc は「Rust が線に出す欄が**全部**あること」「`AnalysisResult` も一緒に見る」と
名指しで主張している。`AnalysisCandidate` に欄を足すと——`searchInfo` は対局中に
毎行流れる——Rust は新しい鍵を出すのに写しは古いまま**この検査は緑**。

いまの写しは偶然一致しているので、壊れるのは次に足したときだけ＝気付ける経路が無い。

### R18-M4 `GameManager::close` の remove→再挿入の窓で `unknown game` が嘘になる

`manager.rs`。台帳から外してから最大十数秒 `await` する。その間に同じ `game_id` へ
別の `close_game` が入ると、2本目は `unknown game` を受け取る。

TSDoc は「何も起きていないので呼び直しても同じ」と書いているが、実際にはその直後に
セッションが**台帳へ戻り、エンジンは生きたまま残る**。同じ窓で `list_games` も
その ID を返さないので、「閉じ忘れを拾う」導線も同時に効かない。

### R18-M5 `a_move_that_the_clock_beat_is_not_reported_as_taken` の `enforce_engine_timeout = true` が効いていない

`session.rs`。`runner_with_events` は `two_humans` なので `is_engine()` は false。
`timeout_enforced` は `!is_engine() || enforce_engine_timeout` で左辺だけで true になり、
**この行を消しても結果は同じ。**

`game-session.md` は「既定 false 側しか通していない」と正しく書いているので、
doc とテストの見た目が食い違い、次に「ここは踏んである」と判断した人が
エンジン側の時間切れ成立を未検証のまま残す。

---

## doc・コメント

### R18-H1 R17 が挿入した関数が、既存の doc とその関数を引き剥がした（2箇所）

`session.rs`。`remaining` が `spawn_players` の doc の後ろに、
`abort_within_budget` が `close` の doc の後ろに差し込まれている。

- `remaining` は「対局者を全部起動する」も「道連れに落とす」もしない
- `abort_within_budget` はエンジンを1本も落とさない
- **`pub async fn close` は公開関数なのに `///` が1行も無い状態になった**
- `spawn_players` は「`timeout` で包まない理由」——コードから読めない情報——を失った

### R18-H2 `game-session.md` ※12 が `has_spoken` の条件を落としている

doc の 3 は「`Running` が `SEARCH_GRACE` を超え、かつ `info` が1行も来ていない」。
実装は `has_spoken &&` が先頭に付く。`grep has_spoken docs/` は0件。

表だけを読んだ人は「`info` を出さないソルバは31秒で `EngineFailure`」と読むが、
実際にはその側に沈黙の番人は**一度も掛からない**。押さえるのは 2 だけで、
60分切れ負け・`enforce_engine_timeout` 既定 false で初手にデッドロックしたエンジンは
**70分間検出されない**。その窓の存在を表から知る経路が無い。

### R18-H3 ※3 と F-28 の「断る条件の一覧」が、R17-B1 で入れた検算を含んでいない

`game-session.md` の ※3 は「検算は3つ」。実装は5つで、内容も違う。

- **R17-B1 の本体である接頭辞の検算が表のどこにも無い。** これを根拠に触る人は
  接頭辞の行を冗長として落とし、「エンジンが指してもいない手で反則負け」が戻る
- 「各手の形が通ること」は**いま偽**。形を見るのは決まった1手だけ
- `MAX_PLIES` も落ちている

F-28 も同じ列挙を持っており、**測定日を打った直後から偽**。

### R18-H4 TS 写しのテスト doc が、行数も「誰も触っていない」も現物と食い違う

`types.rs`。「245行」は現物 262行。「tsc からも vitest からも `cargo test` からも
触られていない」は3つとも偽——`index.ts` と `tauri.ts` が `import type` で使い、
`tsconfig.app.json` は `include: ["src"]`、そしてこの doc が付いているテスト自身が
`include_str!` で読んでいる。

この doc を信じて写しを未使用と判断して消すと、`entities/game-session` の公開型が壊れる。

### R18-M6 「返るまでの上限は `START_TIMEOUT`」が成り立たない

`remaining` が見るのは**段に入る前**だけ。`registry.spawn` 内部の `SPAWN_TIMEOUT`（10秒）は
締切で縮まず、`setoption` の書き込み列と失敗時の `shutdown` も締切の外。

先手が締切をほぼ使い切って起動に成功すると、後手の `remaining` は 0 でないので通り、
その `spawn` は自前の10秒を丸ごと使える。TSDoc は「90秒で reject」と書いているので、
90秒でスピナーを諦めさせる実装が「reject も resolve もしない invoke」を掴む。

### R18-M7 ※10 が存在しないテストを指し、かつ「固有の価値」がテスト自身の doc と正反対

`game-session.md`。「`(G2, E8)` を名乗るテスト」は `grep` しても1本も無い
（R17 でラベルを直したため）。**直した後の姿ではなく直す前の姿の記録**で、
CLAUDE.md の「変更の経緯を書かない」に当たる。

より実害があるのは括弧の中で、表は「そのテストの固有の価値は※6 の順序」と言うが、
テスト自身は「順序は見ていない／順序を入れ替える変異では落ちない」と書いている。

### R18-M8 `GameId` の doc が、いまコンパイルを通らないコードを現在形で書いている

`types.rs`。「`registry.shutdown(game_id)` が型検査を通り」も
「`submitGameMove(usiMove, side, gameId)` で tsc が通り」も、**いまは起きない**
（片方は newtype、もう片方は brand が塞いだ）。

現在形なので、読んだ人は「まだ穴が空いている」と読んで防御を二重に足すか、
逆に「防げていないなら newtype に意味が無い」と外す。
`EngineId` が素の `String` のままである理由も書かれていない。

### R18-M9 TS 側の doc だけが秒数を直値で持っている（6箇所）

`tauri.ts` の `（90秒）`、`events.ts` の `30秒後に中断`、`rust-types.ts` の
`裁定を30秒返さなかった` / `長くて10秒` / `最短500ms` / `30秒で中断される`。

**同じラウンドで Rust 側からは数字を消し、TS 側には6箇所残した。**
TS からは Rust の定数を参照できないので、`RULING_TIMEOUT` を動かすと
この6箇所だけが黙って嘘になる。

### R18-M10 `decide_move` の doc の1行目が2文に割れて意味を成していない

`session.rs`。`cargo doc` では「時計を締めて裁定を待つ手を採る。」と連結され、
「裁定を待つ手」という存在しない概念が生まれる。

### R18-M11 `rust-types.ts` の `GameId` doc「作る口は2つだけ」が現物と合わない

`getGameState` の戻り値と `game-event` の全バリアントも `GameId` を運ぶ。
doc を字義どおり読むと「イベントの `gameId` は使えない」と誤解し、
brand を素通りさせるキャストが増える。

### R18-M12 ADR-0008「どちらも」が3項目に掛かっている

`0008` の「まだ逆転していない境界」は3項目なのに締めが「どちらも」。

---

## Rust

### R18-B1 `matching_brace` が文字列リテラルの `{` を数え、いま実際に2ファイルで走査が無効

`production_unwrap.rs`。`types.rs` の `.split([' ', '{', ','])` と
`kifu_reader.rs` の `br#"{"header":"#` の `{` を開き括弧として数えるので、
深さが0に戻らず `item_end` が `None`。`strip_test_modules` は
**`#[cfg(test)]` 以降を全部捨てて `return out`** する。

**変異で確認済み（reviewer が実施）。** `types.rs` の末尾に
`pub fn probe_hole(v: Option<u32>) -> u32 { v.unwrap() }` を足すと
`cargo test --test production_unwrap` は**3本とも green**。

しかも `production_unwrap.rs` の doc は「崩れたら
`the_scanner_still_sees_production_code` が先に落ちる」と書いている。
**その状態が現に2ファイルで起きていて、その検査は落ちていない**——
名指しの綴りは3ファイルぶんだけで、崩れた2ファイルを1つも見ていない。

いまは両方とも `mod tests` がファイル末尾なので本番コードは失われていないが、
**フォールバックは無条件**なので、その後ろに書いたものは丸ごと消える。

### R18-H5 `root_guard` の署名走査が最初の `)` で切れる。`Channel<()>` を1つ挟むと消える

`root_guard.rs` の `takes_a_path` と、**ラウンド17で足した `parameter_types`**。
`chunk.find(')')` なので、引数の型に `()` が現れるとそこが署名の終わりになる。

**変異で確認済み。** `probe_raw_path(app, on_event: Channel<()>, file_path: String)` を
足すと `cargo test --test root_guard` は**10本とも green**。`file_path: String` を
素で受けているのに `every_path_taking_command_checks_the_root` の対象に入らない。

`settings: GameSettings` を後ろに置いた形も、ラウンド17で足した
`no_path_carrying_command_is_missing_from_the_list` から消える。
**「載せ忘れを機械で拾う」という追加そのものが、引数の並べ方ひとつで無効になる。**

### R18-M13 `engine_layering` が `mod tests` の中の `super::super::` を取り違え、偽の辺が1本立っている

`depth` は `engine/` からの**ファイルパス**の要素数で、`mod tests` が段を1つ
増やしていることを数えていない。`session.rs` の
`use super::super::events::{DiscardEvents, RecordedEvents};` は実際には
`engine::game` を指すのに、走査は `engine::events` と読む。

**いま取れている `game -> events` は偽。** `dependencies_only_point_downwards` は
`layer(&to).is_none()` の行き先を黙って飛ばすので、どこにも報告されない。
`no_permission_is_granted_without_a_real_edge` はこの偽の辺で
`may_use` を「使われている」と数える。

逆向きの誤りもある。`mod tests` から本当に `engine::state` を指す
`use super::super::super::state::AppState;` は「外を `use` している」という
**誤った理由**で落ちる。

### R18-M14 `the_typescript_copy_has_every_field` が型ごとの対応を見ていない

`wire` は全サンプルのキーを1つの集合に潰したもので、**どの型のどの欄かが消えている**。
連結した2ファイルへの素の `contains` なので、別の型やコメントに同じ綴りがあれば通る。

**変異で確認済み。** `GameSnapshot` に `detail: Option<String>` を足しても、
`detail:` が `GameResult` の側にあるので **green のまま**。
doc の「全部ある」が保証しているのは「その綴りが写しのどこかに1回は出てくる」だけ。

### R18-M15 `start_sfen` と `setoption` の値は無制限に線へ出る

`MAX_PLIES` の doc は「10万手なら1行が 900KB を超え……そのエンジンは以後何も
受け付けなくなる」と害を丁寧に書いているのに、**同じ1行を伸ばせる他の経路に
同じ検算が無い**。

- `start_sfen` は欄の数と `/` の数しか見ないので、盤面欄に数MBの詰め物が通る
- `options` は件数も `name` / `value` の長さも一度も検査されない

どちらも `check_writable` の `to_string()` と `push_pending` の `clone()` を通る。

### R18-M16 `kill_engine` が `handler.kill()` の失敗を捨てて「done」と記録する

`protocol.rs`。`usi` の `kill()` は `quit` を書いてから `process.kill()` を呼ぶので、
**書き込みが失敗すると `process.kill()` は一度も呼ばれない。**

コメントは「既に死んでいれば `quit` の書き込みが失敗するだけ」と書いているが、
それが成り立つのは本当に死んでいるときだけ。**生きているのに stdin のパイプが
壊れているエンジンではプロセスが残る**のに、`killed` は無条件 `true` で
ログは `kill_engine: done`。`shutdown_all` も `()` を返すので手掛かりが1つも無い。

`registry::terminate` は `quit` → `QUIT_GRACE` → `kill_engine` の順なので、
`kill_engine` の中の `quit` は**必ず2通目**で、失敗する確率は低くない。

### R18-M17 `item_end` の「`;` が先なら塊なし」が `[T; N]` に当たる

`#[cfg(test)] const SAMPLES: [&str; 3] = [...];` だと `[&str;` の直後で切られ、
以降がテストコードのまま「本番」として残る。いま該当は無いが `[T; N]` は普通の書き方。
緩む方向ではなく偽陽性だが、`path:line` が現物と合わない追いにくい形になる。

---

## 修正計画

**所見27件（重複を除くと21件）。ほとんどがラウンド17の自傷。**

`/implement` の「対象を疑う」に当たるので、まず形を見る。増えたのは
**「機械を足したら、その機械に穴があった」**が7件（R18-B1 / H5 / M13 / M14 / M17 と
R18-M2 / M3）。これは機構を落とす合図ではなく、**機械に単体テストを付ける規律が
まだ足りていない**という合図——ラウンド17で2本には付けたが、
`matching_brace` と丸括弧の対応取りには付けていない。

### 順

1. **走査の故障**（R18-B1 / H5 / M13 / M17）。**黙って打ち切るのをやめる**のが先
2. **機械の主張の縮小 or 強化**（R18-M14 / M3）
3. **対局が壊れる**（R18-M1 / M2 / M15 / M16 / M4 / M5）
4. **上限の実効**（R18-M6 / R18-M5）
5. **doc**（R18-H1〜H4 / M6〜M12）

---

## 修正計画

（3本が揃ってから書く）

## 結果

（`/review-fix` で書き戻す）
