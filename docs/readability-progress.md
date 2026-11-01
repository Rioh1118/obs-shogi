# 読みやすさの整理の進捗

既存コードを `/readable-code` の基準へ揃える作業の順序と到達点。手順は `/tidy-code`、語は `CONTEXT.md` が正本。

## 到達点

- `src/__tests__/commentReadability.test.ts` の `BASELINE` が下がり続ける
- `CONTEXT.md` の「揺れが残っているもの」が空になる
- `src/__tests__/componentShape.test.ts` の `BASELINE` が下がり続ける
- 下の表の全ての範囲が「済」になる

## 進め方

- PR は下の段の枝を基点に積む。1段はレビューできる大きさにし、段の間で同じファイルを触らない。`BASELINE` の表とこのファイルは全段が触る例外で、下の載せ替えでは衝突しない
- 範囲は依存の下から取る。1回の範囲はテストを除いて2000行以内
- 動作が変わりうるコミットが大きくなる段は、整理だけの段と分ける
- `shared` と `entities` の公開の名前を変えるなら、呼び手を含めて独立した段にし、スタックの下に置く
- 線の名前（Tauri コマンド、serde の欄、イベント名、保存形式）は変えない

## 段の載せ替え

マージは下の段から順に行う。セッションの開始時に、マージ済みの段が無いかを見る。

1. `git fetch origin`
2. 一番上の枝で `git rebase --update-refs --onto origin/main <下の段の旧先端>`
3. 動いた枝ごとに `git push --force-with-lease`
4. `gh api -X PATCH repos/Rioh1118/obs-shogi/pulls/<番号> -f base=main`

ours 戦略のマージは使わない。

## 段の並び

下から順に積む。番号は PR。

| 段 | 枝 | 範囲 | PR | 状態 |
| -- | -- | ---- | -- | ---- |
| 1 | `refactor/readability-structure-standard` | 部品の構造と書き方の基準、`componentShape` | #662 | マージ済み |
| 2 | `refactor/tidy-shared-lib` | `src/shared/lib`、`src/shared/api` | #663 | マージ済み |
| 3 | `refactor/shared-public-names` | `shared` の公開の名前と呼び手 | #664 | マージ済み |
| 4 | `refactor/tidy-shared-ui` | `src/shared/ui` のコメントと書き方 | #665 | マージ済み |
| 5 | `refactor/structure-shared-ui` | `src/shared/ui` の部品の構造 | #667 | マージ済み |
| 6 | `refactor/tidy-entities-kifu` | `src/entities/kifu` の api と model | #668 | マージ済み |
| 7 | `refactor/position-public-names` | `src/entities/position` の公開の名前と呼び手 | #669 | マージ済み |
| 8 | `refactor/tidy-entities-position` | `src/entities/position` の残り | #670 | マージ済み |
| 9 | `refactor/tidy-entities-game-lib` | `src/entities/game` の `lib` | #672 | マージ済み |
| 10 | `refactor/tidy-entities-game-model` | `src/entities/game` の `model` | #673 | マージ済み |
| 11 | `refactor/tidy-entities-engine` | `src/entities/engine` | #674 | マージ済み |
| 12 | `refactor/tidy-entities-engine-presets` | `src/entities/engine-presets` | #675 | マージ済み |
| 13 | `refactor/tidy-entities-analysis-seat` | `src/entities/analysis` の `provider.tsx` 以外 | #677 | マージ済み |
| 14 | `refactor/tidy-entities-analysis-provider` | `src/entities/analysis/model/provider.tsx` | #678 | マージ済み |
| 15 | `refactor/tidy-entities-game-session` | `src/entities/game-session` | #680 | マージ済み |
| 16 | `refactor/tidy-entities-file-tree` | `src/entities/file-tree` の `provider.tsx` 以外 | #681 | マージ済み |
| 17 | `refactor/tidy-file-tree-provider` | `src/entities/file-tree/model/provider.tsx`、改名の不具合と #507 | #682 | マージ済み |
| 18 | `refactor/tidy-entities-search` | `src/entities/search` | #683 | マージ済み |
| 19 | `refactor/tidy-entities-book` | `src/entities/book` | #684 | マージ済み |
| 20 | `refactor/tidy-entities-rest` | `src/entities` の残り（app-config、dock、study-positions、updater） | #686 | レビュー待ち |

## 語

| 語              | 状態 | 結果                                                                   |
| --------------- | ---- | ---------------------------------------------------------------------- |
| 席              | 済   | `CONTEXT.md` に定義した                                                |
| 断り            | 済   | `CONTEXT.md` に定義した                                                |
| 口、門          | 済   | コメントとテストの文言を実物の語へ替え、`commentReadability` で止めた  |
| AI プロファイル | 済   | 画面の語の「AI フォルダ」へ揃えた。コードの `profile` は線の名前に揃えて残す |

