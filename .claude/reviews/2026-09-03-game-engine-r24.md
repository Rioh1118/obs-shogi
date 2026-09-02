# 対局エンジン レビュー ラウンド24

- 日付: 2026-09-03
- 範囲: ラウンド23と同じ
- 範囲外: `analyzer.rs` / `bridge.rs` の中身（#371）
- 観点: rust / comment / architecture / robustness の4本。**変異試験を許したのは rust の1本だけ**

**所見16件。数は 39 → 27 → 21 → 24 → 31 → 11 → 13 → 16。**

### 内訳が変わっている

16件のうち**10件はラウンド23で入れた修正の詰め残し**で、**6件はラチェット自身の穴**。
産物（対局の Rust API）そのものの欠陥は0件のまま、
**「自分が足した機構が、主張どおりに働いていない」が3ラウンド続いている。**

`/implement` の「所見が減らないラウンドが3回続いたら対象を疑う」に照らすと、
11 → 13 → 16 は2ラウンド連続の増加。ただし増えているのは**産物側の詰め残し**
（`ensure_ready` / `log_rejection` / 上限の式）で、これは機構ではなく実装の話なので
対象の疑いには当たらない。**機構側の4件（H1〜H4）は、いずれも
「主張を落とす」か「1行で塞ぐ」のどちらかで閉じる**ので、今回で終える。

---

## ラチェットが空振りしている

### R24-H1 doc の引き剥がし。**要約重複の検査を広げたそのラウンドで、その検査が見ない素の `fn` に作った**

`src-tauri/tests/engine_layering.rs:189-198`。

`use_statements` の doc（「1つずつ返す」「行で切らない」「rustfmt が折る」）の途中へ
`use_body` を挿し込んだので、**別の関数の説明が `use_body` のものとして残り、
`use_statements` は doc を1行も持たない**。

`use_body` は1行を受けて `Option<&str>` を返すだけなので、「行で切らない」「折り返しを跨ぐ」は
この関数の振る舞いと**正反対**。折り返しの処理を探した人は `use_body` を読み、
そこに無いので走査が壊れていると誤診するか、`use_body` 側に足す。

6回目。しかも `no_doc_block_has_two_summaries` を `#[tokio::test]` へ広げた同じラウンドで、
**その検査が見ない素の `fn`** に出ている（要約行がどちらも「〜こと。」で終わらないので、
`fn` まで対象を広げても拾えない）。

### R24-H2 テストが名乗る**セル記号**が実在するかを誰も見ていない。注（`※N`）だけ検査がある

`src-tauri/tests/state_transition_cells.rs:229` と `:286-288`。

`claims()` が拾う9件のうち7件は `E*`。`no_test_claims_a_cell_the_table_calls_untested` は
表に無いセルを `continue` で読み飛ばし、`every_note_a_test_names_exists` は
`if !cell.starts_with('※') { continue; }` で `E*` を外している。

rust が変異で確認:

| 変異                                   | 結果                                    |
| -------------------------------------- | --------------------------------------- |
| 表の `**E16**` を `**E19**` に振り直す | **10 passed で緑**                      |
| 注の定義 `※8` を `※88` に              | `every_note_a_test_names_exists` FAILED |

**差は記号が `E` か `※` かだけ。** E 番号を振り直すと7件の名乗りが黙って落ち、
3ラウンド連続の食い違いを機械化するために作った当のテストが、その7件について
**永久に空振りする**。`the_scanner_finds_the_claims` の下限は `>= 5` で現在値は9なので
4件消えても緑。

architecture が同じ検査の**逆向きの穴**も挙げている——「列が `✓` で、名乗るテストも
節への記載も無い」は素通りする。現に `E17` は `✓` なのに名乗るテストが0件
（実体は `settling_forever_ends_the_game`）。そのテストを消すと、表は `✓` のまま
4本すべて緑になり、次の人は `stalled_turn` の `Settling` の腕を落とせる。

### R24-H3 `forbids` が見るのは `use` 行だけで、この repo は `AppHandle` を1度も `use` で書いていない

