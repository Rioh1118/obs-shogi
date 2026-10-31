# En Croissant

- 立場: Tauri + React + Rust のチェス GUI。UCI。解析が主。**obs-shogi と同じ技術**
- 版: `franciscoBSalgueiro/en-croissant` `8c4a1e45893061cb50a5d3bd656818870dc3332b`（0.15.1）
- 取得日: 2026-10-31。ライセンス: GPL-3.0（コードは逐語で載せない）
- 等級: 下の `[確定]` は全てソースを読んだもの。**実行はしていない**

見る場所:

| 役割                  | パス                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| プロセスの土台        | `src-tauri/src/engine/process.rs`（`BaseEngine`）                                  |
| `go` の形             | `src-tauri/src/engine/types.rs`（`GoMode`）                                        |
| 解析の本体            | `src-tauri/src/chess.rs`（`EngineProcess` / `get_best_moves` / `get_engine_config`）|
| 対局                  | `src-tauri/src/game.rs`                                                           |
| 解析の駆動（画面側）  | `src/components/boards/EvalListener.tsx`                                          |
| 解析パネル            | `src/components/panels/analysis/{BestMoves,EngineSettingsForm,EngineSelection,LogsPanel}.tsx` |
| エンジン設定ページ    | `src/components/engines/EnginesPage.tsx` / `AddEngine.tsx` / `EngineForm.tsx`      |
| 設定の型              | `src/utils/engines.ts` / `src/state/atoms.ts`                                     |

## 1. オプションの見せ方

**同じエンジンの設定が2か所にある。** 解析パネルの歯車（よく使う3つ）と、エンジンページの「Advanced settings」（全項目）。

エンジンページ（`EnginesPage.tsx` の `EngineSettings`）[確定]

| 型     | 部品                                                                                        |
| ------ | ------------------------------------------------------------------------------------------- |
| spin   | **常に `NumberInput`。** min/max を渡す。スライダーにする分岐は無い                         |
| combo  | `Select`                                                                                    |
| string | `TextInput`。例外が2つ（下）                                                                |
| check  | `Checkbox` の**2択**。spin 等とは別の格子にまとめて後ろに置く                               |
| button | **出さない。** `option.type !== "button"` で落とす                                          |

- 名前で部品を変える例外 [確定]
  - 小文字化した名前が `syzygypath` の string → `TextInput` + フォルダ選択ボタン（複数選択可。Windows は `;`、それ以外は `:` で連結）
  - 小文字化した名前に `file` を**含む** string → `FileInput`（クリックでファイル選択。クリア可）
- filename 型: **非該当。** UCI の型に無い。`src/bindings/generated.ts` の `UciOptionConfig` にも無く、上の名前の判定で代替している [確定]
- 既定に戻す: 「Reset to default」ボタン（`Engines.Settings.Reset`）。`MultiPV` / `Threads` / `Hash` だけをエンジンの既定値にして、他の保存値は消す [確定]
- 変えた値の印: **無い。** 探した場所 `EnginesPage.tsx` 全文 [確定]
- 絞り込み: **オプションの絞り込みは無い。** 検索欄はエンジン一覧（名前・id・種類・パス・版・Elo）の絞り込みだけ（`filteredEngines`）[確定]
- 先頭化: **無い。** エンジンが返した順のまま（check だけ後ろの別格子）。`MultiPV` 等を先頭に寄せる処理も無い [確定]
- 項目名の表示: エンジンが返した名前をそのまま `label` にする。翻訳も説明も無い [確定]
- `UCI_Chess960` のチェックボックスは無効化される [確定]
- 「Edit JSON」でエンジンの設定全体を JSON で直接編集できる（`JSONModal`。zod で検証し、不正なら `Invalid Configuration`）[確定]

解析パネル（`EngineSettingsForm.tsx`）[確定]

| 項目    | 部品                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------ |
| MultiPV | `LinesSlider`。**名前はスライダーだが中身は `SegmentedControl`。1〜5 の固定5択**                        |
| Threads | `CoresSlider`。**同じく `SegmentedControl`。** 2 の累乗で `navigator.hardwareConcurrency` まで。現在値が列に無ければ足す |
| Hash    | `HashSlider`。**これだけ本物のスライダー。** log2 目盛り。上限は搭載メモリの半分（`memory_size` / 2）。ラベルは `formatBytes` |

