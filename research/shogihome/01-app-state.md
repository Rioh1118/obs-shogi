# 01 アプリ全体の状態機械

出典: `src/common/control/state.ts`、`src/renderer/store/index.ts`
版: `de27f0c1c352`

## 事実

### `AppState` は 28 値のフラット enum

`src/common/control/state.ts` に、**ダイアログも対局も解析も同じ1つの enum に入っている**。

```
NORMAL
PASTE_DIALOG / POSITION_EDITING_DIALOG / EXPORT_POSITION_IMAGE_DIALOG
GAME_DIALOG / GAME / PARALLEL_GAME
CSA_GAME_DIALOG / CSA_GAME
ANALYSIS_DIALOG / ANALYSIS / BATCH_ANALYSIS
MATE_SEARCH_DIALOG / MATE_SEARCH
USI_ENGINES_DIALOG / RECORD_FILE_HISTORY_DIALOG / BATCH_CONVERSION_DIALOG
LAUNCH_USI_ENGINE_DIALOG / CONNECT_TO_CSA_SERVER_DIALOG / LOAD_REMOTE_FILE_DIALOG
SHARE_DIALOG / ADD_BOOK_MOVES_DIALOG / RESET_BOOK_DIALOG / BOOK_PROPERTIES_DIALOG
SEARCH_DUPLICATE_POSITIONS_DIALOG / ELAPSED_TIME_CHART_DIALOG
NEXT_MOVE_GENERATION_DIALOG / NEXT_MOVE_GENERATION
```

`(ダイアログ, 実行中)` が対になっているものが5組ある
（GAME / CSA_GAME / ANALYSIS / MATE_SEARCH / NEXT_MOVE_GENERATION）。
**設定する状態と走っている状態を別の値にしている。**

### 入口は全て `AppState.NORMAL` でガードされている

`src/renderer/store/index.ts` の `show*Dialog()` のうち **18個**が

```ts
if (this.appState === AppState.NORMAL) {
  this._appState = AppState.XXX_DIALOG;
}
```

の形をしている。**全数は `grep -n 'show[A-Za-z]*Dialog' src/renderer/store/index.ts` で数える**
（`show.*Dialog()` は `()` が literal なので `showPasteDialog(mode: ...)` を落とす）。以下は抜粋:
`showGameDialog` / `showCSAGameDialog` / `showAnalysisDialog` /
`showMateSearchDialog` / `showUsiEngineManagementDialog` / `showRecordFileHistoryDialog` /
`showBatchConversionDialog` / `showExportBoardImageDialog` /
`showLaunchUSIEngineDialog` / `showConnectToCSAServerDialog` /
`showLoadRemoteFileDialog` / `showShareDialog` / `showAddBookMovesDialog` /
`showResetBookDialog` / `showBookPropertiesDialog` /
`showSearchDuplicatePositionsDialog` / `showElapsedTimeChartDialog`）。

`showPasteDialog` と `showPositionEditingDialog` は
`if (this.appState !== AppState.NORMAL) return` の形で、判定は同じ。

**ただし「NORMAL 以外は全部禁止」は全数としては成立しない。** ガードを持たないものが2つある。

| メソッド                | 場所                 | ガード                                                             |
| ----------------------- | -------------------- | ------------------------------------------------------------------ |
| `showAppSettingsDialog` | `store/index.ts:563` | **無し。**`AppState` を見ずに `_isAppSettingsDialogVisible = true` |
| `showPVPreviewDialog`   | `store/index.ts:398` | **無し。**`_pvPreview` を入れるだけ                                |

**対局中でもアプリ設定と読み筋プレビューは開ける。**

**帰結: `AppState.GAME`（対局中）では、ガードを持つ18個が1つも開けない。**
局面編集も、エンジン管理も、棋譜の変換も、共有も開けない。
「対局中に何を禁止するか」を個別に決めるのではなく、
**NORMAL でないなら開かない**という1本の規則をほぼ全ての入口に貼って落としている。
**例外は上の2つ**（アプリ設定・読み筋プレビュー）で、
どちらも「棋譜の状態を変えない」ものだという線引きに見える。

### 検討（research）だけは直交する別の enum

同じ `state.ts` に、独立した3値の enum がある。

```ts
export enum ResearchState {
  IDLE = "idle",
  STARTUP_DIALOG = "startupDialog",
  RUNNING = "running",
}
```

`AppState` に `RESEARCH` は無い。**検討は `AppState` と直交していて、
対局中でも走らせられる。** これは「解析だけは対局と同時に動く」という設計判断が
型に出ているということ。

一方で `ANALYSIS`（棋譜の一括解析）は `AppState` 側にあり、対局と排他になる。
**「検討＝いま見ている局面を読み続ける」と「解析＝棋譜を頭から評価する」を、
状態機械の階層ごと分けている。**

## obs-shogi との対応

|                | ShogiHome                                     | obs-shogi（`main` / `a435ba4`）                          |
| -------------- | --------------------------------------------- | -------------------------------------------------------- |
| モーダルの排他 | `AppState` 1本。`NORMAL` 以外は開けない       | URL の `modal` パラメータ。**ガードが無い**              |
| 状態の置き場   | `common/control/state.ts`（両プロセスが見る） | `shared/lib/router/useURLParams.ts` の `ModalType` union |
| 設定中と実行中 | 別の値（`GAME_DIALOG` / `GAME`）              | 対局が無いので対応物なし                                 |
| 解析の位置     | `ResearchState` として直交                    | `entities/analysis`。`AppState` 相当が存在しない         |

**obs-shogi にはアプリ全体の状態を1つ持つ場所が無い。**
`ModalType` は「どのモーダルを出すか」であって「アプリが何をしている最中か」ではない。
対局を入れると後者が要る。

## 所感

- 28 値のフラット enum は素朴だが、**「NORMAL 以外は禁止」という1行の規則で
  組み合わせ爆発を殺している**のが効いている。交差表を人間が埋める必要が無い。
- 代償は「対局中に棋譜のプロパティも見られない」こと。実際に使うと窮屈なはず。
  そこを緩めたければ、緩める対象を1つずつ `AppState.GAME` にも許す形で足すことになる。
- **検討だけを直交させた**のは、対局中に読み筋を見たい需要が実在するから
  だと読める（`SingleGameSettings.enableComment` / `searchCommentFormat` が
  対局中の読み筋をコメントに書き込む機能を持っている → 02）。