`入口` は `entry point` の訳語で比喩ではないので残す。`docs/` の中の `口` と `門` は未着手で、
ADR と `.claude/reviews/` は書いた時点の記録なので替えない。

## TypeScript

行数はテストを除く。`状態` はコメント、名前、型、重複の整理（`/tidy-code` の種類1〜5）。`構造` は部品の構造と書き方（種類6と7、`docs/rules/ts.md` の R-TSC と R-TSW）。`—` は部品を持たない範囲で、書き方は `状態` に含める。

| 順 | 範囲                                                     | 行数 | 状態   | 構造   |
| -- | -------------------------------------------------------- | ---- | ------ | ------ |
| 1  | `src/shared/lib`、`src/shared/api`                       | 1102 | 済     | —      |
| 2  | `src/shared/ui`                                          | 2023 | 済     | 済     |
| 3  | `src/entities/kifu/lib`                                  | 1287 | 済     | —      |
| 4  | `src/entities/kifu` の残り                               | 1023 | 済     | —      |
| 5  | `src/entities/position`                                  | 1169 | 済     | 済     |
| 6  | `src/entities/game` の `lib`                             | 1141 | 済     | —      |
| 6b | `src/entities/game` の `model`                           | 1574 | 済     | 済     |
| 7  | `src/entities/engine`                                    | 1570 | 済     | 済     |
| 7b | `src/entities/engine-presets`                            |  972 | 済     | 済     |
| 8  | `src/entities/analysis` の `provider.tsx` 以外           | 1237 | 済     | —      |
| 8b | `src/entities/analysis/model/provider.tsx`               |  841 | 済     | 済     |
| 9  | `src/entities/game-session`                              | 1488 | 済     | 済     |
| 10 | `src/entities/file-tree` の `provider.tsx` 以外           | 1240 | 済     | 済     |
| 10b | `src/entities/file-tree/model/provider.tsx`              |  737 | 済     | 済     |
| 11 | `src/entities/search`                                    | 1587 | 済     | 済     |
| 11b | `src/entities/book`                                     |  867 | 済     | 済     |
| 12 | `src/entities` の残り（app-config、dock、study-positions、updater） | 1664 | 済     | 済     |
| 13 | `src/features/settings`                                  | 4778 | 未着手 | 未着手 |
| 14 | `src/features/position-search`、`src/features/position-editor` | 3186 | 未着手 | 未着手 |
| 15 | `src/features` の残り                                    | 4409 | 未着手 | 未着手 |
| 16 | `src/widgets`                                            | 5661 | 未着手 | 未着手 |
| 17 | `src/pages`、`src/app`                                   | 1682 | 未着手 | 未着手 |

2000行を超える範囲は、取るときに更に割る。

## Rust

`src-tauri/tests/layering.rs` の `LAYERS` の下の段から取る。行数はファイル内のテストを含む。

| 順 | 範囲                                                   | 行数  | 状態     |
| -- | ------------------------------------------------------ | ----- | -------- |
| 1  | `src-tauri/crates`（fs、kifu-text、settings、test-support） | 2145 | 未着手 |
| 2  | `src-tauri/src/storage`                                | 474   | 読み合わせのみ |
| 3  | `src-tauri/src/kifu`、`src-tauri/src/workspace`        | 1890  | 未着手   |
| 4  | `src-tauri/src/ai_library`                             | 808   | 未着手   |
| 5  | `src-tauri/src/engine` の `launchable` から `registry` まで |  | 未着手 |
| 6  | `src-tauri/src/engine` の `option_labels` から `start_failure` まで |  | 未着手 |
| 7  | `src-tauri/src/engine/game`                            |       | 未着手   |
| 8  | `src-tauri/src/engine` の `analyzer` から `commands` まで |    | 未着手   |
| 9  | `src-tauri/src/book`                                   | 7044  | 未着手   |
| 10 | `src-tauri/src/search`                                 | 14346 | 未着手   |

## 整理のときに直す所見

語の置き換えで見つけた、コメントとコードの食い違い。範囲を取ったときに直す。