**スライダーにする条件は「名前が `Hash`」だけで、範囲の広さではない** [確定]。
この3部品はいずれもエンジンが返した spin の `min` / `max` を使っていない（`CoresSlider.tsx` `LinesSlider.tsx` `HashSlider.tsx` に min/max の入力が無い）[確定]。
3項目ともエンジンが持っていなければ部品を出さない（`settings.find` の結果で分岐）[確定]。

## 2. 名前の違うオプションの呼び分け

`src/utils/engines.ts` の `requiredEngineSettings = ["MultiPV", "Threads", "Hash"]` が中心。
**完全一致で、別名の吸収（`USI_Hash` 型の読み替え）は無い** [確定]。

| 名前            | 特別扱い                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `MultiPV`       | 解析パネルの部品。既定値の補充。Rust 側で `real_multipv = min(MultiPV, 合法手数)`。対局では送らない（`BoardGame.tsx` で除外）。棋譜解析で上書き（`chess.rs`）。クラウド解析（lichess / chessdb）にも渡す |
| `Threads`       | 解析パネルの部品。既定値の補充                                                                               |
| `Hash`          | 解析パネルの部品。既定値の補充                                                                               |
| `UCI_Chess960`  | 利用者には触らせない。FEN が変わったとき Rust が局面から判定して送る（`set_options`）                        |
| `SyzygyPath`    | フォルダ選択の部品（小文字比較）                                                                             |
| 名前に `file`   | ファイル選択の部品（部分一致）                                                                               |

## 3. 起動の失敗

- タイムアウト: **無い。** `BaseEngine::init_uci` は `uci` → `uciok` 待ち → `isready` → `readyok` 待ちで、待ちは `reader.next_line()` の EOF まで。Rust 全体で `from_secs` / `timeout` を検索して、解析の時間制限に使うものは無い（当たったのは後述の 50ms sleep と対局の時計だけ）[確定]
- 設定で変えられるか: 無い（値が無い）[確定]
- 時間切れのときに起きること: **起きない。** 応答しないエンジンでは `get_best_moves` が返らず、画面は `Loading...` のまま [確定、実行はしていない]
- 起動そのものの失敗（`spawn` のエラー / 応答前に EOF）: `Error` が返り、画面側の `unwrap`（`src/utils/unwrap.tsx`）が赤いトースト `title: "Error"`、本文はエラーの文字列を出す。EOF の文言は `Engine disconnected`（`src-tauri/src/error.rs`）[確定]
- エンジン追加時（`get_engine_config`）は `uci` のみ送り `uciok` まで読む。`isready` は送らない。これもタイムアウト無し [確定]
- ファイルが無いエンジンは一覧で赤字 + `(file missing)`（`EngineName`）[確定]

## 4. 異常終了

- 解析中の検知: `get_best_moves` の読み取りループが EOF で抜ける。`info!` のログを出してプロセスの表から消し `Ok(None)` を返す [確定]
- 利用者への見せ方: **無い。** エラーにならないのでトーストも出ない。画面は最後の読み筋を出したまま [確定、実行はしていない]
- 自動の再起動: **明示の仕組みは無い。** ただし表から消えた後に局面や設定が変わると `get_best_moves` が新しくプロセスを作るので、**結果として次の操作で起動し直す** [確定、実行はしていない]
- 対局中: `wait_for_bestmove` が `EngineDisconnected` を返すと、エンジン側の `Abandonment` 負けで対局を終える（`game.rs`）[確定]
- stderr は `log::error!` に流すだけで画面のログには入らない（`BaseEngine::spawn`）[確定]

## 5. 停止

