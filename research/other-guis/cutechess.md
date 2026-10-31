# cutechess

- 立場: Qt のエンジン対局管理（GUI と `cutechess-cli`）。UCI / xboard。エンジン開発者向け
- 版: `cutechess/cutechess` `5e84232be4546aaedc9d87a96c91867a1da06ada`
- 取得日: 2026-10-31。ライセンス: GPL-3.0（コードは逐語で載せない）
- 等級: 下の `[確定]` は全てソースを読んだもの。**実行はしていない**
- **解析モードが無い。** 対局専用なので、解析の問いは「非該当」が多い

見る場所:

| 役割                 | パス                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| 土台（時計・状態）   | `projects/lib/src/chessengine.{h,cpp}` / `chessplayer.cpp`                    |
| UCI                  | `projects/lib/src/uciengine.cpp`                                              |
| 設定ダイアログ       | `projects/gui/src/engineconfigurationdlg.cpp` / `engineoptiondelegate.cpp` / `engineoptionmodel.cpp` / `projects/gui/ui/engineconfigdlg.ui` |
| 設定の保存           | `projects/lib/src/engineconfiguration.cpp` / `docs/cutechess-engines.json.5.txt` |
| 結果の文言           | `projects/lib/src/board/result.cpp`                                           |
| 回復                 | `projects/lib/src/tournament.cpp` / `gamemanager.cpp`                         |

## 1. オプションの見せ方

`Configure Engine` / `Add Engine` ダイアログの `Advanced` タブの**3列の表**（Name / Value / Alias）。
編集はセルをダブルクリックして出る部品（`EngineOptionDelegate::createEditor`）[確定]。

| 型       | 部品                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| spin     | **`QSpinBox`。** min/max を渡す。スライダーにする分岐は無い                          |
| combo    | `QComboBox`                                                                          |
| string   | `QLineEdit`                                                                          |
| filename | `PathLineEdit`（ファイル）。パス欄 + 選択ダイアログ。既定の場所は作業ディレクトリ    |
| check    | Value 列のチェックボックスの**2択**（`Qt::CheckStateRole`）                          |
| button   | **編集不可で表に出る**（`isEditable` が false）。起動時の送信からも除く（`applyConfiguration`）。**押す口が無い** |

- 既定に戻す: `Restore defaults` ボタン。全項目を `defaultValue` に戻す。**項目別は無い** [確定]
- 変えた値の印: **無い。** 探した場所 `engineoptionmodel.cpp`。`data()` に色や太字の分岐が無い [確定]
- 絞り込み: **オプションには無い。** 検索欄（`m_searchEngineEdit`）はエンジン一覧だけ（`enginemanagementwidget.cpp`）[確定]
- 先頭化: **無い。** エンジンが返した順 [確定]
- 別名: Alias 列で表示上の別名を付けられる。`getOption` は別名でも引ける [確定]
- `Detect` ボタン: エンジンを起動して option を取り直す。`Advanced` タブを開くと自動で走る（`onTabChanged`）。コマンド等が同じなら再実行しない [確定]
- 実行中は進捗バー（不定）を出し、ボタンを無効化する [確定]
- 別の型: `folder` 用の部品もある。作るのは `xboardengine.cpp` と保存値の復元（`engineoptionfactory.cpp`）で、UCI の `parseOption` からは作られない [確定]

## 2. 名前の違うオプションの呼び分け

**`Threads` / `Hash` / `MultiPV` の特別扱いは無い。** `projects/` の `.cpp` / `.h` を `"Threads"` `"Hash"` `"MultiPV"` で検索して、`Hash` は評価表の列見出しだけ、他は該当なし [確定]。

特別扱いは UCI の予約名だけ（`UciEngine::parseLine`）[確定]

| 名前                                  | 扱い                                                                 |
| ------------------------------------- | -------------------------------------------------------------------- |
| `Ponder`                              | 表に出さない。`m_canPonder` を立て、対局開始時に設定の値を送る        |
| `UCI_Opponent`                        | 表に出さない。対局開始時に相手名を送る                                |
| `UCI_Variant`                         | 表に出さない。対応変則に足す                                          |
| `UCI_Chess960` ほか `UCI_<変則名>`    | 表に出さない。対応変則に足す                                          |
| `UCI_LimitStrength` / `UCI_Elo`       | **`UCI_` のうちこの2つだけ表に出す**                                  |
| 上記以外の `UCI_*`                    | 表に出さない（`TODO` のコメントがある）                               |

## 3. 起動の失敗

定数（`chessengine.h`）[確定]

| 定数                          | 値       | 対象                                       |
| ----------------------------- | -------- | ------------------------------------------ |
| `defaultProtocolStartTimeout` | 35000 ms | `uci` → `uciok`                            |
| `defaultPingTimeout`          | 15000 ms | `isready` → `readyok`                      |
| `defaultIdleTimeout`          | 15000 ms | 5 を参照                                   |
| `defaultQuitTimeout`          | 5000 ms  | 5 を参照                                   |

