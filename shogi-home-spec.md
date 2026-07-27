# ShogiHome 機能棚卸し仕様書

ShogiHome に実装されている機能を、UI 操作・設定値レベル（L5）まで網羅的に列挙したカタログ。
判断・取捨選択は含まない「記述的棚卸し」。設定項目は独立機能としてではなく、各機能にぶら下げて記載する。

- 対象バージョン：本ドキュメント作成時点の `main` ブランチ
- 発掘元：`src/background/window/menu.ts`（デスクトップメニュー正典）、`src/renderer/store/index.ts`、`src/common/settings/*`、`src/common/i18n/locales/ja.ts`
- 凡例：`(設定)` = アプリ設定で変更可能なパラメータ / `(Native)` = インストール版限定 / `(Web)` = ブラウザ版限定 / `(管理モード)` = デバッグメニュー経由

> 注：ShogiHome は **Electron デスクトップ版** と **Web/PWA 版** の両対応。一部機能はプラットフォーム限定。
> Shogi ロジックは外部ライブラリ `tsshogi` に依存（合法手判定・局面表現・棋譜パース）。

---

## 1. 棋譜（Kifu）管理・編集

- 棋譜ツリー（分岐対応）
  - 一本道だけでなく分岐（変化手順）を保持
  - 分岐の切り替え
    - 別の分岐へジャンプ（`changeBranch`）
    - 本譜へ戻る（`backToMainBranch`）
    - 分岐の並べ替え：次の分岐と入れ替え / 前の分岐と入れ替え（`swapWithNextBranch` / `swapWithPreviousBranch`）
  - 分岐リストの表示モード `(設定: branchListMode)`
    - 着手した手（previousMoveBranches）
    - 次の手（nextMoveBranches）
- 局面ナビゲーション
  - 1手進む / 1手戻る（`goForward` / `goBack`）
  - 指定手数へジャンプ（`changePly`）／任意ノードへ移動（`changeNode`）
  - キーボード操作 `(設定)`
    - ↑/↓キーで1手移動（useUpDownToMove1Ply）
    - ←/→キーで1手移動（useLeftRightToMove1Ply）
    - 棋譜ペインのショートカットキー（recordShortcutKeys）
- 指し手の編集
  - 現在の位置から棋譜を削除（`removeCurrentMove`、Cmd/Ctrl+D）
  - 特殊な指し手の挿入（`insertSpecialMove`）
    - 中断 / 投了 / 引き分け / 持将棋 / 千日手 / 詰み / 不詰
    - 時間切れ / 反則勝ち / 反則負け / 入玉勝ち / 不戦勝 / 不戦敗
- コメント機能
  - 指し手・局面ごとのコメント編集（`updateRecordComment`）
  - 思考エンジンの読み筋・評価値コメントの追記（`appendSearchComment`）
  - コメント追記の挙動 `(設定)`：前方に加筆 / 末尾に加筆 / 上書き / 出力しない
  - 思考コメントのフォーマット `(設定: searchCommentFormat)`：ShogiHome 形式 等
- しおり（Bookmark）
  - 任意の局面にしおりを設定（`updateRecordBookmark`）
  - しおり一覧から局面へジャンプ（`jumpToBookmark`、BookmarkListDialog）
  - しおりを棋譜ビューの見出しに使う `(設定)`
- 棋譜情報（メタデータ）の編集（`updateStandardRecordMetadata`、RecordInfo タブ）
  - 対局者名（先手/後手・省略名）、手番
  - 開始日時 / 終了日時 / 対局日
  - 棋戦 / 戦型 / 表題 / 場所 / 持ち時間（先手・後手別）
  - 掲載 / 備考 / 記録係
  - 詰将棋メタ：作品番号 / 作品名 / 発表誌 / 発表年月 / 出典 / 手数 / 完全性 / 分類 / 受賞
  - 未入力項目の表示/非表示
- 自動バックアップと復元
  - 編集中棋譜の自動バックアップ（V1 / V2 形式）
  - バックアップからの復元（`restoreFromBackupV1` / `restoreFromBackupV2`）

---

## 2. 盤面 UI・駒操作