- `stop` の後 `bestmove` を**待たない。** `get_best_moves` は stop → **50ms の sleep** → `set_options` → `go`（`chess.rs`）[確定]
- 上限・kill までの時間: **無い。** `stop_engine` は `stop` を送るだけ。`kill_engine` は `quit` を送るだけで、応答しないときに kill へ進む時限は無い [確定]
- `Child` の kill は `Drop` と、アプリ終了時の `kill_sync`（`main.rs` の `ExitRequested`）だけ [確定]
- 解析パネルの停止アイコン（Tooltip `Kill engine`）は `kill_engine` + `enabled: false` [確定]
- 遅れて届く `bestmove` の捨て方: **検索の識別子は無い。** 読み取りループは `bestmove` を受けると、その時点の `proc.options` の fen / moves を付けた `BestMovesPayload`（`progress: 100`）を出す。つまり**遅れた `bestmove` は新しい局面のものとして送られる**（`last_best_moves` は `set_options` で空にされている）[確定、実行はしていない]
- 遅れた `info`: `parse_uci_attrs` がその時点の局面で手を解釈し、失敗すれば `warn!` で捨てる。`multipv` の順と depth の揃いも見る [確定]
- 画面側の突き合わせ: `EvalListener` が `payload.engine / tab / fen / moves` を今の探索対象と比べて、違えば捨てる。**結果を局面で識別している** [確定]

## 6. 再開

- 局面が変わったとき: `EvalListener` の `useThrottledEffect`（50ms）が依存値の変化で `getBestMoves` を呼ぶ [確定]
- 順序: stop → 50ms → （変わった `setoption` だけ）→ position → go [確定]
  - 局面が同じで `options` と `go_mode` も同じで走行中なら何も送らず、最新の結果を返す（`get_best_moves` の早期 return）[確定]
- `isready` / `ucinewgame` は解析では送らない（`ucinewgame` は `src-tauri/src` に出現なし。検索語 `ucinewgame`）[確定]
- 解析の自動再開: **する。** タブごとのエンジンの `enabled` が true の間、盤を動かせば追従する [確定]
- `enabled` の初期値は false。再生ボタン（`IconPlayerPlay`/`Pause`）で切り替える。`atoms.ts` の `tabEngineSettingsFamily` [確定]
- 終局局面: `stopEngine` を呼ぶ。画面は `Game is over` [確定]
- 不正な局面: `get_best_moves` が stop して `Ok(None)`。画面は `Invalid position: …` [確定]
- 「相手の脅威を見る」（`threat`）は手番を入れ替えた FEN で同じ経路を通る [確定]
- 解析中の盤移動の特別扱い（ロック等）: 無い [確定]。エンジンはタブ × エンジンで1プロセス（`engine_processes` のキー `(tab, id)`）

## 7. 解析中の設定変更

- 同じエンジンプロセスに `setoption` で送る。**再起動しない。** 探索は**止める**（5 の stop → 50ms → `set_options` → `go`）[確定]
- `set_options` は前回の `extra_options` に無い項目だけを送る（差分）[確定]
- `Threads` / `Hash` も同じ経路で、走行中のプロセスに対して送る。再起動の分岐は無い [確定]
- `Hash` のスライダーは `onChangeEnd` で確定する（ドラッグ中は送らない）[確定]
- 設定の適用はタブ単位。`Sync globally` がオンなら保存値にも反映（6 ではなく 12）[確定]

## 8. ログ

- 解析パネルの `Logs` タブ（`LogsPanel.tsx` → `EngineLogsView.tsx`）。ロード済みエンジンが無いと無効 [確定]
- 表示: 行ごとに `GUI` / `Engine` のバッジ。絞り込み（All / GUI / Engine）、文字列フィルタ（`Filter logs...`）、仮想スクロール、更新ボタン（`Refresh logs`。自動更新ではなく手動）、ファイル書き出し（`Export logs`）[確定]
- エンジンの選択は `Select`。対局画面にも同じビューがある（`BoardGame.tsx`）[確定]
- 実体は `BaseEngine.logs: Vec<EngineLog>` で、**上限なし・プロセスと同じ寿命**。プロセスが消えると空が返る（`get_engine_logs`）[確定]
- 手でコマンドを送る欄は無い。探した場所 `EngineLogsView.tsx` `LogsPanel.tsx` [確定]

## 9. 探索の制限

