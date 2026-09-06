# obs-shogi 機能棚卸し仕様書

obs-shogi に実装されている機能を、UI 操作・設定値レベル（L5）まで網羅的に列挙したカタログ。
判断・取捨選択は含まない「記述的棚卸し」。`shogi-home-spec.md` と対をなし、差分比較の基準とする。

- 対象：`main` ブランチ（本ドキュメント作成時点）
- 発掘元：`src-tauri/src/lib.rs`（Tauri コマンド正典）、`src-tauri/src/{search,file_system,engine}/*`、`src-tauri/src/{study_positions,kifu}.rs`、`src/pages/AppModalLayer.tsx`、`src/shared/lib/router/useURLParams.ts`、各 `entities/` `features/` `widgets/`
- 凡例：`(設定)` = 永続化される設定 / `(別ブランチ)` = main 未マージ / `(進行中)` = 実装途上
- アーキテクチャ：**Tauri v2 デスクトップ専用**（React 19 + TypeScript + Vite + SCSS / Rust backend）。Web/PWA・モバイル版は無い。
- Shogi ロジックは `JKFPlayer`（tsshogi 系）と `shogi-kifu-converter`（Rust, v0.3.1）に依存。

> 設計上の核：**「フォルダ＝プロジェクト」**。ルートフォルダ配下の棋譜群を 1 つのコーパスとして扱い、横断検索・局面ストック・注釈で「育てる」ことを志向する。ShogiHome の「単一棋譜ドキュメント」志向とは出発点が異なる。

---

## 1. プロジェクト／ワークスペース管理（横断基盤）

- ルートフォルダを「プロジェクト」として開く
  - ルートディレクトリ選択（`chooseRootDir`、OS ダイアログ）／設定として永続化（`AppConfig.root_dir`）
  - 起動時に前回の root_dir を復元（`load_config`）
  - プロジェクトを開くとインデックス構築を起動（`open_project(root_dir)` → `OpenProjectOutput.total_files`）
- インデックス構築（横断検索の土台、`search/index_builder` ほか）
  - 構造：`file_table`（fileId 採番）/ `node_table` / `segment` / `position_key`
  - 世代管理（`Gen`）でファイル更新を追跡
  - 分岐（fork）込みで全ノードを走査（`index_builder`）、初期局面対応（`initial_position`）
  - ファイルシステム走査（`fs_scan`）、インデックスのキャッシュ／復元（`index_cache`、状態 `Restoring`）
  - 状態（`IndexState`）：Empty / Restoring / Building / Ready / Updating（`IndexStatePayload`: dirty_count / indexed_files / total_files）
  - 進捗通知（`IndexProgress`: current_path / done_files / total_files）、警告通知（`IndexWarn`: path / message）
- ファイルツリー（widget `file-tree`、`get_file_tree`）
  - ディレクトリ：作成 / 削除 / リネーム / 移動（`create_directory` / `delete_directory` / `rename_directory` / `mv_directory`）
  - 棋譜ファイル：作成 / 削除 / リネーム / 移動 / 保存（`create_kifu_file` / `delete_file` / `rename_kifu_file` / `mv_kifu_file` / `save_kifu_file`）
  - 外部棋譜のインポート（`import_kifu_file`）
  - ドラッグ&ドロップ移動（`lib/dnd.ts`、`ScrollDropZone`）
  - コンテキストメニュー（`ContextMenu`）、インラインリネーム（`InlineNameEditor`）、ノードアクション（`TreeNodeActions`）
  - ルートノード / ディレクトリ展開トグル / ファイルアイコン種別（`RootNode` / `DirectoryToggleIcon` / `FileIcon`）
- 名前衝突の解決（`FileConflictDialog` — リネームで解決 `resolveConflictByRename`）
- 棋譜読み込みエラーのハンドリング（`KifuReadErrorDialog`）

---

## 2. 横断局面検索（corpus-wide position search）

