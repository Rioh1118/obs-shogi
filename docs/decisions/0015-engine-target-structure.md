# ADR-0015: エンジン周りの目標の構造を Rust と TS をまたいで1つに決める

- 状態: 採用
- 日付: 2026-11-05
- 決めたもの: `/decide`（人の確認なし。見てほしい点は PR の確認事項に残す）
- 関連: ADR-0008（`engine/` のレイヤ）/ ADR-0009（crate とレイヤ）/ ADR-0011（対局の語）/ ADR-0012（画面の語）
- 棚卸し: `docs/audits/2026-11-engine.md`

## 文脈と問題

読みやすさの整理（`docs/readability-progress.md`）は範囲ごとに進めてきた。範囲の中は揃ったが、
範囲をまたぐものが残った。基点 20b74095 で横断に棚卸しすると、次が出た（全件は棚卸しのファイル）。

- 1つのモジュールが呼び手の違う2つの判断を持つ（`engine/utils.rs`、TS の `entities/engine` が AI ライブラリを抱える）
- 「何も決めない」レイヤ（`types`）が、検討の出来事の trait とその契約を持つ
- 線に出す形が2か所に割れる（`analyzer.rs` の `DepthOutcome`）
- 2つのスライスが互いを読む（`entities/app-config` ⇄ `entities/engine-presets`）
- barrel の無いスライスに、外から36ファイルが深い import で入る（`entities/engine-presets`）
- 「検討」をコメントで「解析」「分析」と書く。「解析」は棋譜解析のために取ってある（ADR-0012）

どれも範囲の中だけを見ていると見えない。残りの範囲（Rust の 5c 以降）を取る前に、
置き場の規則を決めておかないと、範囲ごとに別の答えが出る。

## 判断の基準

1. 利用者の明示した言葉: 線の名前（Tauri コマンド、serde の欄、イベント名、`engine_presets.json`）を変えない。
   USI の語はフロントへ出さない。読ませ続ける機能は「検討」、「解析」は棋譜解析
2. R-DEC-1: 振る舞いを変えない。変わる直しは Issue か `docs/IDEAS.md` へ送る
3. R-DEC-2: ADR-0008 / ADR-0009 のレイヤの規則に揃える（正本は `LAYERS`。ここに写さない）
4. R-DEC-5: 決めたものは機械に落とし、次の範囲の整理が同じ判断を繰り返さないようにする

## 決定

### 1. エンジンは「1本のプロセス」を土台に、使い手を同位に並べる

Rust の `engine/` を4つの群で読む。**レイヤごとの辺の正本は `src-tauri/tests/layering.rs` の `LAYERS`** で、
ここは群の向きだけを書く。

| 群 | レイヤ | 何を決めるか |
| --- | --- | --- |
| 土台 | `launchable` `types` `candidates` `logging` `child` `option_line` | 線の形、`info` 行の集約、ログの予算、子プロセス、申告の行 |
| 1本のプロセス | `protocol` `registry` | 1本へ何を送れるか、どれが生きているか |
| 起動 | `option_labels` `binding` `setup` `start_failure` | 申告から何をどの名前で送り、起動の失敗をどう分けるか |
| 使い手 | `analysis_events` `analyzer` `bridge`（検討）/ `game`（対局）/ `probe`（申告の取得） | 1本のプロセスを何に使うか。**使い手どうしは互いを知らない** |
| Tauri | `state` `commands` | 持ち物と入口。判断を書かない |

依存は表の下の行から上の行へだけ向く（Tauri が使い手を、使い手が起動と1本のプロセスを、それらが土台を使う）。
使い手の3つは同位で、共有したいものは使い手より上の行へ移す。

### 2. レイヤとファイルは何を決めるかで名付ける

`utils` `common` `misc` `helpers` を名乗らない（R-DUP-5）。`engine/utils.rs` は
`candidates`（`info` 行を候補手の一覧へ集約する）と `logging`（ログに載せる文字列の部品と、間引きと予算）に割った。
全部のファイルは冒頭の `//!` で何を隠すかを1文で書く（ADR-0009 決定5）。

機械: `no_module_is_named_after_no_role`、`every_engine_file_says_what_it_hides`

### 3. 線の形は決めたファイルにだけ置く

serde の derive は `types.rs`、`game/types.rs`、`launchable.rs` の3つにだけ置く。
TS の `rust-types.ts`（と `entities/analysis/api/tauri.ts` の `DepthOutcome`）が同じ綴りで写すので、
Rust の正本を探す場所を固定する。

機械: `wire_shapes_live_in_the_wire_shape_files`（`WIRE_SHAPE_FILES`）

### 4. trait は呼ぶレイヤのすぐ下に置く

`types` は全レイヤから見えるので trait を持たない。宛先の trait は、それを呼ぶレイヤの下に専用のレイヤを作って置く。
対局の `game::events` と同じ形で、検討は `analysis_events` を持つ。実装は `commands` に置く（ADR-0008 決定2）。