`GoMode`（`types.rs`）: `go depth N` / `go movetime N` / `go nodes N` / `go infinite` / `go wtime … btime … winc … binc …` [確定]

- 画面の選択肢は `GoModeInput.tsx`: Time / Depth / Nodes / Infinite（対局では Infinite を外す）[確定]
- 切り替え時の初期値: Depth 20 / Nodes 1000000 / Time 8000（ms）[確定]
- `tabEngineSettingsFamily` の既定は Infinite [確定]
- 位置: 解析パネルの歯車の中と、エンジンページの `Search settings`。エンジンごとに持つ [確定]
- 1回の `go` に制限は1種類だけ。組み合わせる形は無い [確定]
- `searchmoves` は無い（`to_uci_string` に無い）[確定]

## 10. 状態の見せ方

解析パネルのエンジン行（`BestMoves.tsx`）[確定]

| 状態                           | 見せ方                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| エンジン未登録                 | `No engines installed. Please Add an engine first.`（エンジンページへのリンク） |
| 未選択                         | 選択画面でカードのチェックボックスをオンにする（`EngineSelection.tsx`）  |
| 無効（enabled false）          | 本文 `Engine isn't enabled`。再生アイコン                                |
| 読み込み中（結果がまだ無い）   | 名前の横に `Loading...` の `Code` 札。本文は MultiPV 本数分の `Skeleton` |
| 解析中                         | 名前の横に `{nps}n/s` の札（Tooltip `How fast the engine is running`）。`Eval` / `Depth` / `Nodes` の数字。下に `Progress`（`animated`）|
| 手動で無効にしたまま途中       | `Progress` が `striped`                                                 |
| 完了（progress 100）           | `n/s` の札が消える                                                      |
| 終局                           | `Game is over`                                                          |
| 候補なし                       | `No analysis available`                                                 |

- 進捗は Depth / Time / Nodes なら比率。Infinite は 99.99 に固定（`get_best_moves`）[確定]
- **「起動中」と「探索開始後の最初の結果待ち」を分ける表示は無い。** どちらも `Loading...` [確定]
- エンジンページ: 未登録 `No engines installed` + `Add an engine to get started`、未選択 `No engine selected` [確定]

## 11. 評価関数・定跡などのファイルの扱い

- **オプションとして扱う。** 専用の欄は無い。名前に `file` を含む string と `SyzygyPath` に部品を付けるだけ（1 参照）[確定]
- GUI 側の定跡（UCI エンジンの外）で解析を止める仕組み: 探した場所 `EvalListener.tsx` `chess.rs`、該当なし [確定]
- 別に公式エンジンの配布カタログがあり、`https://www.encroissant.org/engines` から取得してインストールする（`useDefaultEngines`）。NNUE 等のファイルの個別管理は無い（探した場所 `AddEngine.tsx`）[確定]

## 12. 設定の持ち方

- 保存先 `engines/engines.json`。`Engine[]`（`atoms.ts` の `enginesAtom`）[確定]
- 1エントリの中身: id / name / version / path / image / elo / go / settings（名前と値の配列）[確定]
- 同じ実行ファイルに複数設定: **できる。** 「Duplicate」で id を振り直し `… (Copy)` として複製（`EnginesPage.tsx`）[確定]
- **タブごとの上書きがある。** `tabEngineSettingsFamily` がタブ × エンジンで enabled / go / settings / synced を持ち、`Sync globally` がオンの間だけ保存値と同期する（既定 `synced: true`）[確定]
- `settings` に残るのは既定と違う値と必須の3つだけ。既定に戻すと項目ごと消す（`setSetting`）[確定]
- エンジン更新時の引き継ぎ: **移行処理は無い。** 名前で照合するだけ。オプションの定義はエントリに保存せず、開くたび `get_engine_config` で問い合わせる（`useSWRImmutable` のキーはパス）[確定]
  - 新版で消えた項目が `settings` に残っていれば `setoption` に送られる。既知の項目かを確かめる処理は無い（`EvalListener` は `settings.settings` を全て渡し、`set_options` もそのまま送る）[確定、実行はしていない]
- パスの変更欄はエンジンページに無い。変えるなら Edit JSON [確定]
