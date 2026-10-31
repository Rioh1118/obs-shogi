# Nibbler

- 立場: Electron の Leela（Lc0）向け解析 GUI。UCI。解析が主。従来型エンジン（Stockfish）も動く
- 版: `rooklift/nibbler` `67f9c93399da4acf164b032c2b259812c1f9b6fc`（2.5.9）
- 取得日: 2026-10-31。ライセンス: GPL-3.0（コードは逐語で載せない）
- 等級: 下の `[確定]` は全てソースを読んだもの。**実行はしていない**

見る場所:

| 役割                 | パス                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| エンジン層           | `files/src/renderer/90_engine.js`（冒頭に探索の4状態の説明がある）           |
| 振る舞いの決定       | `files/src/renderer/95_hub.js`（`behave` / `set_uci_option` / `engine_start`）|
| メニュー             | `files/src/main.js`                                                          |
| 状態表示             | `files/src/renderer/83_statusbox.js`                                         |
| 情報の取り込み・stderr | `files/src/renderer/80_info.js`                                            |
| エンジンごとの保存   | `files/src/modules/engineconfig_io.js`                                       |
| 文言                 | `files/src/modules/messages.js`                                              |

## 1. オプションの見せ方

**オプションのダイアログが無い。** エンジンの `option` を一覧にする画面が無く、設定は**メニューの固定項目**だけ（`main.js` の `Engine` メニュー）[確定]。
エンジンが返した option は `known_options` に保存するが、表示には使わない（`known()` の判定に使う）[確定]。

| 型 / 項目          | 見せ方                                                                               |
| ------------------ | ------------------------------------------------------------------------------------ |
| spin               | 一般の部品は無い。下の項目だけ**固定値のサブメニュー**（チェック付き）               |
| スライダー         | **オプションには使わない。** 探した場所 `main.js` のメニュー定義。`31_sliders.js` は駒の利きの生成で別物|
| check / combo      | 一般の部品は無い                                                                     |
| button             | 一般の部品は無い。`pressbutton` はあるが、一覧からは押せない                         |
| ファイル           | `Engine` メニューの項目から OS のファイルダイアログ（下の 11）                       |
| 既定に戻す         | 項目別。`Weights` の `Set to <auto>`、`Syzygy` の `Unset`、`WDL` の `Use default WDL`。全体の一括リセットは無い |
| 変えた値の印       | メニューのチェック。エンジンへ送った値の ack（`send_ack_setoption`）で付く           |
| 絞り込み・先頭化   | 非該当（一覧が無い）                                                                 |

- 固定値の例: Threads 128〜1 の18段、Hash 120GB〜0GB の10段（`I want other hash options!` は engines.json を手で直す案内）、MultiPV 5 段 [確定]
- 一覧にない項目の口 [確定]
  - `engines.json` を手で編集する（`Dev` メニューの `Show engines.json` / `Reload engines.json (and restart engine)`）
  - `Custom scripts`: `setoption` 等を並べたテキストをエンジンへ流す。`position` `go` `stop` `ponderhit` `quit` で始まる行は既定で拒否（`run_script`。`Dev` の `Allow arbitrary scripts` で解除）
- `Dev` の `List sent options` で送信済みの値を一覧する（`show_sent_options`）[確定]

## 2. 名前の違うオプションの呼び分け

あり。**ただしエンジンの系統で分ける**（`10_globals.js` `90_engine.js`）[確定]。

- 系統の判定: `id name` に `config.leelaish_names`（`Lc0` `Leela` `Ceres`）を含めば leelaish（`receive_misc`）[確定]
- ファイル名に `lc0` を含むと起動引数に `--show-hidden` を足す（`setup`）[確定]
- `GUI_WANTS_TO_KNOW`（値の ack を受ける一覧）: `Backend` `EvalFile` `WeightsFile` `SyzygyPath` `Threads` `Hash` `MultiPV` `ContemptMode` `Contempt` `WDLCalibrationElo` `WDLEvalObjectivity` `ScoreType` `Temperature` `TempDecayMoves` [確定]
- 起動時に送る組（`engine_send_all_options`）[確定]