- 現局面 SFEN でプロジェクト全体から同一局面を検索（`search_position`、modal `position-search`）
  - 入力：sfen / consistency / chunk_size（`SearchPositionInput`）
  - 整合性レベル（`Consistency`）：BestEffort（即時・stale 許容）/ WaitForClean（インデックス確定待ち）
- ストリーミング結果（イベント駆動、`entities/search/api/events.ts`）
  - `begin`（stale フラグ付）→ `chunk`（PositionHit[] + files）→ `end` / `error`
  - チャンク分割で大量ヒットを逐次描画（`chunk_size`）
- ヒット情報の粒度
  - `Occurrence`：fileId / gen / nodeId
  - `CursorLite`：tesuu（手数）/ forkPointers（分岐経路）→ **どのファイルの何手目・どの分岐か**を完全特定
- キャンセル（`cancel_search` by request_id）
- 結果 UI（`features/position-search`）
  - 仮想化リスト（`VirtualList` / `VirtualHitRow`）、相対パスキャッシュ（`createRelPathCache`）
  - ヒット並べ替え（`orderPositionHits`）
  - ヒットへナビゲート（該当ファイルを開きカーソル移動、`usePositionHitNavigation`）
  - 継続局面の表示（`PositionSearchContinuation`）、行き先カード（`PositionSearchDestinationCard`）
  - ステータスバー（`PositionSearchStatusBar`）、モーダルヘッダ（件数・状態）

---

## 3. 局面ストック／研究キュー（study positions）

- 局面を保存して状態管理（`StudyPosition`、`load/save_study_positions`、永続化 `app_config_dir/study_positions.json`）
  - フィールド：id / sfen / label / description / state / tags[] / created_at / updated_at
  - 状態（`StudyPositionState`）：Inbox / Active / Reference / Done（GTD/カンバン的）
- 現局面の保存（`StudyPositionSaveModal`、modal `study-position-save`）
  - 状態セグメント選択（`StudyPositionStateSegment`）、ラベル・説明・タグ入力
- 管理画面（`StudyPositionsManagerModal`、modal `study-positions`）
  - 状態タブ切替（`StateTabNav`）
  - タグフィルタ（`TagFilterPanel`、Escape で閉じる）、アクティブフィルタチップ（`ActiveFilterChips`）
  - 局面リスト（`PositionListItem`）+ 詳細（`PositionDetail`、`BoardPreview` プレビュー）
  - 手番情報のキャッシュ（`useTurnInfoCache`）
  - キーボード操作：↑/↓・j/k で選択移動、s で状態変更、e で編集、Escape で閉じる

---

## 4. 棋譜編集（単一棋譜）

- 棋譜ストリーム（分岐対応、widget `kifu-stream`）
  - 手のカード表示（`KifuMoveCard`）、行構築（`buildStreamRows`）
  - 分岐メニュー / 分岐アクション（`KifuForkMenu` / `KifuForkActions`）
  - カーソル選択（`cursorSelection`）、セーフゾーンへのスクロール（`scrollToRowSafeZone`）
  - 手のアクション（`KifuMoveActions`）
- 局面ナビゲーション（`PositionNavigationModal`、modal `navigation`、キーボード対応）
- 盤面・駒操作（widget `game-board`）
  - pointer / クリックによる着手、駒台（`Hand` / `HandHeader` / `useHandLayout`）
  - 成・不成ダイアログ（`PromotionDialog`）
  - 駒コンポーネント一式（成駒含む 14 種、`PieceFactory`）
  - 合法手判定（`entities/game`：`moveValidator` / `shogiMoveValidator` / `moveValidation`）
  - 盤操作ボタン（`GameControls`）
  - 盤面反転（`pov=gote` で回転、`AppLayout`、URL パラメータ `pov`）
  - 直前手ハイライト（`Board.isLastMove` → `Square.isLastMove`）