| 場所 | 食い違い |
| ---- | -------- |
| `src-tauri/tests/root_guard.rs` の冒頭の doc | `validate_under_root` の場所を `utils.rs` と書くが、実体は `src-tauri/src/workspace/guard.rs` |
| `src/features/board-orientation/model/useBoardOrientation.ts` の冒頭の doc | URL の文字列を絞る検査は `PovType` にあると書くが、実体は `useURLParams.ts` の `povRaw === "gote"` で `PovType` は型だけ |
| `src/features/position-search/ui/PositionSearchModal.tsx` の `discardSearch` の説明 | `clearSearch` を呼ぶのは「ここだけ」と書くが、同じファイルの別の箇所でも呼ぶ |
| `src/features/game-move/ui/__tests__/gameMoveBridge.test.tsx` の `vi.mock` の doc | export が増えれば落ちると書くが、`importActual` を展開しているので落ちない疑いがある。未再現 |
| `src/entities/kifu/lib/applyMoveWithBranch.ts` の `usedExisting` と `createdNew` | 本番の読み手が0。テストだけが読んでいる |
| `src-tauri/src/kifu/commands.rs` の `convert_jkf_to_format` と `normalize_jkf` | TS の呼び手が0になった。線の名前なので消すかを `/decide` で決める |
| `src/entities/analysis/model/provider.tsx` の hook の順 | ref の宣言が effect の後ろに散り、R-TSW-4 の順と違う。自動再開の状態機械を割る Issue #489 で動くので、そこで揃える |
| `docs/state-transitions/analysis.md` の E11 の列、※1、不変条件1、3 の「席は握ったまま」 | ■ の停止が届かないと `reportUnreachable` で `isReady` が落ち、`onEngineGone` が欄を空ける。表の「握ったまま」は `isReady` を動かさない `provider.test.tsx` の mock でしか起きない。表とテストの mock を合わせて直す |
| `src/features/settings/ui/tabs/WorkspaceTab.tsx` の `copyText` | `shared/api/clipboard` と同じ名前で別の本体を持つ。寄せられるかを本体で判定する |
| `src/widgets/game-board/ui/PromotionDialog.tsx` の `promotionMap` | `positionDraft.ts` の `promotedKind` の写し。`src/widgets` の範囲で寄せると `PieceImage` の `kind` を `Kind` で受けられる |
| `src/entities/position/lib/positionDraft.ts` の `PROMOTED` | `shogi.js` の `Piece.promote` の写し。`promotionMap` の行と合わせて寄せる |
| `src/entities/kifu/lib/applyMoveWithBranch.ts` の `promotable` | `src/entities/game/lib/moveValidation.ts` の `canPromote` と同じ規則。`entities/kifu` は `entities/game` より下なので、寄せるなら `shared/lib/shogi` へ下げる |
| `src/features/game-ruling/lib/rulingAdapter.ts` の `toRuling` の doc、`createRulingAdapter` の doc、`unplayableDetail` の doc | 主語が `judgeGameOutcome` だが、この関数が呼ぶのは `createOutcomeJudge`。「棋譜と画面に残る」も、`detail` の読み手が0で棋譜に結果が残らないので誤り。`features/game-ruling` の範囲で直す |
| `src-tauri/src/storage/disk.rs` の読み手 | 2つの rename の間で値があるのに `NotFound` を受ける筋がある。未再現 |
| `src-tauri/src/storage/disk.rs` の load の doc | この save では起きない破損を理由に挙げている疑いがある。未確認 |
| `src/entities/game/model/provider.tsx` の `getCurrentTurn`、`getCurrentMoveIndex`、`getTotalMoves` | `view` と `state.cursor` の値を返すだけの包み。読み手は `src/widgets` と `src/features` なので、その範囲で直接読む形へ寄せる |
| `src-tauri/src/engine/commands/analysis.rs` の `get_analysis_result`、`get_last_result`、`get_analysis_status` | TS の呼び手が0になった。線の名前なので消すかを `/decide` で決める |
| `src/entities/engine/model/types.ts` の `EngineState` | `phase` ごとの欄を判別できる union にすれば、`engineFailureNoticeOf` の `?? "noAnswer"` と `?? "unknown"` が消える。読み手が `src/app` と `src/widgets` に広がるので、その範囲で決める。`engineStatusOf` は `engine.error?.kind ?? null` を `failureKind` で受けており、union にすれば `useEngineStatus` の変換と `failureKind` の null の説明も消える。判定の順は変わらない |
| `src/entities/game-session/model/provider.tsx` の `retireEngines` | `over` は Rust の `finish` が `send_gameover` を待つ前に届くので、裁定や投了の呼び出しが `Arc` を持ったままの `close_game` は `busy` で断られる筋がある。呼び直す者が居ないので `isHeld` が真のまま残る。`Err` を受けたら間隔を空けて呼び直すかは、ADR-0011 の「`start` が畳み直す」と合わせて対局の面を戻すときに決める。未再現 |
| `src/entities/game-session/model/provider.tsx` の `start` の `void closeGame(gameId)` | 手放した対局を畳む呼び出しの断りを誰も受けない。本番の呼び手が `closeSession` しか無いので、対局の面を戻すときに決める |
| `src-tauri/src/workspace/commands/kifu.rs` の `save_kifu_file` | TS の呼び手が0になった。線の名前なので消すかを `/decide` で決める |
| `src/entities/file-tree/model/types.ts` の `displayInfo.iconType` | `isDirectory` の写しで、読み手は `src/widgets/file-tree` の2か所。`src/widgets` の範囲で `FileIcon` の受け方と合わせて畳む |
| `src/widgets/file-tree/ui/FileNode.tsx` の `isSelected` | `selectedNode?.id === node.id` で比べるが、`id` は走査ごとに振り直され、`tree_loaded` は `selectedNode` を張り替えない。読み直すと棋譜は開いたまま行の強調が消える筋がある。未再現。`path` で比べる形を `src/widgets` の範囲で見る |
| `src/widgets/file-tree/ui/FileTree.tsx` のコメントの `再読み込み` | ボタンの文言は `FileTreeErrorNotice.tsx` の「もう一度読み込む」。`src/widgets` の範囲で揃える |
| `src/widgets/file-tree/lib/dnd.ts` の `ALLOWED`、`getExt`、`findDropDirAt` | `knip` が未使用と数えている。`src/widgets` の範囲で見る |
| `src/entities/kifu/api/parse.ts` の `parseKifuContentToJKF` | 形式を拡張子だけで決めるので、Finder で変えたファイルは本文と形式がずれたまま0手で載り、次の保存で本文を失う筋がある。未再現。指し手が0で本文が空でないときに開くのを断るかを、#210 と合わせて決める |
| `src/features/position-search/ui/PositionSearchModal.tsx` の `.claude/reviews/2026-09-07-447-position-search-perf-r1.md` | git に載っていない。`src/features/position-search` の範囲で実測の値だけを残す |
| `src/entities/search/model/reducer.ts` の `open_start` | 根を変えても `warns` を残すので、前の根の絶対パスが設定の画面に残る。`src-tauri/src/search/announce.rs` の `warn_scan_failed` の doc は「開き直しても消えない」を前提にしている。`src/features/settings` の範囲で、根を変えたら消すかを決める |
| `src/widgets/book-view/ui/BookView.tsx` の `body` の `switch` | 戻り値が `ReactNode` で `default` も無いので、`BookViewState` に `kind` を足しても tsc が落ちず、本体が空になる。`src/widgets` の範囲で `never` の網羅を足す |
| `src/widgets/book-view/ui/BookControls.tsx` の ✕ と `BookProvider` の `close` | 題は「開くのを中止」だが、開き直しの途中で押すと、開いていた定跡まで閉じて `closed` へ落ちる。中止で前の定跡へ戻すかを `src/widgets` の範囲で決める |
| `src/entities/book/model/provider.tsx` の辿る失敗の枝 | `invalid_handle` を引く枝でしか見ていないので、辿るのが落ちても次に局面が動くまで開き直す一覧へ戻らない。TS から閉じる経路は全部 `stale` で捨てられるので、踏む筋は未再現 |
| `src-tauri/src/book/commands.rs` の `open_book` と `list_books` | 開いている間に webview が作り直されると、登録が新しい `list_books` より後になり、ハンドルが次の読み直しまで残る筋がある。未再現 |
| `src/features/settings/ui/tabs/WorkspaceTab.tsx` の「更新を確認」 | `downloading`、`installing`、`ready` の間は `runCheck` が走らないが、ボタンの無効化は `isChecking` だけを見るので押せて、何も返らず前の答えが残る。`src/features/settings` の範囲で無効にするか理由を出す |
| `src/features/study-position-save/ui/StudyPositionSaveModal.tsx` の `existing` | `findBySfen` の同一性が動かないので、開いた後に一覧が届いても `existing` が再計算されない。一覧に追わせると `isOpen, existing` の effect がフォームを初期化し、保存の失敗の巻き戻しで入力が消える。effect の条件を分けてから直す |
| `src/entities/updater/model/provider.tsx` の `persist` | 記憶を読み終える前に `checkNow` が通ると、`skippedVersion: null` で `updater.json` を書く。provider の単体では再現した。読み込みの応答より前に設定を開く必要があり、失うものは告知1回。手順では未再現 |
| `src/entities/app-config/api/directories.ts` の `chooseDirectory` | ピッカーの前に読んだ設定を閉じた後に書くので、開いている間に列の書き込みが入るとその欄が消える。ピッカーが画面を止めるなら踏めない。未再現 |
| `src/entities/game/model/provider.tsx` の `edit` の `forceCommit` | `makeMove` は必ず局面を動かすので、`forceCommit` と局面の不動の判定は結果を変えない。読み手が増えるなら残す判定で、消すかを `entities/kifu` の `applyMoveWithBranch` の契約と合わせて決める |

## 次に取る範囲

`src/features/settings`。4778行あるので、取るときに割る。
