# レビュー engine-setup-stage

- 日付: 2026-09-26
- 範囲: `feat/engine-setup-stage`（origin/main ec845102 からの差分。PR C1: `engine/setup.rs`、`start_analysis_engine`、起動の取り消し、`StartFailure`）
- 走らせた reviewer: architecture / comment / rust / robustness（oss-hygiene は docs の差分が表の注1段落だけなので省いた）
- 対象コミット: d0053ec8（1巡目）

## 入れた機械

- `tests/layering.rs` `only_the_setup_stage_builds_set_option`: `GuiCommand::SetOption(` を組むのは本番のコードで `engine/setup.rs` だけ（`match` の腕は数えない。判定そのものは `the_set_option_scanner_tells_a_build_from_a_match_arm`）。analyzer に1件足す変異で落ちることを確かめた
- `tests/layering.rs` の段: 失敗の分類を `start_failure` 段へ出し、`setup` の `decides` を1行に戻した。テストのためだけに開けていた `analyzer → child` / `setup → child` の辺を閉じた（台本は `protocol::script` / `registry::script` から借りる）
- 実プロセスのテスト（`analyzer.rs` の `tests::starting`、`setup.rs` の `with_a_process`）。どれも直した箇所を戻す変異で落ちることを確かめた
  - `usiok` 待ちの間の停止が上限を待たずに `Cancelled`（`spawn_cancellable` の取り消しの腕を消すと落ちる。1巡目は踏むテストが0本だった）
  - `initialize_engine` が後の起動に追い越されたら `Cancelled`、残るのは1本（旧実装に戻すと落ちる）
  - `initialize_engine` が2本重なっても残るのは1本（#525 / #367 の形。旧実装に戻すと落ちる）
  - 送れない値は動いているエンジンに触る前に断る（検査を `begin_start` の後へ移すと落ちる）
  - 落ちたエンジンへの `setoption` の失敗に直近の出力が載る（`with_recent_output` を外すと落ちる）
- `start_failure` の単体テスト: 名乗らなかったエンジン（`NO_ID_NAME`）は `NotUsi`、隔離は出力が終わった失敗だけを説明する

## 直した所見

1巡目の直しは1コミット `bb3bd9b5` にまとめた（同じファイルの中で所見が重なり、ファイル単位で割れない）。

- `id name` を欠いたエンジンが `ExitedEarly`（評価関数の失敗）に分類される → `NO_ID_NAME` で `StartupFailed` にし `NotUsi` へ（robustness / comment）
- 取り消した後に折れた起動が本物の失敗で返る → `start_engine` の失敗の出口で `cancel.is_cancelled()` なら `Cancelled`。`select!` を `biased` に。`spawn_cancellable` は起こす前と起こす段の最中にも取り消しを見る（robustness / rust）
- 検査が遅い（前のエンジンを落として起こしてから断る）・長さと件数を見ていない → `setup::validate_options` を入口に置き、対局の入口検査もこれに寄せた（robustness / rust）
- `setoption` の送信で落ちると出力が載らない（robustness）
- 起動失敗のログに種類しか残らない → 種類と `message` を載せる（robustness）
- `classify` が async の中で同期のファイル IO → `start_failure::describe` が `spawn_blocking` + 上限で読み、`classify` は純関数に（robustness / rust）
- `initialize_engine` が世代を見ずに `engine_id` を書く（architecture / rust / robustness / comment）→ 同じ世代（`begin_start` / `publish`）を通す
- 「解析と対局が同じ手順を通る」が偽（`apply_settings` が別に送っていた）→ `apply_settings` の送信を `setup::send_options` に寄せ、doc を現物に合わせた。**`readyok` を待たせるのはやめた**（フロントの停止が進行中の起動を待ってから止めるので、答えないエンジンで停止ごと固まる）
- `remaining` が2つ → 対局側は `setup::remaining` の包みに（architecture / comment）
- `send_setup` が2つで振る舞いが違う → 対局側を `send_game_setup` に改名（architecture / comment）
- `start_engine_impl` だけ `_impl` の規約から外れる → `start_analysis_engine_impl`（architecture / comment）
- `ensure_ready` の呼び手が0 → 消し、doc を `become_ready` へ移した（rust）
- `bridge.rs` の「本体のコメントに1つ」が指す先が消えた → 理由を `release_sessions` の doc へ移した（comment）
- `spawn_cancellable` の doc が `usiok` 後の取り消しを見ないことを書いていない（comment）
- `engine.md` の P1 の段落が P1 の定義と食い違う（comment）

## 送ったもの

- #600: フロントを `start_analysis_engine` へ切り替える（C2）。付随として、`start_analysis_engine_impl` が「効いている設定」を世代のロックの外で書く食い違い（architecture）。コードには `TODO(#600)`
- 設定の順序の喪失は既存の #579

## 機械にできなかったもの

- `mechanization-backlog.md` に2行足した（どちらも1件目）: コマンド名と `_impl` の対応 / async の中の同期のファイル IO
- 「`TIMED_OUT} before` の綴りを1箇所に」は入れていない。締切の目印を組む場所は registry・protocol・session にも正当に在る
- 取り消し後の失敗を `Cancelled` に畳む枝（`start_engine` の `Err(e) if cancel.is_cancelled()`）を踏むテストは無い。取り消しと競う待ちは全部 `biased` の `select!` が先に拾うので、この枝に届く順序をテストで作れない

## 見ていない範囲

- フロント（`src/`）: 差分に無い。`start_analysis_engine` の呼び手はまだ無い
- macOS の隔離属性付きバイナリを実際に起こしたときの失敗の形（`Quarantined` の分類はそれが出力の終わりとして届く前提）
- Windows 実機