- 駒の移動操作（実装：`BoardView.vue` / `board/board.ts`、Pointer Events 駆動）
  - 入力デバイスの統合：`pointerdown` / `pointermove` / `pointerup` / `pointercancel` を `document` 全体で捕捉し、マウス・タッチ・ペンを同一ロジックで処理（`pointerId` で単一ドラッグを追跡）
  - ドラッグ&ドロップ `(設定: enableDragAndDrop でON/OFF)`
    - 状態機械：`pending`（pointerdown 記録済み・移動待ち）→ 一定距離移動で `active`（ゴースト駒表示）→ ドロップで確定
    - ドラッグ中はカーソルを `grabbing` に変更し、原寸ゴースト駒（盤倍率に追従）を `pointer-events: none` で追従描画
    - ドラッグ完了後の `click` を `dragCompletedFlag` で無効化（クリック移動との競合回避）
  - クリック（タップ）による移動（`clickSquare`：移動元→移動先の2ステップ、`reservedMove` に保持）
  - 駒台からの打ち込み（持ち駒のドラッグ `beginDragFromHand` / クリック `clickHand`）
  - 掴める駒の制限
    - 対局・閲覧モード（`allowMove`）：手番側の自分の駒のみ掴める（`piece.color === position.color`）
    - 局面編集モード（`allowEdit`）：任意の駒を掴める／盤・駒台間を自由に移動
  - 成・不成の選択（`clickPromote` / `clickNotPromote`、成れる手で選択UI表示）`(設定: promotionSelectorStyle)`
    - 水平・中央寄せ / 垂直・成優先 / 水平・成優先
  - 直前の指し手のハイライト（`lastMove` prop、移動元・移動先マスを強調）
  - 候補手の表示（`candidates: CandidateMove[]`、エンジン読み筋の矢印描画）
  - 盤面リサイズ（`resize` emit、`maxSize` から動的に盤・駒サイズを算出）
  - イベント発火（`move` = 着手確定 / `edit` = 局面編集の駒変更）
- 盤面表示
  - 盤面反転（`FLIP_BOARD`、Cmd/Ctrl+T）`(設定: boardFlipping で既定状態保持)`
  - 段・筋ラベルの表示 `(設定: boardLabelType)`
  - 盤レイアウト切替（メニュー / Cmd+1〜3）`(設定: boardLayoutType)`
    - 標準（STANDARD）/ コンパクト（COMPACT）/ ポートレイト（PORTRAIT）
  - 左側操作ボタンの表示 / 右側操作ボタンの表示 `(設定: leftSideControlType / rightSideControlType)`
- 外観カスタマイズ（テーマ・画像）
  - テーマ `(設定: thema)`：標準 / 緑 / 桜 / 紅葉 / 雪 / クラシック / ベージュ / 深緑 / ダーク / カスタム画像
  - 背景画像 `(設定: backgroundImageType)`：なし / 1枚で表示 / 拡大して表示 / タイル状
  - 駒画像 `(設定: pieceImage)`
    - 一文字駒（標準 / 木目 / ゴシック体 / ダーク / ゴシック体ダーク）/ 二文字駒 / カスタム画像
    - 王将駒の種類 `(設定: kingPieceType)`
    - 駒画像の余白除去 `(設定: deletePieceImageMargin)`
  - 盤画像 `(設定: boardImage)`：木目（明/暖の複数段階）/ 樹脂 / カスタム
  - 盤面グリッド色 `(設定: boardGridColor)`
  - 駒台画像 `(設定: pieceStandImage)`
  - 透過表示 `(設定: enableTransparent)`
    - 盤の不透明度 / 駒台の不透明度 / 棋譜の不透明度（boardOpacity / pieceStandOpacity / recordOpacity）
- 効果音
  - 駒音の大きさ（0〜100%）`(設定: pieceVolume)`
  - 時計音の大きさ（0〜100%）`(設定: clockVolume)`
  - 時計音の高さ（220〜880Hz）`(設定: clockPitch)`
  - 時計音の対象 `(設定: clockSoundTarget)`：全ての手番 / 人間の手番のみ
- 操作ボタン群（ControlPane）
  - 検討開始/終了・対局・対局中断・宣言勝ち・投了・持将棋点数・戦績確認
  - 解析・解析中断・詰み探索・詰み探索終了
  - 局面編集開始/終了・手番変更・局面初期化・駒の増減

---

## 3. 局面編集（Position Setup）

- 局面編集モードの開始 / 終了（`startPositionEditing` / `endPositionEditing`）
- 任意の駒配置（ドラッグ&ドロップで盤上・駒台を編集）
- 手番の変更（`changeTurn`）
- 局面の初期化（プリセット投入、`initializePositionBySFEN`）
  - 平手
  - 駒落ち：香落ち / 右香落ち / 角落ち / 飛車落ち / 飛車香落ち / 二枚落ち / 四枚落ち / 六枚落ち / 八枚落ち / 十枚落ち
  - 詰将棋 / 双玉詰将棋
- 駒の増減（PieceSetChangeDialog）
  - 全ての駒を平手の枚数にする
  - 全ての駒を0にする

---

## 4. 対局（ローカル / エンジン対局）

- 対局の開始 / 中断（`startGame` / `stopGame`、GameDialog）
- 対局者の選択（先手・後手それぞれ）
  - 人間（human）
  - 組み込み簡易エンジン：ランダムプレイヤー / 居飛車（static_rook v1）/ 振り飛車（ranging_rook v1）
  - 登録済み USI エンジン（PlayerSelector）