`src-tauri/tests/engine_layering.rs:571-602`、`docs/decisions/0008-...md:58-62`。

現物の綴りを数えると:

| 綴り                                        | `engine/` 内 |
| ------------------------------------------- | ------------ |
| `use tauri::AppHandle`                      | **0**        |
| `app: tauri::AppHandle`（型位置の完全修飾） | 5            |

**ラウンド23で当てた変異 `use tauri::AppHandle;` は、現物に1件も存在しない綴り。**
実際に書かれる形（`struct Runner { app: tauri::AppHandle }`）は検査の外にある。

rust はさらに `use ::tauri::AppHandle;` も抜けることを変異で確認している
（`body.split(..).next()` が空文字列になり `filter` で落ちる）。R23-M4 の
`pub(crate) use` と**同じ関数の同じ形の穴**。

ADR は「決定を書いただけだと通ってしまうから機械を置く」と書いているので、
読んだ人は戻せないと信じる。

### R24-H4 表だけを直すコミットでは、そのラチェットが1度も走らない

`.claude/hooks/verify-gate.sh` の `needs_rust` は `*.rs|Cargo.toml|Cargo.lock` だけ。
`docs/*` は `needs_ts` にしか入らない。

このラチェットが対象にしている改変は**実測で docs のみのコミット**である。

```
4d915c9 docs: 埋まっていないセルの記述を…    docs/state-transitions/game-session.md | 9 +++---
06cda64 docs: 表とテストの食い違いを…        docs/state-transitions/game-session.md | 35 ++---
```

`4d915c9` は R23-H1 の嘘を**作った**コミットで、同じことをもう一度やっても
走るのは `npm run verify` だけ。兄弟の `docsIdentifiers` / `docsSourcePaths` は
TS 側にあるので確実に走る——**3本のうち1本だけが門番の反対側にある。**

### R24-M1 `test_column` の「表の本体だけを読む」が実装と違い、正しさが節の並び順に依存している

`src-tauri/tests/state_transition_cells.rs:150-170`。

実装は見出しを見ず、`**E<数字>**` で始まる行を全部拾う。`game-session.md` の
「## イベント」の表も同じ形なので全行が入り、後ろの「## 表」が `insert` で
上書きしているだけ。

「イベント」節を後ろへ動かす／イベントを1つ足して本体の行を書き忘れる、のどちらでも
テスト列が**発生源の説明文**になる。`✗` でも `✓` でも始まらないので2本とも静かに通る。

---

## ラウンド23の詰め残し（失敗経路）

### R24-H5 `ensure_ready` が「1ナノ秒も与えていないエンジン」に `readyok` を返さなかったと言う

`src-tauri/src/engine/protocol.rs:1115-1130`。

`left` が 0 でも待ちに入る。`tokio::time::timeout(ZERO, _)` は内側を1回 poll してから
`Elapsed` を返すので、**`readyok` を1ミリ秒も待たずに
「engine did not return readyok in time」で返る。**

筋道: `setoption` を数十件持つエンジンで stdin を吸うのが遅い → `send_setup` は毎件
`remaining` を通るので締切ぎりぎりまで進む → `ensure_ready` に渡るのは数ミリ秒 →
`isready` の書き込みが数百ミリ秒 → `left = 0` → 即 `Err` → 利用者は評価関数のパスを疑う。

**同じファイルの `prepare_engine` が名指しで避けている形そのもの**——
「`usiok` に何も残らないなら起こす前に締切として断る」と書いて
`if for_usiok.is_zero()` を置いている。`ensure_ready` にはその対の guard が無い。

### R24-M6 `log_rejection` の枠が `op` だけで割られていて、同時に走る別の対局の断りが黙って消える

`src-tauri/src/engine/commands/game.rs:134-137` / `:161-166`。

鍵は `op` だけでプロセス全体に1つ。ログの行は `game={game_id}` を出す。
`GameManager` は「エンジン同士を2組回す」前提で台帳を持っている。