機械: `the_types_layer_declares_no_trait`、`forbids` の `tauri`

### 5. TS のスライスは何を決めるかを1文で言える

| スライス | 何を決めるか |
| --- | --- |
| `entities/engine` | 検討に使うエンジンのプロセス1本を、選んだ設定に追いつかせて起動・停止し、その状態と失敗の文を持つ |
| `entities/ai-library` | AI ライブラリのフォルダを走査し、エンジンの候補と `engines/` の状態を分ける |
| `entities/analysis` | 検討の意思と Rust の席を持ち、局面を渡してから読ませ、候補手を受ける |
| `entities/engine-presets` | プリセットを読み書きし、選んだプリセットを起動の設定へ写し、値を申告に当てる |
| `entities/game-session` | 走っている対局の進行（指し手列と裁定の往復）を持つ |
| `features/engine-position-sync` | 盤の局面をエンジンへ送り続け、送れた局面を検討へ渡す |
| `widgets/analysis-pane` | 検討ビューの操作列と候補手を描く |

`entities` の中の向き（正本は `src/__tests__/crossSliceImports.ts` の `CROSS_SLICE_INVENTORY`）:

| 読む側 | 読まれる側 |
| --- | --- |
| `entities/analysis` | `entities/engine` |
| `entities/engine-presets` | `entities/engine`、`entities/app-config` |
| `entities/game-session` | `entities/engine` |
| `entities/ai-library` | `entities/file-tree` |

`entities/app-config` は `entities/engine-presets` を読まない（プリセットの ID は `string` で保存するだけ）。
**同じ層の2スライスが互いを読む組は1組も認めない。** `entities/engine-presets` は barrel を持ち、
外からの深い import を `sliceBarrels` が止める。

機械: `crossSliceImports` の「互いを読み合う組が無い」、`sliceBarrels`

### 6. Rust と TS の対応

| Rust | TS | 線 |
| --- | --- | --- |
| `bridge` `analyzer`（検討の席と探索） | `entities/analysis` | `start_infinite_analysis` ほか、`set_position`、`analysis-update` `analysis-complete` |
| `analyzer` の起動、`registry` | `entities/engine` | `start_analysis_engine` `shutdown_engine`、`engine-exited` `engine-unresponsive` `engine-answered` |
| `probe` `binding` `option_labels` | `entities/engine`（`probeEngine`）、`features/settings` | `probe_engine` |
| `game` | `entities/game-session` | `start_game` ほか、`game-event` |
| `ai_library`（`engine` の外） | `entities/ai-library` | `scan_ai_root` `ensure_engines_dir` `create_ai_profile_dirs` |
| `settings` crate | `entities/engine-presets` | `load_presets` `save_presets`、`engine_presets.json` |

TS の `entities/engine` は Rust の `engine` 全体の写しではない。検討に使う**プロセスの寿命**だけを写す。
対局のエンジンは `game` が自分で起こし、フロントには `game-event` しか出ない。

### 7. 語

- 読ませ続ける機能は、画面でもコメントでも「検討」。コードの名前（`analysis`、`analyzer`）は線に揃えて残す
- 「分析」は使わない（`CONTEXT.md` の「使わない語」。`commentReadability` が `-D` で止める）
- コメントの「解析」は一度に替えず、`commentReadability` の `shrinkingTerm` が件数で止めて範囲ごとに下げる。
  0 になったら「使わない語」へ移す

## 第2範囲と第3範囲の置き場

エンジン標準化（`docs/spec/features/engine-standardization.md`）の残りは、この構造のどこに入るかを先に決めておく。

- **第2範囲（終了条件）**: 探索の引数は `analyzer`、`検討完了` から次の局面へ読み直すのは `bridge` の席と
  `entities/analysis` の意思。終了条件の保存は `entities/engine-presets`。新しいレイヤは要らない
- **第3範囲（オプションの部品）**: 部品は `features/settings`、値を申告に当てる規則は `entities/engine-presets` の
  `fitValues`、名前の読み替え（AC-50 の `USI_MultiPV`、AC-52 の `NumberOfThreads`）は Rust の `binding`。
  **穴が1つある**: TS が USI の名前を綴っている（`MULTIPV_OPTION`、`PresetCard.tsx` の `Threads` と `USI_Hash`）。
  読み替えを Rust に置くなら、TS のこの綴りを先に外す。棚卸しの R-15 に載せた

## 結果

- レイヤを足すときは群を決め、名前と冒頭の `//!` を書くことになる
- 範囲 5c 以降の整理は、置き場の判断をこの ADR に寄せられる。切り方の案は棚卸しのファイル
- コメントの「解析」は当面残る。件数は下がる方向にしか動かない

### 失効条件

- 対局の画面を戻すとき（ADR-0011 の着手順）。対局がフロントへ出す線が増えるなら、決定6の表を見直す
- 棋譜解析を作るとき。「解析」の語の扱い（決定7）を「使わない語」へ移す