- 持ち時間設定（TimeLimitSettings）
  - 持ち時間（時間/分/秒）
  - 秒読み（byoyomi）
  - 増加（increment、フィッシャールール）※ 秒読みとの併用不可
  - 後手に異なる時間を設定（whiteTimeLimit）
- 開始局面（startPositionSFEN）
  - 現在の局面から開始 / 局面集ファイルから（startPositionListFile）
    - 局面リストの順序：順次（sequential）/ シャッフル（shuffle）
    - 局面リストの開始手数（startPositionListPly）
- 振り駒（先後をランダム決定、pieceToss）
- 持将棋ルール（jishogiRule）：24点法 / 27点法 / トライルール
- エンジンの時間切れあり（enableEngineTimeout）
- 盤面の向き：人を手前に表示（humanIsFront）/ 自動調整
- コメント出力（enableComment）
- 棋譜の自動保存（enableAutoSave / autoSaveDirectory）
- 最大手数（maxMoves）
- 連続対局（gameRepetition）
  - 対局回数（repeat）
  - 1局ごとに手番を入れ替える（swapPlayers）
  - 並列対局・並列数（parallelism、ParallelGameViewer で観戦）
  - 進捗表示（ConsecutiveGameProgress）
  - 戦績集計（`showGameResults`）：勝ち数（先手/後手別）/ 引き分け / 有効・無効対局数 / レーティング差（Elo）/ 引き分け無効
  - SPRT（逐次確率比検定、sprtEnabled / elo0 / elo1 / alpha / beta / maxGames）
    - Z値 / 有意水準5%・1% の判定表示
- 対局中アクション
  - 投了（RESIGN、確認ダイアログ）
  - 宣言勝ち（WIN / declareWin、確認ダイアログ）
  - 持将棋点数計算（`showJishogiPoints` / CALCULATE_POINTS）
  - 戦績確認（DISPLAY_GAME_RESULTS）
- 消費時間の記録・表示

---

## 5. 通信対局（CSA プロトコル）

- CSA サーバーへの接続・対局（`showCSAGameDialog` / `startGame`、CSAGameDialog）
- 接続設定（CSAServerSettings）
  - プロトコルバージョン：CSA 1.2.1 標準 / CSA 1.2.1 読み筋コメント付き / Floodgate
  - 接続先ホスト / ポート番号（既定 4081）
  - ID / パスワード（表示切替可、OS暗号化不可時は平文保存の警告）
  - TCP Keepalive（初期遅延）
  - 空行 Ping（初期遅延 / 間隔、≥30秒、タイムアウト防止用）
- サーバー履歴からの選択 / 履歴への保存
- 対局者設定（人間 / USI エンジン）
- 盤面自動反転（autoFlip）
- 自動再ログイン（autoRelogin）
- 1局ごとにエンジン再起動（restartPlayerEveryGame）
- 連続対局回数（repeat）
- コメント出力 / 棋譜自動保存
- ログアウト（LOGOUT）
- CSA 使用中はアプリ終了不可
- Floodgate 向けバリデーション（パスワードはゲーム名で始まる必要、公式ゲーム名チェック）
- 管理モード接続（CONNECT_TO_CSA_SERVER、手動コマンド送信、shogi-server x1 モード）

---

## 6. 解析・検討系

### 6.1 検討（Research）

- 検討の開始 / 終了（`startResearch` / `stopResearch`、TOGGLE_RESEARCH、Cmd/Ctrl+R）
- 複数エンジン同時検討（メインエンジン + secondaries 複数）
- 思考時間上限（enableMaxSeconds / maxSeconds、既定10秒）
- MultiPV（候補手数）の上書き（overrideMultiPV / multiPV、`setResearchMultiPV` / `getResearchMultiPV`）
- 検討エンジンの一時停止 / 再開（`pauseResearchEngine` / `unpauseResearchEngine` / `isPausedResearchEngine`）

### 6.2 棋譜解析（Record Analysis）

- 棋譜全体の自動解析（`startAnalysis` / `stopAnalysis`、START_ANALYSIS、Cmd+A / Mac:Cmd+Y）
- 解析範囲（StartCriteria / EndCriteria：開始手数・終了手数の指定）
- 1手あたりの思考時間（PerMoveCriteria.maxSeconds、既定5秒）
- 逆順解析（descending）
- 解析結果のコメント反映挙動（commentBehavior：挿入 / 末尾追記 等）
- 指し手評価（悪手判定）の色分け `(設定: badMoveLevelThreshold1〜4)`
  - 緩手（inaccuracy）/ 疑問手（dubious）/ 悪手（mistake）/ 大悪手（blunder）の4段階閾値（各1〜100%、昇順制約あり）
  - 好手 / 絶対手 等の評価ラベル

### 6.3 詰み探索（Mate Search）