| 組                     | 内容                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `forced_lc0_options`   | 既知か確かめず送る。`LogLiveStats` `MoveOverheadMs` `MultiPV: 500` `ScoreType` `SmartPruningFactor` `UCI_ShowWDL` `VerboseMoveStats` |
| `standard_lc0_options` | 既知なら送る。`ContemptMode` `Contempt` `WDLCalibrationElo` `WDLEvalObjectivity`                        |
| `forced_ab_options`    | 空                                                                                                     |
| `standard_ab_options`  | 既知なら送る。`Contempt` `Move Overhead` `UCI_ShowWDL`                                                  |

- 利用者の値は最後に送る（上書き可）。**`Hash` は必ず最後**に並べ替える（`engine_send_all_options`）[確定]
- leelaish で `MultiPV` を変えようとすると拒否して `MultiPV should be 500 for this engine`（`set_uci_option`）[確定]
- 従来型の初回は `MultiPV` を 3 にし、`search_nodes_special` を 10000000 にする（`receive_misc`）[確定]
- `UCI_Chess960` は対応エンジンなら常に true を送る（`setup` の option 処理）[確定]
- 大文字小文字: 既知判定と送信済みの記録は小文字に正規化する（`known_options` `sent_options`）[確定]

## 3. 起動の失敗

- タイムアウト: **無い。** `uci` / `isready` の待ちに時計が無い。`90_engine.js` `95_hub.js` の `setTimeout` は `shutdown` の kill と、応答待ちに関係しない用途（手の適用の再帰回避、描画のループ）だけ（検索語 `setTimeout` `setInterval`）[確定]
- 設定で変えられるか: 無い [確定]
- 応答しないとき: 状態欄が `Awaiting uciok from engine` / `Awaiting readyok from engine` のまま。**それ以上は起きない** [確定]
- `uciok` と `readyok` の前は `set_behaviour` と `set_search_desired` が何もしない（`go` を送れない）[確定]
- 起動時の順序: `uci` → `uciok` → 全オプション送信 → `isready` → `readyok` → halt を確実にして `ucinewgame` [確定]
- 起動時の失敗の文言 [確定]
  - ファイルが無い: `Engine not found. Please find the engine via the Engine menu. You might also need to locate the weights (neural network) file.`
  - `spawn` の例外: `Engine failed to start.`
  - 切替・再起動の失敗: `Failed to start this engine.` / `Failed to restart the engine.`（alert）
  - `spawn` の `error` イベント: エラー文字列を alert
- 起動直後は stderr と標準出力の非 UCI 行が情報欄に出る（`displaying_error_log`。起動後5秒以内で info 未受信など）[確定]

## 4. 異常終了

- 検知: **プロセスの終了イベントを聞いていない。** `exe` の `exit` / `close` のハンドラが無い。`once("error")` のみ（検索語 `"exit"` `"close"`、`90_engine.js` `95_hub.js`）[確定]
- 実際に気づくのは次の書き込みの失敗: `Sending to the engine failed. This usually means it has crashed.` を alert。**1エンジンにつき1回だけ**（`warn_send_fail`）[確定]
- 走行中に落ちると `search_running` は残るので、解析の状態は変わらない [確定、実行はしていない]
- 自動の再起動: **無い。** `Engine` メニューの `Restart engine` を手で押す（`restart_engine`）[確定]
- 別口の検知: `info string ERROR` を情報欄に赤で出す。stderr に `warning` `error` `unknown` `failed` `exception` を含む行があると赤にして10秒間情報欄をログ表示に切り替える（`err_receive` `displaying_error_log`）[確定]
- レンダラの異常: `The renderer process has crashed. Experience suggests this happens when Leela runs out of RAM…`（`messages.renderer_crash`）[確定]

## 5. 停止

- `stop` の後は**必ず `bestmove` を待ってから次を送る。** 待ちは状態（`search_running` と `search_desired`）で表す。ファイル冒頭の説明が4状態を書いている [確定]
- 上限: **kill へ進む時限は無い。** 500ms を超えると状態欄に `Desync... (restart engine via Engine menu)` を出すだけ（`unresolved_stop_time` `83_statusbox.js`）[確定]
- 終了時（`shutdown`）: `quit` を送り **2000ms 後に `exe.kill()`** [確定]
- 遅れて届く `bestmove` の捨て方: **探索オブジェクトの同一性で区別する**（`handle_bestmove_line`）[確定]
  - `search_desired === search_completed` のときだけ採用
  - 別のものを待っていれば `(ignore old)` で捨てて次を送る。止めたかっただけなら `(ignore halted)`
  - 同じ条件でも別オブジェクトなら別の探索として扱う（halt 直後の再開など）