設定で変えられるか: **変えられる** [確定]

- エンジンごとの倍率 `Scale Timeouts:`（`engineconfigdlg.ui`。Tooltip `Scale engine timeouts by this factor. Only use if necessary! Default: 1.00`）。JSON は `timeoutScaleFactor`、CLI は `tscale`
- 全体の値は QSettings の `Timing` グループ（`PingTimeout` `QuitTimeout` `IdleTimeout` `ProtocolStartTimeout`）。**画面は無い**（`projects/gui/` に検索語 `Timing` なし）
- 時間 = 倍率 × 値（`applyConfiguration`）

時間切れのとき [確定]

- `uciok`: `onProtocolStartTimeout` → エラー文字列 `Chess protocol was not started in time` → `onCrashed`（kill + `Disconnection`）
- `readyok`: `onPingTimeout` → `no response to ping` → kill + `StalledConnection`（`%1's connection stalls`）

見せる場所 [確定]

- 設定ダイアログの `Detect`: `QMessageBox::critical`（題 `Engine Error`、本文は上の文字列）
- 起動コマンドの失敗: `Cannot execute command: %1` / `Empty engine command` / `Unknown chess protocol: %1`（`enginebuilder.cpp`）
- 対局: `Could not initialize game`、`Game Error`（`mainwindow.cpp`）
- 実行は `process->waitForStarted()` で確かめる [確定]

## 4. 異常終了

- 検知: `QIODevice::readChannelFinished` → `onCrashed`（`ChessEngine::setDevice`）。意図した kill と quit の間は接続を外す [確定]
- 結果: 落ちた側の負け `Disconnection`。文言 `%1 disconnects` / `Draw by disconnection`（`result.cpp`）。PGN にも残る（`pgngame.cpp`）[確定]
- 自動の再起動 [確定]
  - **単発の対局: 無い。** 対局は終わる
  - **トーナメント: `recover` の設定次第。** オフなら `Disconnection` / `StalledConnection` で全体を止める。オンなら次の局で立て直す（`Tournament::onGameFinished` 近辺、`GameInitializer::initializeGame` が切断済みのプレイヤーを消して作り直す）
  - GUI は `m_recoverCheck`（`tournamentsettingswidget.cpp`）、CLI は `-recover`（`Restart crashed engines instead of stopping the game.`）
- 集計に `Discon` / `Stall` の列がある（`tournament.cpp`）[確定]
- 再起動の頻度: `restart=auto|on|off`（エンジンの設定。`restartsBetweenGames`）。`on` は局ごとに `quit` [確定]
- stderr: 画面には出ない。`stderrFile` を指定するとファイルに追記（`EngineBuilder::create`）[確定]

## 5. 停止

- `stop` の後 `bestmove` を**待つ。** `ChessEngine::stopThinking` が `stop` を送り `m_idleTimer` を動かす [確定]
- 上限: **`IdleTimeout`（15 秒、倍率あり）。** ただし**無言の時間**で測る。行が届くたびタイマーをやり直す（`onReadyRead`）[確定]
- 超えたら: `onIdleTimeout` → kill + `StalledConnection` [確定]
- 時間切れの猶予: 持ち時間 + `expiryMargin` + 200 ms で `onTimeout`。`ChessEngine::onTimeout` は `stopThinking`。先に `bestmove` が来ても `expired` なら `Timeout`（`chessplayer.cpp`）[確定]
- `quit`: 送信 → `QuitTimeout`（5 秒）内に切断されなければ kill（`onQuitTimeout`）[確定]
- 遅れて届く `bestmove` の捨て方: **`m_ignoreThinking` フラグ**（`uciengine.cpp`）[確定]
  - 捨てると決めたら立てて `stop`。**次の `bestmove` 1個を捨てて**フラグを下ろす
  - 立っている間は `info` も捨てる
  - 探索の識別子は無い。`stop` と `bestmove` が1対1である前提
- 対局終了時: `m_ignoreThinking` を立てて stop し、`ping(false)` で待つ [確定]
- 想定外: `state() != Thinking` の `bestmove` は `Unexpected move from …` の警告で捨てる。先読み中の早い `bestmove` は `Premature bestmove while pondering …` [確定]

## 6. 再開

**解析は非該当。** 対局内の近い経路は先読み外し [確定]（`UciEngine::makeMove`）

- 予想手が外れた: `m_ignoreThinking` を立てて `stop` → `position` と `isready` を `m_bmBuffer` に溜める → `bestmove` 受信で送る → `readyok` で次へ
- 手が来たとき: `position … moves …` を毎回全手順で送る
- `go` の直前の確認: `Observing` から `go` するときに `ping` する（`ChessEngine::go`）。`isready` が返るまで書き込みはバッファ（`m_pinging`）[確定]
- 局の開始順: `ucinewgame` → `Ponder` / `UCI_Opponent` → `position`（`startGame`）[確定]