- 詰将棋エンジンによる詰み探索（`startMateSearch` / `stopMateSearch`、Cmd/Ctrl+M、MateSearchDialog）
- 思考時間上限（enableMaxSeconds / maxSeconds）
- 詰み発見時に再生画面表示の確認 / 不詰の通知
- 詰将棋非対応エンジンの検出

### 6.4 同一局面検索（Duplicate Positions）

- 棋譜内の重複局面検索（`showSearchDuplicatePositionsDialog`、SEARCH_DUPLICATE_POSITIONS）
- 経路・直前の指し手・次の指し手・出現数の表示
- 検出局面へのジャンプ
- 常時検出 `(設定: liveDuplicatePositionDetection)`（編集中にリアルタイム警告）

### 6.5 思考の可視化

- エンジン解析表示（EngineAnalytics タブ）
  - 表示列：順位 / 評価値 / 期待勝率 / 読み筋 / 深さ / ノード数 / 候補手数 `(レイアウト設定で各列ON/OFF)`
  - 履歴モード（過去の思考ログ保持）
  - 読み筋の再現再生（PVPreviewDialog、displayPV）
- 評価値チャート（EvaluationChart タブ）
  - チャート種別（EvaluationChartType）/ 凡例表示
  - 評価値の符号 `(設定: evaluationViewFrom)`：手番側有利がプラス / 先手有利がプラス
  - 勝率換算係数 `(設定: coefficientInSigmoid)`（シグモイド係数、>0）
- 盤面矢印（候補手の矢印表示）
  - 矢印に評価値を表示 `(設定: showArrowScore)`
  - 矢印の評価値範囲 `(設定: arrowScoreDiffRange)`
  - 矢印の表示数 `(設定: maxArrowsPerEngine)`
- 読み筋表示手数の上限 `(設定: maxPVTextLength)`
- ノード数表記 `(設定: nodeCountFormat)`：装飾無し / カンマ区切り
- 消費時間チャート（`showElapsedTimeChartDialog`、ELAPSED_TIME_CHART、ElapsedTimeChartDialog）

---

## 7. 定跡（Book）

- 定跡の読み込み / 保存（OPEN_BOOK_FILE / SAVE_BOOK_FILE）
- 定跡の初期化（RESET_BOOK、ResetBookDialog）
- 対応フォーマット
  - やねうら王定跡（.db、yane2016）
  - Apery 定跡（.bin、※他形式への変換不可）
  - ShogiGUI 定跡（.sbk）
  - SBK / packed-sfen 形式（specs/ に別途フォーマット仕様あり）
- On-the-fly 読み込み（巨大ファイルを全読みせずディスク逐次参照）
  - 閾値 MB `(設定: bookOnTheFlyThresholdMB / yaneBookOnTheFlyThresholdMB / aperyBookOnTheFlyThresholdMB / sbkOnTheFlyThresholdMB)`
  - On-the-fly 中は上書き保存不可
- 定跡パネル（BookPanel）での参照・編集
  - 定跡手の表示（出現頻度 / 評価値 / 登録手数 等）
  - 定跡手の登録 / 更新 / 削除（BookMoveDialog）
  - 反転局面も検索 `(設定: flippedBook)`
- 定跡手の追加（ADD_BOOK_MOVES、AddBookMovesDialog）
  - 現在の棋譜から / ファイルから / フォルダから
  - 手数範囲（minPly / maxPly）
  - 対局者条件（全員 / 先手のみ / 後手のみ / 名前フィルタ）
  - コメントから評価値を取り込む（importScore）
  - 全手反映 / 個別反映
- 定跡のエクスポート（やねうら王 / Apery / ShogiGUI 形式）
- 定跡情報の表示（フォーマット / 読み込みモード / ファイルパス / 局面数 / 未保存状態）
- エンジン付帯定跡（USIEngineExtraBookConfig：enabled / filePath / onTheFly）
- GUI拡張定跡（frontendBook）
- 未保存定跡がある場合のアプリ終了確認

---

## 8. ファイル入出力・フォーマット

### 8.1 棋譜ファイル

- 新規作成
  - 新規棋譜（同じ初形、Cmd/Ctrl+N）
  - 新規棋譜（平手初形、Cmd/Ctrl+Shift+N）
- 開く（`openRecord`、Cmd/Ctrl+O）
- 保存
  - 上書き保存（Cmd/Ctrl+S）`(Native)`
  - 名前を付けて保存（Cmd/Ctrl+Shift+S）`(Native)`
  - Web版は形式選択ダウンロード（KIF / KIFU / KI2 / KI2U / CSA / JKF）`(Web)`
- 対応フォーマット（読み書き）：KIF / KIFU / KI2 / KI2U / CSA / JKF / USI / SFEN / USEN / BOD
- ファイル履歴（HISTORY、Cmd/Ctrl+H、RecordFileHistoryDialog）`(Native)`
- Web上の棋譜取得（LOAD_REMOTE_RECORD、Cmd/Ctrl+Shift+O、LoadRemoteFileDialog）`(Native)`
  - ソースURL指定（プレーンテキスト、リダイレクト非対応）