- 遅れて届く `info` [確定]（`handle_info_line`）
  - `search_running` が無い、ノードが消えた → 捨てる
  - **従来型エンジンでは** `search_desired.node !== search_running.node` の間（停止中の移行）を捨てる
  - `info` は `search_running` を添えて渡す。`engine_cycle` / `engine_subcycle` を `go` ごとに進める

## 6. 再開

- 順序: stop → `bestmove` 受信 → （保留していた `setoption`）→ `position` → `go` [確定]
- `stop` は要求が変わるたびに送る。止まるのを待つ間に要求が変わっても `search_desired` を差し替えるだけで、始まらなかった探索は `position` も `go` も送らない [確定]
- **解析の継続は「振る舞い」（`config.behaviour`）で決まる**（`behave`）[確定]

| 値                             | 局面が変わったとき                                  |
| ------------------------------ | --------------------------------------------------- |
| `halt`                         | 止まったまま（起動時の値。`config_io.js`）          |
| `analysis_free`                | 新しい局面で `go`（盤に追従）                       |
| `analysis_locked`              | 動かさない。ロックしたノードを解析し続ける          |
| `auto_analysis` / `back_analysis` | 指定条件で次の局面へ進めながら解析               |
| `play_white` / `play_black` / `self_play` | 手番の側でだけ `go`                        |

- メニューは `Go` / `Go and lock engine` / `Halt` / `Auto-evaluate line` / `Auto-evaluate line, backwards`（`Analysis`）[確定]
- 新しいゲームを読んだら halt にして `ucinewgame`（`suppress_ucinewgame` で抑止可）[確定]
- 終局局面は `search_desired` を空にする（`send_desired` `__go`）[確定]
- `position` は `startpos` か fen + `moves`。木の根からの手順を毎回送る [確定]

## 7. 解析中の設定変更

- その場では送らない。**解析を halt にしてから送る**（`set_uci_option` の中で `set_behaviour("halt")`）[確定]
- `setoption` は `search_running` の間は `setoption_queue` に溜め、`bestmove` の後に送る（`send` `send_queued_setoptions`）[確定]
- **再起動はしない。** 解析の再開も自動ではない（`HALTED (go?)` を押す）[確定]
- 送信した文字列を青字で状態欄に3秒出す（`set_special_message`）[確定]
- `uciok` より前に変えようとすると `Please wait till the engine has loaded before setting options.` [確定]
- エンジンが知らない名前は `… not known by this engine` で送らない [確定]
- `Contempt` 系を変えるときは Lc0 に `ClearTree` を続けて送る（`set_uci_option_permanent_and_cleartree`）[確定]

## 8. ログ

- **画面でコマンドの行を見る口は無い。** ログはファイルへ出す（`Dev` > `Logging` > `Use logfile...` / `Disable logging`。`Log`、`20_utils.js`）[確定]
- 行の形: 送信 `--> `、受信 `< `、stderr `. `。捨てた理由つき `(ignore old) < ` など [確定]
- 設定: `log_info_lines` `log_useless_info` `log_illegal_moves` `log_positions` `logfile_timestamp` `clear_log`（`config_io.js`。`info` 行は既定で記録しない）[確定]
- 画面で見えるのは stderr と非 UCI 行を集めた情報欄（`Dev` > `Show error log`）。`error_log` は 50000 文字で打ち切り [確定]
- `Show engine state` で状態欄に `running` / `desync` / `stopped` と振る舞い、最後の送信行を出す [確定]

## 9. 探索の制限

`send_desired` が作る形 [確定]

- `go infinite`（上限なし）
- `go nodes N`
- `go movetime N`（`Limit by time instead of nodes` を入れたとき）
- 上のいずれかに ` searchmoves …` を足す（`searchmoves_buttons` がオンで指定があるとき）
- `go depth`: **無い**（検索語 `go depth`、`90_engine.js`）