- 新規棋譜作成
  - 既存と同形 / 新規（`CreateFileModal`、modal `create-file`）
  - SFEN から作成（`SfenKifuCreateModal`、modal `sfen-kifu-create`）
  - 作成オプション（`KifuCreationOptions`）：fileName / format / gameInfo(black/white/date/tags/note) / initialPosition(preset/data)
- コメント・ノート（`features/kifu-comment-note`）：指し手/局面コメントの表示・編集
- フォーマット変換（`shogi-kifu-converter`）
  - 読み込み：パース（`kifu/api/parse`、`JKFPlayer`）
  - 書き出し：jkf / kif / ki2 / csa（`convert_jkf_to_format` / `write_kifu_to_file`、`KifuFormat`）
  - 正規化（`normalize_jkf`）、後手開始局面の補正（`patch_gote_start`）
  - 保存形式は **jkf / kif / ki2 / csa の 4 種**（USI/SFEN/USEN/BOD の書き出しは無い）

---

## 5. エンジン解析（研究専用・対局なし）

- 単一エンジンの常駐運用（`engine/manager` / `engine/protocol` / `engine/raw_handler`）
  - 初期化 / 終了（`initialize_engine` / `shutdown_engine`）、局面設定（`set_position`）
  - エンジン情報取得（`get_engine_info`）、状態取得（`get_analysis_status`）
- 解析モード（main）
  - 無限解析（`start_infinite_analysis`、go infinite）
  - 時間指定（`analyze_with_time`、go movetime）
  - 深さ指定（`analyze_with_depth`、go depth）
  - 既定思考時間 3 秒（`DEFAULT_ANALYSIS_TIME`）、結果ポーリング 500ms
  - 詰み探索（`mate`）：codex ブランチに存在、main 未統合
- 解析結果の表示（widget `analysis-pane`）
  - 評価バー（`EvaluationBar`）、最善手（`BestMoveSection`）、候補手（`CandidatesSection`）
  - 読み筋列（`MoveSequence`）、統計（`StatsSection`、深さ/ノード等）
  - ヘッダで解析モード表示（`AnalysisPaneHeader`：∞ / 詰 / {n}s / d{n}）
  - 結果取得（`get_analysis_result` / `get_last_result`）、停止（`stop_analysis`）
- エンジンプリセット（`entities/engine-presets`、`load/save_presets`）
  - フィールド：id / label / aiName / enginePath / evalFilePath / bookEnabled / bookFilePath / options(USI map) / analysis(timeSeconds/depth/nodes/mateSearch)
  - 作成 / 複製 / 更新 / 削除 / オプションマージ（`createPreset` / `duplicatePreset` / `updatePreset` / `mergeOptions` / `deletePreset`）
  - 選択中プリセットを設定として永続化（`AppConfig.last_preset_id`）
  - 解析既定値（`AnalysisDefaults`）をプリセットに内包し解析 API に注入
- USI オプション GUI 編集（プリセット編集ダイアログ内、`ImportantOptionsSection` ほか、進行中 #83）
- AI ライブラリ（エンジン置き場、`ai_library`）
  - ルート選択（`chooseAiRoot`、`AppConfig.ai_root`）、ディレクトリ確保（`ensure_engines_dir`）、スキャン（`scan_ai_root`）
  - セットアップガイド（`AiLibraryTab` / `SetupGuide`、Step1–4：ルート選択→engine 作成→配置→アセット配置）
- エンジン設定の適用 / 取得（`apply_engine_settings` / `get_engine_settings`）

---

## 6. 設定・画面・その他

- アプリ設定（`SettingsModal`、modal `settings`、`SettingsPanel`）
  - タブ：Workspace / Engine / AI Library（`tabs.ts`）
  - 設定スキーマ（`AppConfig`）は **root_dir / ai_root / last_preset_id のみ**（外観・音・入出力など ShogiHome 相当の設定群は無い）
  - UI キット（`SInput` / `SButton` / `SSelect` / `SField` / `SSection` / `SRadioGroup` / `SettingsBadge`）