筋道: A局の裁定に不具合があり `continue_game` が毎回断られる → op の枠を1秒ごとに
A局が取る → 同じ秒に B局で起きた断りは1行も残らない → B局は `RULING_TIMEOUT` で
`aborted` になり、**ログには B局の `game_id` が一度も出ない**。
`log_rejection` の doc が避けると書いている状態そのもの。

**R23-M7 が `op` 軸について直した形と同じもので、軸が対局に変わっただけ。**

### R24-M7 `game_id` は無検証の文字列のまま `warn` の行に埋め込まれる

`commands/game.rs:168`、`game/types.rs:32-40`（`GameId::new` は何も見ない）、
`lib.rs:74-75`（200KB ＋ `KeepOne`）。

長さも制御文字も見ていない。`e` の中身（`unknown game: {game_id}`）にも同じ文字列が
もう1回入る。`submit_game_move` 1回で 200KB を超える1行が書けるので、
**`fail_writes` の `error`（F-26）も `emit failed`（F-19）も一掃される。**
R23-M7 の絞りは1秒あたりの行数を減らすだけで、1行の大きさは減らさない。
改行を含む `game_id` なら、その行の後ろに好きなログ行を作れる。

### R24-M8 `abort` の予算の式に、`run_loop` の列で待つぶんが1件も入っていない

`session.rs:3225-3234` と `:494-502`、`manager.rs:110-131`。

`CLOSE_ABORT_TIMEOUT` が包むのは `tx.send` から `rx.await` が解けるまで。
`run_loop` は単一キューなので、**先に入っている要求の処理時間が丸ごと乗る**。
式が数えているのは `finish` の中の `gameover` の件数だけ。

しかも `abort_within_budget` を呼ぶのは `Arc::try_unwrap` が失敗したとき＝
**別の操作が掴んでいることが確定している**とき。先客が `continue_game` なら
`Ponderhit` の書き込みを1件抱えている。

いまの定数で厳密に超える並びは構成できなかった（reviewer 明記）ので**現時点の不具合ではない**。
式が守ると宣言している範囲と実際の範囲がずれている、という所見。
超えたときに出る `close: abort timed out; the session is stuck` を、
F-24 は「中断できておらず、エンジンは探索を続け時計も進む」と読ませる——
実際は列で待っていただけ、という取り違えになる。

---

## doc が現物と食い違う

### R24-M2 `CONTRIBUTING.md` の `state_transition_cells` の行が、両方向に取り違えている

`CONTRIBUTING.md:317`。

1. **「埋まっていないセル」節はテストと突き合わせていない。** `no_uncovered_cell_is_marked_as_covered`
   は `listed_as_uncovered()` と `test_column()` を比べ、`claims()` を1度も呼ばない
2. **注は見ている。** モジュール doc は「注の**本文**が」と限定しているが、
   `CONTRIBUTING.md` は「本文」を落として「注は見ていない」にしている

**R23-M3 で直したのと同じ形が、その修正コミット自身が足した行で1件増えている。**

### R24-M3 ラウンド23で入ったコメント5箇所が、変更前の状態を過去形で説明している

- `session.rs:265` 「1件ぶんしか見ない値が通る（**実際にそうなっていた**）」
- `session.rs:3420-3423` 「踏んでいたのは…**だけだった**」
- `engine_layering.rs:292` / `:607` 「**素通りさせていたので**…立たなかった」
- `root_guard.rs:115-116` 「**緑で通ったことがある**」

`CONTRIBUTING.md:143` の「『元は〜だった』も書きません」に当たる。
とくに `engine_layering.rs:292` は**その素通りを塞いだ分岐のすぐ上**にあるので、
現在形として読んだ人は「いまも `use tauri::` は辺を立てない」と判断する。

`commentHistory` の `HISTORY_WORDS` は「だった」「ていた」を意図的に外している
（現在の説明を巻き込むため）ので、機械は1件も止めない。**人の側に残す。**

### R24-M4 2本のテスト名が、そのテストの doc 自身が「見ていない」と書いている振る舞いを名乗っている