- 上限はエンジンごとに2本: 通常の `search_nodes` と、自動評価・対局用の `search_nodes_special`（`engineconfig_io.js`）[確定]
- メニューの段: `Limit - normal`（Unlimited / 1,000,000,000 〜 1）と `Limit - auto-eval / play`。`Up slightly` / `Down slightly` は `limit_options` の表を動く [確定]
- 既定は `search_nodes: null`（無制限）[確定]

## 10. 状態の見せ方

状態欄（`83_statusbox.js`。優先順に）[確定]

| 状況                         | 表示                                                     |
| ---------------------------- | -------------------------------------------------------- |
| 読み込み中                   | 黄字の読み込み文言 + 赤字 `(abort?)`                     |
| `show_engine_state` オン     | `running` / `desync` / `stopped` + 振る舞い + 最後の送信 |
| `uciok` 待ち                 | `Awaiting uciok from engine`（黄）                       |
| `readyok` 待ち               | `Awaiting readyok from engine`（黄）                     |
| 一時メッセージ               | 指定色で表示（既定3秒）                                  |
| stop の未解決が 500ms 超     | `Desync... (restart engine via Engine menu)`（黄）       |
| ロック中                     | `Locked to … (return?)`（青。クリックで戻る）            |
| 終局                         | 終局の理由                                               |
| 停止                         | `HALTED (go?) `（黄。クリックで開始）                    |
| 停止へ移行中                 | `HALTING... `（黄）                                      |
| 解析中                       | `ANALYSIS (halt?) `（緑。クリックで停止）                |
| 自動                         | `Auto-eval!` / `Back-eval!` / `Self-play!` / `YOUR MOVE` |

- 文字列はクリックで操作できる（`gobutton_clicker` `haltbutton_clicker`）[確定]
- エンジン無しの場合: 上の `Engine not found…` を情報欄に青字で出す（`engine_start(…, true)`）。ダミーのエンジンオブジェクトが居る [確定]

## 11. 評価関数・定跡などのファイルの扱い

- **ファイルは専用のメニュー項目**だが、**中身は UCI オプションの送信**（`set_uci_option_permanent`）[確定]

| メニュー                                   | 送るオプション    |
| ------------------------------------------ | ----------------- |
| `Weights` > `Lc0 WeightsFile...`           | `WeightsFile`     |
| `Weights` > `Stockfish EvalFile...`        | `EvalFile`        |
| `Choose Syzygy path...`                    | `SyzygyPath`      |
| `Backend`（値の一覧）                      | `Backend`         |

- `Set to <auto>` は保存値を消してエンジン再起動（`auto_weights`）。`Unset` も同様（`disable_syzygy`）[確定]
- `wrong_engine_exe`: 想定外のファイルを選んだ場合の文言がある [確定]
- ダイアログの初期フォルダは種類別に覚える（`weights_dialog_folder` `evalfile_dialog_folder` `syzygy_dialog_folder`）[確定]
- 定跡: **エンジンのオプションではなく GUI 側の機能。** Polyglot / PGN を読んで矢印で出す（`63_polyglot.js`、`config.book_explorer`）[確定]
- 対局ではその定跡で手を指す（`maybe_setup_book_move`）。その間エンジンは halt [確定]

## 12. 設定の持ち方

- 保存先 `engines.json`。**実行ファイルのパスをキーにした1エンジン1エントリ**（`engineconfig[filepath]`）[確定]
- 1エントリ: `args`（起動引数）/ `options`（名前 → 値）/ `search_nodes` / `search_nodes_special` / `limit_by_time`（`newentry`）[確定]
- 同じ実行ファイルに複数設定: **持てない**（キーがパス）[確定]
- 別エンジンへの切替はメニュー（`Choose engine...` / `Choose known engine...`）。切替時は新しいプロセスを立ててから古い方を shutdown（`engine_start`）[確定]
- エンジン更新時の引き継ぎ: **同じパスに上書きならそのまま残る。** パスが変わると別エントリ。移行処理は無い [確定]
- 別バージョン移行の文言: 2.1.1 でエンジンごとの保存に移ったとき `engine_options_reset` を出す [確定]
- 保存値は `known()` を通さず全て送る（`engine_send_all_options` の利用者の値）[確定]
- `engines.json` が壊れていれば修復して読む（`debork_json`）。読めなければ `While loading engines.json: …` [確定]