- 画面構成
  - サイドバー（`Sidebar`）＋ヘッダ（`AppLayoutHeader`、中央情報 `useHeaderCenterInfo`）
  - メインレイアウト（`AppLayout`、固定構成。ShogiHome 的なレイアウトマネージャ／カスタムプロファイルは無い）
  - ウィンドウ 1600×960（`tauri.conf.json`）
  - 起動フロー：`AppLoading` → `WelcomeScreen` / `FolderSelect` → `AppLayout`、起動スプラッシュ（`boot-splash`）
- URL/モーダルルーティング（`useURLParams`、`ModalType`）
  - navigation / analysis / settings / create-file / position-search / study-position-save / study-positions / sfen-kifu-create
  - tesuu / branch / dir / returnTo 等を URL パラメータで保持
- アップデータ（`features/updater`、`tauri_plugin_updater`）
- ログ（`tauri_plugin_log`：上限は `LOG_FILE_BUDGET`・1 ファイル保持、`engine` のみ Debug）

---

## 付録 A：Tauri コマンド一覧（バックエンド正典 `lib.rs`）

| 分類          | コマンド                                                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 設定          | load_config / save_config                                                                                                                                                                                                                                           |
| ファイル      | get_file_tree / create_kifu_file / save_kifu_file / read_file / import_kifu_file / delete_file / rename_kifu_file / mv_kifu_file / create_directory / delete_directory / rename_directory / mv_directory                                                            |
| 棋譜変換      | convert_jkf_to_format / normalize_jkf / write_kifu_to_file                                                                                                                                                                                                          |
| エンジン      | initialize_engine / shutdown_engine / set_position / start_infinite_analysis / analyze_with_time / analyze_with_depth / stop_analysis / get_analysis_result / get_last_result / get_analysis_status / get_engine_info / apply_engine_settings / get_engine_settings |
| プリセット/AI | load_presets / save_presets / ensure_engines_dir / scan_ai_root                                                                                                                                                                                                     |
| 横断検索      | open_project / search_position / cancel_search                                                                                                                                                                                                                      |
| 局面ストック  | load_study_positions / save_study_positions                                                                                                                                                                                                                         |

---

## 付録 B：未実装 / 別ブランチ（main に無いもの・状態のみ記録）

- **Second Brain 注釈**（枝ごとの tone / importance、note、branch-view モーダル、`file-meta`）— `feature/zettelkasten` 系。main の `ModalType` に存在せず未マージ
- **解析キャッシュ永続化**（局面に解析結果を紐付けて保存）— `docs/research-roadmap` Phase 1、未着手
- **定跡（book）read / write**（やねうら王 .db ほか）— roadmap Phase 2–3、未着手
- **対局機能**（人/エンジン/CSA）— roadmap で明示的に Out of Scope
- 局面編集モード（駒落ちプリセット投入・駒の増減）/ 画像出力 / 棋譜メタデータ編集 UI / 評価値チャート / 同一局面検索（単一棋譜内）/ 自動バックアップ — いずれも未実装
- **クリップボード**：棋譜/SFEN のコピー・貼り付けは**未実装**（`copyText` はパス(rootDir/aiRoot)のコピーにのみ使用）

> 訂正（初版の誤記）：以下は **実装済み**。
>
> - **しおり**＝「課題局面」＝ study positions への登録（`AnalysisPaneHeader` の Bookmark、§3）。ShogiHome 型の「棋譜内の手にしおり」とは別物で、後者は未実装（→ 別 issue 化）。
> - **盤面反転**（`pov`）/ **直前手ハイライト**（`Board.isLastMove`）/ **MultiPV**（preset の USI option）。

---

_この棚卸しは Tauri コマンド・FSD レイヤ・モーダル定義・型定義から機械的に抽出したもの。`shogi-home-spec.md` と章番号は対応しないため、差分は機能カテゴリ単位で突き合わせる。_