- 一括変換（BATCH_CONVERSION、BatchConversionDialog）`(Native)`
  - 入力：ディレクトリ / 単一ファイル、対象フォーマット選択、サブディレクトリ走査
  - 出力：ディレクトリ / 単一ファイル、出力フォーマット、サブディレクトリ作成
  - 名前衝突時の動作：番号付与 / 上書き / スキップ
  - USI 投了の出力（enableUSIResign）
  - 変換ログ（アプリログ + デバッグレベル）

### 8.2 クリップボード連携

- 棋譜コピー（初手から）：KIF / KI2 / CSA / USI(現在まで) / USI(全て) / JKF / USEN
- 棋譜コピー（現在の局面から）：KIF / KI2 / CSA / USI / JKF / USEN
- 局面コピー：SFEN / BOD
- 貼り付け（PASTE_RECORD、Cmd/Ctrl+V、PasteDialog）
  - 対応：KIF / KI2 / CSA / USI / SFEN / JKF / USEN（自動判別）
  - 貼り付けダイアログの表示有無 `(設定: showPasteDialog)`
- マージ貼り付け（PASTE_RECORD_MERGE）：棋譜の先頭へ / 現在の位置へ
  - 初期局面・手番不一致時はマージ失敗

### 8.3 入出力オプション `(設定)`

- デフォルトの保存形式（defaultRecordFileFormat）
- 文字コード（textDecodingRule）：厳格 / 自動判定
- 改行文字（returnCode）：CRLF / LF / 90年代Mac
- KIF・KI2 を常に UTF-8 で出力（useUTF8ForKifAndKi2、古いアプリ非対応の警告）
- CSA V3 で出力（useCSAV3）
- USI ファイル出力：startpos 使用 / resign 出力 / 特殊手出力（enableUSIFileStartpos / enableUSIFileResign / enableUSIFileSpecialMoves）
- USI の局面表記（SFENのみ 等）/ 指し手表記（最小限 等）
- 自動保存先ディレクトリ（autoSaveDirectory）
- 棋譜ファイル名テンプレート（recordFileNameTemplate、変数によるファイル名生成）

### 8.4 共有・画像出力

- シェア（SHARE、ShareDialog）
- 局面図の画像出力（EXPORT_POSITION_IMAGE、Cmd/Ctrl+Shift+E、PositionImageExportDialog）`(Native)`
  - スタイル `(設定: positionImageStyle)`：書籍風 / 書籍風局面図 / 対局画面風
  - サイズ `(設定: positionImageSize)`
  - 書体 `(設定: positionImageTypeface)`：ゴシック体 / 明朝体
  - 持ち駒ラベル種別 / 見出し（しおりを見出しに使う / カスタム見出し）
  - フォントの太さ（細 / 太 / 極太）/ フォント倍率 / 文字の垂直位置

---

## 9. 画面・レイアウト・表示

- タブビュー（TabPane）
  - タブ種別：思考 / 評価値チャート / コメント / 棋譜情報 / エンジン解析 等
  - タブビューの形式 `(設定: tabPaneType)`：1列 / 2列
  - 最小化 / 再表示
- 標準レイアウト / モバイルレイアウト / カスタムレイアウトの切替
- レイアウトマネージャー（OPEN_LAYOUT_MANAGER、Cmd/Ctrl+L、独立ウィンドウ）
  - カスタムレイアウトプロファイルの作成 / 複製 / 削除
  - ドラッグでコンポーネント配置編集（位置・サイズ）
  - 前面へ / 背面へ（重なり順）
  - プロファイルのクリップボード入出力
  - 配置可能コンポーネント：盤 / 棋譜 / 定跡 / 評価値チャート / エンジン解析 / コメント / 棋譜情報 / 操作ボタン群1・2 / 簡易盤 / 消費時間チャート
    - 各コンポーネントの表示オプション（例：棋譜=コメント列/消費時間列/分岐の表示、解析=各列の表示切替）
  - プロファイルごとの背景色 / ダイアログ表示位置 / ダイアログ表示中の暗転
- 文字サイズ（標準 Cmd+0 / 拡大 Cmd++ / 縮小 Cmd+-、ズームレベル）
- 全画面表示切替（F11 / Mac:togglefullscreen）
- ウィンドウ状態の保持（幅・高さ・最大化・全画面）
- 監視ウィンドウ（OPEN_MONITOR_WINDOW、独立ウィンドウ、MonitorView）
  - CPU / メモリ / スレッド / USI_Hash 使用率の監視と警告

---

## 10. エンジン管理（USI）