`session.rs:3322`（`ending_the_game_tells_the_app_before_it_tells_the_engines`）と
`:3899`（`a_bestmove_after_the_game_ended_still_gets_a_gameover`）。

前者の doc は「見ているのは `Over` が出たことだけ。**それが `Over` より後であることも見ていない**」、
後者は「`gameover` が実際に飛ぶことは見ていない」。

**`cargo test` の出力に出るのは名前だけで doc は出ない。** しかもこの repo は
「どのセルが固定されているか」をテスト名で引く運用に倒したところ。
緑を見た人が ※6 の順序は守られていると判断し、`emit(Over)` を後ろへ動かす（→ #377）。

### R24-M5 `ensure_ready` の新しい doc の上限を、同じファイルの `WRITE_TIMEOUT` の doc が否定している

`protocol.rs:1106-1109` と `:260-262`。

「この関数が返るまでは `max(timeout, WRITE_TIMEOUT)` で抑えられる」と書いたが、
`WRITE_TIMEOUT` の doc は「**1件の書き込みに掛かる。`send_command` が返るまでの
実時間ではない**（列に先客が居ればその処理時間が足される）」と書いている。

`ensure_ready` は `pub`。いまの唯一の呼び出しが列の空な状態で通るから成り立っているだけ。

### R24-M9 `closeGame` の doc は「そのまま呼び直すこと」としか書いておらず、間隔も回数も無い

`src/entities/game-session/api/tauri.ts:102-107`。

R23-M7 は**その連打が出すログ**を絞ったが、案内そのものは変えていない。
**連打は残り、それが起きていることを示す記録だけが1秒に1行へ縮んだ。**

### R24-M10 `REJECTION_WARN_INTERVAL` だけ、値を選んだ理由が無く、同じ subsystem の他の2つと5倍違う

`commands/game.rs:124-128`（1秒）に対し `EMIT_WARN_INTERVAL` / `CLOCK_WARN_INTERVAL` は5秒。

doc が説明しているのは枠の分け方だけ。すぐ下の `log_rejection` の doc は
「200KB で `KeepOne` なので数秒で消える」を絞る理由に挙げていて、
**この定数の値がその主張の成否を直接決める**（`op` は6つあるので最悪で毎秒6行）。

---

## 集約

### R24-M11 対局を断る文言が `GameManager` の中で5つの literal に散っている

`manager.rs:84` `:87` `:106` `:128-130` `:207` `:209`。3条件に対し literal が5つ。
判定理由の散文も `:77-80` と `:197-201` に2度ある。

`commands/game.rs` は「分類は `GameManager::close`」と1箇所を指し、
`tauri.ts` は3つの文言を**契約として写している**。1箇所だけ直すと、経路によって
当たったり外れたりする分類ができる。網羅の `match` を通らないので、
条件を増やしても数え直す口が無い。

ADR-0008 決定3 が同じ形を2件つぶしている（`cannot_reach_text`、R23-M5 の `Stall::detail()`）。
**`GameManager` にだけ適用されていない。**

同種で1件: `session.rs:1563` の `[Side::Black, Side::White].into_iter()` は
同ファイルの `SIDES` の写し。

---

## 修正計画

### 順

1. **ラチェットの空振りを塞ぐ**（R24-H2 / H3 / H4 / M1）。ここが直るまで、他の緑は根拠にならない
2. **doc の引き剥がし**（R24-H1）
3. **失敗経路**（R24-H5 / M6 / M7 / M8）
4. **doc と現物**（R24-M2 / M3 / M4 / M5 / M9 / M10）
5. **集約**（R24-M11）

### 測り方についての申し送り

R24-H3 は**変異の綴りが現物に存在しなかった**ために「killed」と読めてしまった例。
変異を作るときは、**その綴りが現物で実際に使われているか**を先に数えること。
`use tauri::AppHandle` は0件で、現物は全部 `app: tauri::AppHandle`（型位置）だった。

## 結果

（`/review-fix` で書き戻す）