## 7. 解析中の設定変更

**非該当。** 走行中の変更経路が無い [確定]。

- `ChessEngine::setOption` の呼び出しは `applyConfiguration` と `onProtocolStart` だけ（`projects/` を検索語 `setOption(` で検索）
- 設定は起動時に適用。`Starting` の間は `m_optionBuffer` に溜めて、`uciok` の後に送る
- 新規対局ダイアログの設定ボタンは開始前の編集（`newgamedlg.cpp`）
- 不正な値は `Invalid value for option …`、未知の名前は `… doesn't have option …` の警告で送らない [確定]

## 8. ログ

- GUI: `Engine Debug` のドック（既定で閉じている。`View` メニュー）。`PlainTextLog`（`mainwindow.cpp`）[確定]
- 行の形: 送信 `>名前(id): 文字列`、受信 `<名前(id): 文字列`（`ChessEngine::write` `onReadyRead`）[確定]
- 対局の切替でクリアする [確定]
- コマンドを手で送る欄は無い（`PlainTextLog` の接続先は表示のみ）[確定]
- CLI: `-debug`（`Display all engine input and output.`）[確定]
- `Debug` のチェック（UCI のみ）: エンジンへ `debug on` を送る [確定]
- 起動時の任意文字列: `Init Strings`（`initStrings`）[確定]

## 9. 探索の制限

`UciEngine::startThinking` の形 [確定]

- `go wtime … btime … [winc …] [binc …] [movestogo …]`
- `go movetime N`（1手あたりの時間）
- `go infinite`（時間制限なし かつ ply / nodes 制限なし）
- 上に ` depth N` / ` nodes N` を足せる（時間と併用可。`tc=inf` + `depth` の形もある）
- `go ponder …`（先読み）

時間設定は `TimeControl`。CLI は `tc=` `st=` `depth=` `nodes=` `timemargin=`（`docs/cutechess-cli.6.txt`）[確定]

## 10. 状態の見せ方

- **起動中・読み込み中の表示は対局画面に無い。** エンジンの状態（`Starting` / `Idle` / `Thinking` / `Observing` など）を文字で出す箇所は `projects/gui/src/` に無い（検索語 `Idle` `Starting` `Thinking` `Observing`。`gamewall.cpp` が時計の分岐に使うだけ）[確定]
- 思考中はチェスクロックが動く（`startedThinking` → `clock start`）[確定]
- 評価: `EvalWidget` の2表。統計（NPS / Hash / Pondermove / Ponderhit / TB）と読み筋（Depth / Time / Nodes / Score / PV）[確定]
- 結果: 対局結果の文字列（`result.cpp`）[確定]
- 設定ダイアログ: 不定の進捗バー（1 参照）[確定]
- エンジン無し: 新規対局ダイアログで、その変則に使えるエンジンが0件なら両者を Human にして CPU の選択肢を無効化する。**文言は出ない**（`NewGameDialog::onVariantChanged`）[確定]

## 11. 評価関数・定跡などのファイルの扱い

- 評価関数: **オプションのまま。** 専用の欄は無い（`filename` 型なら選択部品が付く）[確定]
- 定跡: **GUI 側の機能**が別にある。Polyglot の開始局面として対局・トーナメントの設定で渡す（`ChessGame::setOpeningBook`、CLI の `book=` `bookdepth=`）[確定]
- エンジンの `OwnBook` を切る等の連動: 無い（検索語 `OwnBook`）[確定]

## 12. 設定の持ち方

- 保存先 `engines.json`。配列で、**名前が一意**（`Duplicate engine name` / `An engine with this name already exists`）[確定]
- 1エントリ: `name` `command` `workingDirectory` `stderrFile` `protocol` `initStrings` `whitepov` `ponder` `timeoutScaleFactor` `restart` `validateClaims` `debug` `variants` `options`（`engineconfiguration.cpp`）[確定]
- `options` は**型・既定値・範囲ごと保存**する（`toVariant` / `EngineOptionFactory`）[確定]
- 同じ実行ファイルに複数設定: **できる。** `Clone` ボタン（`enginemanagementwidget.cpp`）[確定]
- CLI は `conf=名前` で同じファイルを読む [確定]
- エンジン更新時の引き継ぎ [確定、実行はしていない]
  - `Detect` は保存済みの設定を適用した状態でエンジンを起動し、`options()` を取り直す
  - **同じ名前の項目は値が残り**、消えた項目は `doesn't have option` の警告で落ち、増えた項目は既定で入る
  - `Detect` は開いたときコマンドが変わっていれば走る。変わっていなければ走らない