- エンジン設定ダイアログ（USI_ENGINES_DIALOG、Cmd/Ctrl+.、USIEngineManagementDialog）
- エンジンの登録 / 複製 / 削除（実行可能ファイルを選択）
- エンジン情報：エンジン名 / 表示名 / 作者 / 場所（パス）
- エンジンの再選択（パス置換、非互換オプションは破棄）
- USI オプション編集（USIEngineOptionsDialog）
  - 型：check / spin（min/max）/ combo（vars）/ button / string / filename
  - 既定値に戻す / 全オプション表示 / オプション名で検索
  - オプション名の翻訳 `(設定: translateEngineOptionName、日本語時のみ)`
  - オプション詳細の表示 `(設定: showEngineOptionDetails)`
  - 自由入力（非推奨）
- エンジンのラベル（用途）：対局 / 検討 / 詰み探索
- エンジンタグ（AddEngineTagDialog、タグによる分類・フィルタ）
- 早期 Ponder（enableEarlyPonder、やねうら王独自オプション）
- エンジン設定の比較・マージ（USIEngineMergeDialog）
  - 左右比較・差分表示・左へ/右へマージ・マージ不可項目の判定
- エンジンの最大起動待ち時間 `(設定: engineTimeoutSeconds、1〜300秒)`
- NUMA 環境・スレッド数・Hash 使用率の警告
- 管理モードでの USI エンジン手動起動（LAUNCH_USI_ENGINE、LaunchUSIEngineDialog）

---

## 11. ウィンドウ・プロンプト・補助機能

- USI / CSA プロンプト（PromptMain）
  - コマンド履歴の表示（CommandHistory）
  - コマンド手動入力・送信（CommandInput）
  - 自動スクロール / タイムスタンプ表示 / 部分一致ハイライト
  - 最終送信・最終受信時刻 / プロトコルバージョン表示
  - 強制 Quit / 強制 Close / 空行送信
- 稼働中 USI エンジン / 接続中 CSA サーバーの一覧
- 通知オーバーレイ（NotificationOverlay、URL 付き通知対応）
- 新しい ShogiHome ウィンドウを開く `(Native)`
- 自動保存先フォルダを開く（ローカル / CSA 別）`(Native)`
- デスクトップショートカット作成 `(Native)`（実装：`LayoutManager.vue` → `createDesktopShortcutForLayoutProfile`）
  - 特定のレイアウトプロファイルを指定して起動するショートカットを生成（`--layout-profile <uri>` 引数付き、`background/file/shortcuts.ts`）

---

## 12. ログ・デバッグ・診断

- ログ出力 `(設定)`
  - アプリログ / USI通信ログ / CSA通信ログ の有効化（enableAppLog / enableUSILog / enableCSALog）
  - ログレベル（logLevel、※変更には再起動が必要）
  - Web版ではコンソール出力（設定無視）
- ログファイル操作（デバッグメニュー）
  - 各ログを開く / Tail する（Win:PowerShell / Mac）/ Tail コマンドをコピー
- 各種フォルダを開く：アプリ / 設定 / ログ / キャッシュ
- カスタム駒画像のリロード
- 通知テスト（メッセージのみ / URL 付き）
- 統計情報レポート（HTML 出力）
- システム情報：CPU 情報 / GPU 情報 / GPU Feature Status
- 開発者ツール表示切替
- 強制シャットダウン
- ハードウェアアクセラレーション（HWA）の警告（長時間対局では無効化推奨）

---

## 13. 設定・国際化・ヘルプ

- アプリ設定ダイアログ（APP_SETTINGS_DIALOG、Cmd/Ctrl+,、AppSettingsDialog）
  - 上記各機能にぶら下がる全パラメータを集約管理（外観・音・入出力・エンジン・解析・ログ・局面図 等）
  - 設定の YAML / JSON 形式でのクリップボード出力
  - usi-csa-bridge コマンドのクリップボード出力
- 多言語対応 `(設定: language)`
  - 日本語 / 英語（開発者保守）、繁体字中国語 / ベトナム語（人間翻訳者保守）
  - 言語変更には再起動が必要
- ヘルプ
  - Webサイト / 使い方ガイド / 最新版・安定版リリースページを開く
  - ライセンス表示：ShogiHome / Third Party Libraries / Material Icons / Electron / Chromium
- アップデート確認（安定版・最新版のリリース通知）

---

## 14. CLI ツール（同梱）

- usi-csa-bridge（`src/command/usi-csa-bridge`）
  - USI エンジンと CSA サーバーを橋渡しする独立コマンドラインツール
  - 設定は GUI から YAML/JSON でエクスポート可能

---

## 補足：プラットフォーム差分の要点

| 機能                                          | デスクトップ(Native) | Web/PWA                  |
| --------------------------------------------- | -------------------- | ------------------------ |
| ファイル上書き保存                            | ○                    | 形式選択ダウンロードのみ |
| ファイル履歴 / リモート取得 / 一括変換        | ○                    | ×                        |
| 局面図画像出力                                | ○                    | △（モバイルWeb除く）     |
| 複数ウィンドウ / フォルダを開く               | ○                    | ×                        |
| ログのファイル出力                            | ○                    | コンソールのみ           |
| モバイル専用UI（MobileLayout / 簡易メニュー） | －                   | ○                        |

