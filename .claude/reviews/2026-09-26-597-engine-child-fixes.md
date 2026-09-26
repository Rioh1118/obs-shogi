# レビュー 597-engine-child-fixes

- 日付: 2026-09-26
- 範囲: `refactor/engine-process-handler`（#597）の3コミットと、その所見を直した `claude/zealous-dirac-h08mrr`（#598）
- 走らせた reviewer:
  - 1巡目（#597 の差分）: `rust-reviewer` / `robustness-reviewer`
  - 2巡目（直したコミットの差分）: `rust-reviewer` / `architecture-reviewer` / `comment-reviewer` / `robustness-reviewer`
- 対象コミット: `f689d23`〜`bae24aa`

## 入れた機械

どれも、直した箇所を壊した形に戻す変異を当てて落ちることを確かめた。

- **子プロセスの持ち主を `UsiProtocol` の1つに型で閉じた**（`a4daf66` / `62a8b74`）。`Clone` を外し、`EngineChild` を `Arc` に包まない。`Arc::clone(&self.child)` と `Arc::new(self.clone())`（どちらも #597 の中で出た形）はコンパイルが通らない。型が止めるのは `UsiProtocol` の中だけで、`Arc<UsiProtocol>` をタスクへ渡す形は止まらない
- `dropping_the_protocol_while_waiting_for_readyok_ends_the_process`: #597 の先頭で10秒待って落ちる
- `dropping_the_protocol_closes_stdin_for_a_grandchild_of_a_finished_wrapper`: `EngineChild` の Drop を外すと落ちる
- `the_line_after_the_output_ends_carries_the_exit`（100回）/ `our_own_kill_is_not_reported_as_the_engine_ending`: 覗くだけの形と、`killed` を待つ前にしか見ない形でそれぞれ落ちる
- `summarize_recent` の純関数テスト3本: 末尾3行を取る形と、stderr を先に取る形でそれぞれ落ちる
- `child.rs` の `without_a_process`: 行の読み方のテストを unix 以外でも走らせる。上限の境界だけを戻す変異、切った残りを次の行へ回す変異で落ちる
- `kill_result_is_not_discarded` を許可制・文単位にし、呼び口の場所を控え（`KILL_CALL_SITES`）と等値で見る。`dispose_late_spawn` を `tokio::spawn(async move { .. })` の末尾の式にすると落ちる（数え上げの版は緑）
- `strip_test_modules` が `cfg(all(test, ..))` も落とす。`any(test, ..)` / `not(test)` を残すことも表で見る
- `layering` の子プロセスの綴り: 別名の `use` と `crates/` の中も拾う。`crates/fs` に `std::process::Command` で起こす関数を足すと落ちる（`src/` だけを歩く版は緑）
- `commentHistory` の止める語に「すり抜けた」
- 台本を exec するテストの `ETXTBSY` を起こし直す（`f689d23`）。#597 の先頭で15回中4回落ちていたのが、20回中0回

## 直した所見

- `a4daf66` `readyok` 待ちのタスクが `UsiProtocol` ごと子プロセスを握り、捨てても落ちない
- `719b49d` 出力が終わったログの `exit=` を回収前に覗く（`None` になる）
- `ee13c11` → `bdea0b7` 失敗の理由の直近の出力で stderr が押し出される。直した版が stderr の警告3行で最後の stdout の行を消す退行を作ったので、いちばん新しい行を必ず載せる形にした
- `35917a0` → `bd8f9a5` / `c14f8d3` 走査2本の抜け道（折り返し・`_ =`・`select!` の枝・ブロックの末尾の式・別名の `use`・`crates/`）
- `08c3fe8` 状態遷移表の「孫も落ちる」が無条件
- `daebbf0` 中身がちょうど上限の行を「切った」扱いにする。kill のテストに時間の上限
- `ce8e5c6` 終わりを待っている間のこちらの SIGKILL を、エンジンの終わり方として warn に載せる（`719b49d` で入れた退行）
- `b40f22f` `readyok` 待ちが書き込みの列を握るので stdin が閉じず、グループへ送らない回の孫が残る
- `f5eb9ad` `cfg(all(test, ..))` の下のテストを本番のコードとして走査する
- `b7cd6c4` `begin_generation` を `Link` へ。テストの置き場を名前に出す
- `bae24aa` 検査の本数（「5つ」「4つ」）、「タスクへ渡せるのは `Link` か `ChildDiagnostics` だけ」、`game-session.md` の「残るのは」の列挙

**直さなかったもの:** 1巡目で「kill のテストに上限が無いと、ロックを待つ形に戻しても30秒後に緑になる」と書いたが、確かめると30秒後に `AlreadyExited` で落ちていた（緑にはならない）。上限は、落ちるまでの時間と文言のために入れた。

## 送ったもの

- 無し（issue も `docs/IDEAS.md` も立てていない）。候補は下の「見ていない範囲」に置いた

## 機械にできなかったもの

- 散文の本数と断言（検査の数、型が止める範囲、「残るのは」の列挙）。本数は書かない形、列挙は F-25 を指す形にして、腐るものを減らした
- `Arc<UsiProtocol>` をタスクへ渡す形（探索、無限解析）。正当な使い方と字面で分けられない

## 見ていない範囲

- Windows / macOS の実機。実プロセスのテストは `cfg(unix)`
- アプリに組み込んだ対局・解析の開始と終了
- `with_recent_output` が `exit_now` を覗いて stderr を待つか決める経路。`usi` の書き込みが EPIPE で折り返した回に stderr を待たない可能性がある（再現していない推測）
- `ensure_ready` の `send_command(IsReady)?` と対局の `setoption` の失敗は `with_recent_output` を通らず、直近の出力が添わない（#597 より前から）
- 待ち手の `select!` は `biased` ではないので、子が終わった直後に頼みが届くとグループへ送らずに `Ended` を返しうる（窓は狭い）
- `setsid` などで別のグループへ移った孫は、子が生きていても落ちない