---

## 付録 A：アプリ設定（`AppSettings`）全項目の章マッピング

`src/common/settings/app.ts` の `AppSettings` 全 86 項目を、本文のどの機能にぶら下がるかで分類した完全表（拾い漏れゼロの確認用）。

| #   | 設定キー                         | 概要                                          | 紐づく章      |
| --- | -------------------------------- | --------------------------------------------- | ------------- |
| 1   | language                         | 表示言語                                      | §13           |
| 2   | thema                            | テーマ（配色）                                | §2 外観       |
| 3   | backgroundImageType              | 背景画像の表示方式                            | §2 外観       |
| 4   | boardLayoutType                  | 盤レイアウト（標準/コンパクト/ポートレイト）  | §2 盤面表示   |
| 5   | pieceImage                       | 駒画像セット                                  | §2 外観       |
| 6   | kingPieceType                    | 王将駒の種類                                  | §2 外観       |
| 7   | deletePieceImageMargin           | 駒画像の余白除去                              | §2 外観       |
| 8   | boardImage                       | 盤画像                                        | §2 外観       |
| 9   | boardGridColor                   | 盤グリッド色                                  | §2 外観       |
| 10  | pieceStandImage                  | 駒台画像                                      | §2 外観       |
| 11  | promotionSelectorStyle           | 成・不成 選択UIの形式                         | §2 駒操作     |
| 12  | enableTransparent                | 透過表示の有効化                              | §2 外観       |
| 13  | boardOpacity                     | 盤の不透明度                                  | §2 外観       |
| 14  | pieceStandOpacity                | 駒台の不透明度                                | §2 外観       |
| 15  | recordOpacity                    | 棋譜の不透明度                                | §2 外観       |
| 16  | boardLabelType                   | 段・筋ラベルの表示                            | §2 盤面表示   |
| 17  | leftSideControlType              | 左側操作ボタンの表示                          | §2 / §9       |
| 18  | rightSideControlType             | 右側操作ボタンの表示                          | §2 / §9       |
| 19  | pieceVolume                      | 駒音の大きさ                                  | §2 効果音     |
| 20  | clockVolume                      | 時計音の大きさ                                | §2 効果音     |
| 21  | clockPitch                       | 時計音の高さ                                  | §2 効果音     |
| 22  | clockSoundTarget                 | 時計音の対象（全手番/人間のみ）               | §2 効果音     |
| 23  | recordShortcutKeys               | 棋譜ペインのショートカットキー                | §1 ナビ       |
| 24  | boardFlipping                    | 盤面反転の既定状態                            | §2 盤面表示   |
| 25  | enableDragAndDrop                | 駒のドラッグ操作 ON/OFF                       | §2 駒操作     |
| 26  | tabPaneType                      | タブビューの形式（1列/2列）                   | §9            |
| 27  | tab                              | 表示中タブ（1列目）                           | §9            |
| 28  | tab2                             | 表示中タブ（2列目）                           | §9            |
| 29  | topPaneHeightPercentage          | 上ペイン高さ比率                              | §9 レイアウト |
| 30  | topPanePreviousHeightPercentage  | 上ペイン前回高さ比率                          | §9 レイアウト |
| 31  | bottomLeftPaneWidthPercentage    | 左下ペイン幅比率                              | §9 レイアウト |
| 32  | defaultRecordFileFormat          | デフォルト保存形式                            | §8.3          |
| 33  | textDecodingRule                 | 文字コード（厳格/自動判定）                   | §8.3          |
| 34  | returnCode                       | 改行文字                                      | §8.3          |
| 35  | autoSaveDirectory                | 自動保存先                                    | §4 / §8.3     |
| 36  | recordFileNameTemplate           | 棋譜ファイル名テンプレート                    | §8.3          |
| 37  | useCSAV3                         | CSA V3 で出力                                 | §8.3          |
| 38  | useUTF8ForKifAndKi2              | KIF/KI2 を常に UTF-8 出力                     | §8.3          |
| 39  | enableUSIFileStartpos            | USI出力で startpos 使用                       | §8.3          |
| 40  | enableUSIFileResign              | USI出力で resign 出力                         | §8.3          |
| 41  | enableUSIFileSpecialMoves        | USI出力で特殊手出力                           | §8.3          |
| 42  | showPasteDialog                  | 貼り付けダイアログの表示有無                  | §8.2          |
| 43  | liveDuplicatePositionDetection   | 同一局面の常時検出                            | §6.4          |
| 44  | bookOnTheFlyThresholdMB          | 定跡 on-the-fly 閾値（汎用）                  | §7            |
| 45  | yaneBookOnTheFlyThresholdMB      | 定跡 on-the-fly 閾値（やねうら王）            | §7            |
| 46  | aperyBookOnTheFlyThresholdMB     | 定跡 on-the-fly 閾値（Apery）                 | §7            |
| 47  | sbkOnTheFlyThresholdMB           | 定跡 on-the-fly 閾値（SBK）                   | §7            |
| 48  | flippedBook                      | 反転局面も定跡検索                            | §7            |
| 49  | translateEngineOptionName        | エンジンオプション名の翻訳                    | §10           |
| 50  | engineTimeoutSeconds             | エンジン最大起動待ち時間                      | §10           |
| 51  | nodeCountFormat                  | ノード数表記                                  | §6.5          |
| 52  | showEngineOptionDetails          | オプション詳細の表示                          | §10           |
| 53  | evaluationViewFrom               | 評価値の符号（手番側/先手）                   | §6.5          |
| 54  | maxArrowsPerEngine               | 矢印の表示数                                  | §6.5          |
| 55  | arrowScoreDiffRange              | 矢印の評価値範囲                              | §6.5          |
| 56  | showArrowScore                   | 矢印に評価値を表示                            | §6.5          |
| 57  | coefficientInSigmoid             | 勝率換算係数                                  | §6.5          |
| 58  | badMoveLevelThreshold1           | 緩手の閾値                                    | §6.2          |
| 59  | badMoveLevelThreshold2           | 疑問手の閾値                                  | §6.2          |
| 60  | badMoveLevelThreshold3           | 悪手の閾値                                    | §6.2          |
| 61  | badMoveLevelThreshold4           | 大悪手の閾値                                  | §6.2          |
| 62  | maxPVTextLength                  | 読み筋表示手数の上限                          | §6.5          |
| 63  | searchCommentFormat              | 思考コメントのフォーマット                    | §1 / §4       |
| 64  | showElapsedTimeInRecordView      | 棋譜ビューに消費時間を表示                    | §1 / §9       |
| 65  | showCommentInRecordView          | 棋譜ビューにコメントを表示                    | §1 / §9       |
| 66  | branchListMode                   | 分岐の表示モード                              | §1            |
| 67  | enableAppLog                     | アプリログを出力                              | §12           |
| 68  | enableUSILog                     | USI通信ログを出力                             | §12           |
| 69  | enableCSALog                     | CSA通信ログを出力                             | §12           |
| 70  | logLevel                         | ログレベル                                    | §12           |
| 71  | positionImageStyle               | 局面図のスタイル                              | §8.4          |
| 72  | positionImageSize                | 局面図のサイズ                                | §8.4          |
| 73  | positionImageTypeface            | 局面図の書体                                  | §8.4          |
| 74  | positionImageHandLabelType       | 局面図の持ち駒ラベル種別                      | §8.4          |
| 75  | useBookmarkAsPositionImageHeader | しおりを局面図見出しに使う                    | §8.4          |
| 76  | positionImageHeader              | 局面図のカスタム見出し                        | §8.4          |
| 77  | positionImageCharacterY          | 局面図の文字の垂直位置                        | §8.4          |
| 78  | positionImageFontScale           | 局面図のフォント倍率                          | §8.4          |
| 79  | positionImageFontWeight          | 局面図のフォント太さ                          | §8.4          |
| 80  | lastRecordFilePath               | 最後に開いた棋譜パス（内部状態）              | §8            |
| 81  | lastBookFilePath                 | 最後に開いた定跡パス（内部状態）              | §7            |
| 82  | lastUSIEngineFilePath            | 最後に選んだエンジンパス（内部状態）          | §10           |
| 83  | lastImageExportFilePath          | 最後の画像出力先（内部状態）                  | §8.4          |
| 84  | lastOtherFilePath                | その他の最終ファイルパス（内部状態）          | §8            |
| 85  | emptyRecordInfoVisibility        | 棋譜情報の未入力項目の表示                    | §1 メタデータ |
| 86  | enableHardwareAcceleration       | HWA（ハードウェアアクセラレーション）の有効化 | §12           |

> 上記のほか、対局・CSA・解析・検討・詰み探索・定跡取り込み・一括変換・レイアウトの各機能は
> それぞれ専用の設定型（`GameSettings` / `CSAGameSettings` / `AnalysisSettings` / `ResearchSettings` /
> `MateSearchSettings` / `BookImportSettings` / `BatchConversionSettings` / `LayoutProfileList` 等）を持ち、
> 本文の対応する章（§4〜§9）で個別に列挙済み。

---

_この棚卸しは UI・メニュー・設定型・i18n 辞書から機械的に抽出したもの。各機能の内部実装詳細やフォーマット仕様は `specs/` 配下の個別ドキュメント（packed-sfen-format.md / sbk-format.md 等）を参照。_
