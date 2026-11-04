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
| 20 | `refactor/tidy-entities-rest` | `src/entities` の残り（app-config、dock、study-positions、updater） | #686 | マージ済み |
| 21 | `refactor/tidy-features-settings-workspace` | `src/features/settings` の第1段（範囲13） | #687 | マージ済み |
| 22 | `refactor/tidy-features-settings-ai-library` | `src/features/settings` の AI ライブラリタブ（範囲13b） | #688 | マージ済み |
| 23 | `refactor/tidy-features-settings-preset-dialog` | `src/features/settings` のプリセット編集（範囲13c） | #690 | マージ済み |
| 24 | `refactor/tidy-features-position-search` | `src/features/position-search`（範囲14の第1段） | #692 | マージ済み |
| 25 | `refactor/tidy-features-position-editor` | `src/features/position-editor`（範囲14の第2段） | #693 | マージ済み |
| 26 | `refactor/tidy-features-create-file` | `src/features` の `create-file`、`file-conflict`、`study-position-save`（範囲15の第1段）、保存先の欄の不具合 | #694 | マージ済み |
| 27 | `refactor/tidy-features-study-positions` | `src/features` の `study-positions-manager`、`position-navigation`、`kifu-comment-note`（範囲15の第2段）、局面を保存する対話の詰め直し | #695 | マージ済み |
| 28 | `refactor/tidy-features-rest` | `src/features` の残りの8つ（範囲15の第3段） | #696 | マージ済み |
| 29 | `refactor/tidy-widgets-kifu-stream` | `src/widgets/kifu-stream`（範囲16の第1段） | #697 | マージ済み |
| 30 | `refactor/tidy-widgets-file-tree` | `src/widgets/file-tree`（範囲16の第2段）、読み直した後の行の強調 | #698 | マージ済み |
| 31 | `refactor/tidy-widgets-analysis-board` | `src/widgets` の `analysis-pane`、`game-board`（範囲16の第3段） | #699 | マージ済み |
| 32 | `refactor/tidy-widgets-rest` | `src/widgets` の `book-view`、`app-layout-header`、`dock`、`boot-splash`、`sidebar`（範囲16の第4段） | #700 | マージ済み |
| 33 | `refactor/tidy-pages-app` | `src/pages`、`src/app`（範囲17） | #701 | マージ済み |
| 34 | `refactor/tidy-rust-fs-kifu-text` | `src-tauri/crates` の `fs`、`kifu-text`、`test-support`（Rust の範囲1）、`fs` の試験のコンパイル | #702 | マージ済み |
| 35 | `refactor/tidy-rust-settings` | `src-tauri/crates/settings`（Rust の範囲1b）、`crates/*` の試験を `verify:rust` と CI に載せる | #704 | マージ済み |
| 36 | `refactor/tidy-rust-storage` | `src-tauri/src/storage`（Rust の範囲2）、`.` の後ろだけが違う key の取り違え | #705 | マージ済み |
| 37 | `refactor/tidy-rust-kifu-workspace` | `src-tauri/src/kifu`、`src-tauri/src/workspace`（Rust の範囲3） | | レビュー待ち |

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
| 13 | `src/features/settings` の `ui/tabs`（`AiLibraryTab.tsx` 以外）、`ui/kit`、`ui/workspace-tab`、`ui/engine-tab`、`SettingsPanel` まわり、`model/tabs.ts` | 1389 | 済 | 済 |
| 13b | `src/features/settings` の `ui/tabs/AiLibraryTab.tsx`、`ui/ai-library-tab` | 1599 | 済 | 済 |
| 13c | `src/features/settings` の `ui/engine-preset-dialog`、`lib`、`model/presetDialogReducer.ts` | 1858 | 済 | 済 |
| 14 | `src/features/position-search` | 1677 | 済 | 済 |
| 14b | `src/features/position-editor` | 1514 | 済 | 済 |
| 15 | `src/features` の `create-file`、`file-conflict`、`study-position-save` | 1471 | 済 | 済 |
| 15b | `src/features` の `study-positions-manager`、`position-navigation`、`kifu-comment-note` | 1830 | 済 | 済 |
| 15c | `src/features` の残りの8つ（`game-move`、`engine-position-sync`、`updater` など） |  923 | 済 | 済 |
| 16 | `src/widgets/kifu-stream`                                | 1472 | 済     | 済     |
| 16b | `src/widgets/file-tree`                                 | 1395 | 済     | 済     |
| 16c | `src/widgets` の `analysis-pane`、`game-board`          | 1754 | 済     | 済     |
| 16d | `src/widgets` の `book-view`、`app-layout-header`、`dock`、`boot-splash`、`sidebar` | 1034 | 済 | 済 |
| 17 | `src/pages`、`src/app`                                   | 1682 | 済     | 済     |

2000行を超える範囲は、取るときに更に割る。

## Rust

`src-tauri/tests/layering.rs` の `LAYERS` の下の段から取る。行数はファイル内のテストを含む。

| 順 | 範囲                                                   | 行数  | 状態     |
| -- | ------------------------------------------------------ | ----- | -------- |
| 1  | `src-tauri/crates` の `fs`、`kifu-text`、`test-support`   | 773   | 済       |
| 1b | `src-tauri/crates/settings`                            | 1405  | 済       |
| 2  | `src-tauri/src/storage`                                | 552   | 済       |
| 3  | `src-tauri/src/kifu`、`src-tauri/src/workspace`        | 1895  | 済       |
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
| `src/entities/kifu/lib/applyMoveWithBranch.ts` の `usedExisting` と `createdNew` | 本番の読み手が0。テストだけが読んでいる |
| `src-tauri/src/kifu/commands.rs` の `convert_jkf_to_format` と `normalize_jkf` | TS の呼び手は0。範囲3では消さなかった。`docs/spec/features/special-moves.md` が往復を確かめる経路として名指ししており、消すと仕様の文と `lib.rs` の登録まで範囲の外へ広がる。正規化をどの経路へ揃えるか（#322 を吸収した epic #349）で変換の経路が残るかが決まるので、そこで消すかを決める。`WriteKifuResponse` の `normalized_jkf` は正規化していない JKF を返し、範囲3で doc にそう書いた |
| `src/entities/analysis/model/provider.tsx` の hook の順 | ref の宣言が effect の後ろに散り、R-TSW-4 の順と違う。自動再開の状態機械を割る Issue #489 で動くので、そこで揃える |
| `docs/state-transitions/analysis.md` の E11 の列、※1、不変条件1、3 の「席は握ったまま」 | ■ の停止が届かないと `reportUnreachable` で `isReady` が落ち、`onEngineGone` が欄を空ける。表の「握ったまま」は `isReady` を動かさない `provider.test.tsx` の mock でしか起きない。表とテストの mock を合わせて直す |
| `src/entities/position/lib/positionDraft.ts` の `PROMOTED` | `shogi.js` の `Piece.promote` の写し。盤の成りの選択肢（`PromotionDialog`）も範囲16の第3段から `promotedKind` を通る。`Piece.promote` へ寄せるかは、逆引きの `UNPROMOTED` と合わせて決める |
| `src/entities/position/ui/PieceImage.tsx` の `kind: string` | 範囲16の第3段で、読み手は全部 `Kind` を渡すようになった（`Board`、`Hand`、`PromotionDialog`、`features/position-editor` の3つ、`BoardPreview`）。`Kind` で受けるなら、`isKnownKind` の検査と、知らない綴りを描かない `PieceImage.test.tsx` の3本を残すかを合わせて決める |
| `src/entities/kifu/lib/applyMoveWithBranch.ts` の `promotable` | `src/entities/game/lib/moveValidation.ts` の `canPromote` と同じ規則。`entities/kifu` は `entities/game` より下なので、寄せるなら `shared/lib/shogi` へ下げる |
| `src-tauri/src/storage/disk.rs` の `load` | 本体が `NotFound` の後に `bak.exists()` を見るので、その間に置き直しが2つ目の rename と退避の削除を終えると、本体に値が在るのに `NotFound` を返す筋がある。範囲2で、置き直しを5000回続ける間に読み続ける試験を3回走らせ、1回も起きなかった（未再現）。起きても索引の復元が全件の構築へ落ちるだけ。直すなら、退避が読めなければ本体を読み直す。下の Windows の行で退避をやめるなら筋ごと消える |
| `src-tauri/src/storage/disk.rs` の `paths` の doc | 退避を挟む理由を「Windows で上書きの rename が失敗するため」と書くが、`std::fs::rename` は Windows でも `MOVEFILE_REPLACE_EXISTING` で上書きする。失敗するのは、他のプロセスが削除の共有を許さずに開いているときに限られる。Windows で確かめてから、退避をやめるかを決める |
| `src-tauri/src/storage/mod.rs` の `BlobStore::delete` | 本番の呼び手が0で、試験だけが呼ぶ。`search/cache/format.rs` の `CACHE_VERSION` の doc は、読めない旧版の blob がディスクに残り続けると書く。復元が版の違いで落ちたときに捨てるかを、索引のキャッシュを次に触るときに決める。捨てないなら trait から外す |
| `src/entities/game/model/provider.tsx` の `getCurrentMoveIndex` | `state.cursor?.tesuu ?? 0` を返すだけの包み。`getCurrentTurn` は範囲16の第3段で、`getTotalMoves` は第4段で読み手が0になったので消した。残る読み手は `src/features` の `StudyPositionSaveModal` だけで、`src/features` の範囲は済んでいる。`features/study-position-save` を次に触るときに `state.cursor` を読む形へ寄せ、包みを消す |
| `src-tauri/src/engine/commands/analysis.rs` の `get_analysis_result`、`get_last_result`、`get_analysis_status` | TS の呼び手が0になった。線の名前なので消すかを `/decide` で決める |
| `src/entities/engine/model/types.ts` の `EngineState` | `phase` ごとの欄を判別できる union にすれば、`engineFailureNoticeOf` の `?? "noAnswer"` と `?? "unknown"` が消える。範囲17でも送った。union にすると `entities/engine` の reducer（状態機械）と provider の `isReady`、`notReadyReasonOf` の入力が変わり、`entities` の公開の型が変わる。進め方の「`entities` の公開の名前を変えるなら、呼び手を含めて独立した段にする」に当たるので、整理の段に混ぜない。`src/app` で状態を読むのは `EngineFailureBridge`（`phase`、`error`、`unresponsiveReason`）と `EngineStartWarningBridge`（`phase`、`startWarnings`）の2つ。ほかの読み手は `features/engine-position-sync`、`entities/analysis` の provider、`src/widgets` の `AnalysisControls` と `useEngineStatus`。`engineFailureNoticeOf` は `exited`、`unresponsive`、`error`、未設定の順に見るので、union にしても判定の順は変わらない |
| `src/__tests__/crossSliceImports.ts` の `scanCrossSliceImports` | 層の直下のディレクトリを全部スライスとして歩くので、`src/pages/__tests__` が `pages/__tests__` というスライスに数えられる。doc は「`__tests__` は外す」と書くが、外れるのはスライスの中の `__tests__` だけ。範囲17では、試験の `satisfies typeof import` を相対パスで書いて避けた。層の直下の `__tests__` を歩かないように直すかを決める |
| `src/entities/game-session/model/provider.tsx` の `retireEngines` | `over` は Rust の `finish` が `send_gameover` を待つ前に届くので、裁定や投了の呼び出しが `Arc` を持ったままの `close_game` は `busy` で断られる筋がある。呼び直す者が居ないので `isHeld` が真のまま残る。`Err` を受けたら間隔を空けて呼び直すかは、ADR-0011 の「`start` が畳み直す」と合わせて対局の面を戻すときに決める。未再現 |
| `src/entities/game-session/model/provider.tsx` の `start` の `void closeGame(gameId)` | 手放した対局を畳む呼び出しの断りを誰も受けない。本番の呼び手が `closeSession` しか無いので、対局の面を戻すときに決める |
| `src-tauri/src/workspace/commands/kifu.rs` の `save_kifu_file` | TS の呼び手は0。範囲3では消さなかった。保存し直しの `write_kifu_to_file` は失敗を `FsError` の外で生の英文のまま返す（`kifu/commands.rs` の `TODO(#215)`）。綴り終えた本文を `FsError` で書くコマンドはこれだけなので、保存を `FsError` へ寄せるときに、これを使うか消すかを #215 で決める |
| `src/widgets/file-tree/ui/TreeNode.tsx` の `key={child.id}` と、`renamingNodeId` | どちらも走査のたびに振り直す `id` で同一性を見るので、読み直すとフォルダの下の行が作り直され、改名の欄が打った文字ごと畳まれる。行の強調はパスで比べる形へ直した（範囲16の第2段）。`renamingNodeId` を `path` にするのは `entities/file-tree` の state の変更で、改名と移動の張り替えと合わせて決める |
| `src/widgets/file-tree/ui/TreeNodeActions.tsx` の `isDirectory` | 呼び手はルートとフォルダの行だけで、常に真。消すと `shared/lib/path.ts` の `getParentPath` の読み手が0になるので、`shared` の範囲と合わせて消す |
| `src/widgets/file-tree/ui/DirectoryToggleIcon.scss` の `transition: transform 0.15 ease` | 時間に単位が無く、宣言ごと無効になっている。フォルダの矢印は回らずに切り替わる。直すと見た目が変わるので、画面の動きの棚卸しで決める |
| `src/entities/kifu/api/parse.ts` の `parseKifuContentToJKF` | 形式を拡張子だけで決めるので、Finder で変えたファイルは本文と形式がずれたまま0手で載り、次の保存で本文を失う筋がある。未再現。指し手が0で本文が空でないときに開くのを断るかを、#210 と合わせて決める |
| `src/widgets/book-view/ui/BookControls.tsx` の ✕ と `BookProvider` の `close` | 題は「開くのを中止」だが、開き直しの途中で押すと、開いていた定跡まで閉じて `closed` へ落ちる。範囲16の第4段で再現し、今の動きを `bookControls.test.tsx` に固定した。直すと `entities/book` の状態と画面の動きが変わるので送った。中止で前の定跡へ戻すか、題を「閉じる」に揃えるかを決める |
| `src/entities/book/model/provider.tsx` の辿る失敗の枝 | `invalid_handle` を引く枝でしか見ていないので、辿るのが落ちても次に局面が動くまで開き直す一覧へ戻らない。TS から閉じる経路は全部 `stale` で捨てられるので、踏む筋は未再現 |
| `src-tauri/src/book/commands.rs` の `open_book` と `list_books` | 開いている間に webview が作り直されると、登録が新しい `list_books` より後になり、ハンドルが次の読み直しまで残る筋がある。未再現 |
| `src/entities/updater/model/provider.tsx` の `persist` | 記憶を読み終える前に `checkNow` が通ると、`skippedVersion: null` で `updater.json` を書く。provider の単体では再現した。読み込みの応答より前に設定を開く必要があり、失うものは告知1回。手順では未再現 |
| `src/entities/app-config/api/directories.ts` の `chooseDirectory` | ピッカーの前に読んだ設定を閉じた後に書くので、開いている間に列の書き込みが入るとその欄が消える。ピッカーが画面を止めるなら踏めない。未再現 |
| `src/features/kifu-comment-note/lib/faceKey.ts` の `faceKey` | 要求の `forkPointers` を正規化せずに鍵へ入れるので、`cursorKey` なら同じ鍵になる、カーソルより先の予定だけが違う2つの要求が別の面になる。別の面と見ると、書きかけの本文を出ていく面として書き、エディタを組み直す。唯一の呼び手の `KifuStreamList` は渡さない。`onOpenComment` は要求を `descendTo` で組み、`descendTo` は計画から `te` 未満の欄だけを残して `te` に高々1つを足し、`te` の順に並べ直す。計画は `mergeBranchPlan` が重複を落として並べた形なので、`te > tesuu` の欄も同じ `te` の重複も要求に入らず、`cursorKey` の正規化と結果が一致する。別の呼び手を足すときは鍵に正規化を入れる |
| `src/features/kifu-comment-note/ui/KifuCommentNote.tsx` の hook の順 | ref の宣言が effect の間に散り、R-TSW-4 の順と違う。各 ref の理由を書いたコメントが使う effect の隣にあるので、範囲15の第2段では動かさなかった。本体を割るときに揃える |
| `src/features/settings/ui/engine-tab/PresetCard.tsx` の `article` | `role="button"` の中にボタンがある。読み上げと操作の入れ子を解くかは、カードの適用の押し方と合わせて決める |
| `src/features/settings/ui/workspace-tab/AppUpdateSection.tsx` の確認の結果 | 取得を始めた後も「この画面を閉じると案内が出ます」が残る。押せなくした後に残る前の答えで、段が動いたら消すかを決める |
| `src/features/settings/lib/aiLibraryContents.ts` の `warningsOf` の定跡 | 定跡は任意なのに、無いと「検出された問題」に出てバッジが「注意あり」のまま消えない。hero は「土台は完成」、木は「（任意）」、一覧は「未設定」と言う。任意なら警告から外すかを決める |
| `src/features/settings/model/useAiLibrary.ts` の `trim` | 走査と作成は前後の空白を落とし、開くとコピーは落とさない。名前の末尾に空白のあるフォルダを選ぶと、別のパスを読む。ピッカーの返す値は落とさない形へ揃えられる |
| `src/features/settings/model/presetDialogReducer.ts` の `optionsCleared` | 絞り込みで一部の行だけを戻しても、当てて変えた値の一覧を全部消す。戻していない値の変更は保存で確定するのに、画面の説明が消える。消した名前の行だけを落とすかを決める |
| `src/features/settings/model/useAiRootIndex.ts` の `createEnginesDir` | 待っている間に読み直しを押し、作成が失敗してから走査が成功すると、失敗文が消える。`useAiLibrary` も同じ形。未再現 |
| `src/features/settings/model/useAiLibrary.ts` の `aiRootPath` | `config.ai_root` の控え（R-TSS-4）。本番では `chooseAiRoot` が設定を更新してから返るので要らないが、`AiLibraryTab.test.tsx` の `useAppConfig` の mock は値が変わっても描き直さず、控えの更新が再描画を起こしている。mock を購読の形にしてから消す |
| `src/features/settings/ui/ai-library-tab/steps/Step3PlaceEngines.tsx` の「個検出」 | 状態のカードは同じ数を「件」と書く。`Step4PlaceAssets.tsx` も同じ。単位を揃えるかを画面の語の棚卸しで決める |
| `src-tauri/src/search/build.rs` と `project_manager.rs` の棋譜の警告 | `warn_scan_failed` と違って代を見ずに出すので、根が変わった直後に届くと前の根のパスが残る筋がある。未再現 |
| `src/features/position-search/ui/VirtualHitRow.tsx` の `path unknown` | 索引がパスを返さない行に英語のまま出る。画面の語の棚卸しで、断りの「この棋譜の場所が分かりません」と揃えるかを決める |
| `src/shared/lib/path.ts` の `toRelPath` | `norm` が最初の `\` しか置き換えないので、名前に `\` を2つ以上含む棋譜は相対パスに `\` が残る。局面検索の行のファイル名は `getBaseName` が `\` でも区切るので、パスの欄と名前の欄で区切りが食い違う。TODO(#216) で直す |
| `src/features/engine-position-sync/model/useEnginePositionSync.ts` の `pendingBeforeReadyRef` | `isReady` が `syncPosition` の依存にあるので、ready になると自動同期の effect が送り直す。保留を書かない変異を当てても `src/features src/pages src/widgets src/app` の試験は落ちない。保留の ref と送り直しの effect を消すかを、部品の構造の段で決める |
| `src/entities/game/lib/gameOutcome.ts` の `stalemate` の doc | 詰みと分ける理由を「棋譜に落とす綴りが違うため」と書くが、説明の綴りを決める `rulingAdapter.ts` の `detail` は Rust の終局の結果に載るだけで、棋譜にも画面にも読み手が無い |
| `src/__tests__/viMockShape.test.ts` の冒頭の doc | `satisfies` で export の増減と改名を tsc が落とすと書くが、`importActual` を展開する形では増えても落ちない。`entities/game` に export を足して `gameMoveBridge.test.tsx` の tsc が通ることを確かめた。差し替えの形ごとに何が落ちるかを書き分ける |
| `src/entities/game/model/provider.tsx` の `edit` の `forceCommit` | `makeMove` は必ず局面を動かすので、`forceCommit` と局面の不動の判定は結果を変えない。読み手が増えるなら残す判定で、消すかを `entities/kifu` の `applyMoveWithBranch` の契約と合わせて決める |
| `src/widgets/kifu-stream/ui/KifuForkMenu.tsx` の `normalizeSelected` と、`KifuStreamList.tsx` の分岐メニューの外側押下の `menuEl` の判定 | どちらも外すと結果が変わらない。行の選択は `buildStreamRowsFromCursor` が実際に降りた添字しか返さず、メニューの中の押下は `KifuForkMenu` の `stopPropagation` で document まで届かない。分岐メニューの閉じ方を直す #278 と合わせて、消すかを決める |
| `src/widgets/game-board/ui/useHandLayout.ts` の段の割り振り | 片側の持ち駒が21〜23枚と29枚以上のとき、1段の幅が駒台の 20em を超える（22枚で最後の段に10枚、29.3em。38枚で26枚）。仮に並べるときの上限 `10` で偏りの判定が1段4枚の配置に落ち、余りを最後の段に寄せるため。`useHandLayout` を単体で呼んで再現した。直すと並べ方が変わるので、何枚まで4段で収めるかと合わせて決める |
| `src/widgets/game-board/ui/Board.tsx` の成りの選択肢の取り消し | 待っている間に局面が動いたかを `player.tesuu` だけで見るので、同じ手数の別の変化へ移ると選択肢が残る。選ぶと、押した時点の `selectSquare` の閉包で前の局面の手として指す筋がある。未再現 |
| `src-tauri/src/ai_library/commands.rs` の `create_ai_profile_dirs` の `ai_root` の検査 | AI ルートが無いときも `invalid_path` で返し、同じファイルの `a_rejected_name_carries_a_code` がそれを固定している。`FsErrorCode` の doc は、ワークスペースの中で「無い」を `invalid_path` に載せると tier が `danger` になり「再読み込み」が消えると書く。AI ルートを Finder で消したときに同じ形になるかを、範囲4で `not_found` へ分けるかと合わせて決める |
| `src-tauri/crates/fs/src/path.rs` の `is_move_into_itself` | 在る `src` は symlink まで解いて比べるので、フォルダへの symlink を、その指す先のフォルダの中へ動かすと「自分の中への移動」として断る。動くのはリンクそのもので、`rename` は通る。`mv_directory` の `src.is_dir()` はリンクの先を見るので、ツリーから選べる。未再現。断るのが望ましいか（自分を指すリンクの輪ができる）を、ツリーが symlink をどう出すかと合わせて決める |
| `src-tauri/crates/settings/src/app.rs` の `back_up_file` | 退避先の番号は `.broken.99` まで進むと、それが在るかを見ずに使うので、`app.json.broken` から `.broken.99` まで100個在ると、`.broken.99` を上書きする。未再現（範囲1bでパスを受ける関数に割ったので、試験で作れる）。100回壊れることはまず無いので、直すか（在れば `Err` を返す）を `app.json` の退避を次に触るときに決める |
| `src-tauri/src/workspace/commands` と `kifu/commands.rs` の `write_kifu_to_file` の本体 | `AppHandle` を受けるので、crate の試験が届かない。範囲3では `guard.rs` の判定だけをパスで受ける関数へ割った。本体まで割ると、`tests/root_guard.rs` が `#[command]` の本体で読む検査の順が見えなくなる。ルートの走査が落とさなかった変異は2本: `rename_directory` の `is_project_root` の分岐を外す（ワークスペースそのものの改名が root の外として断られる）と、`create_kifu_file` の2本目の `validate_under_root` を外す（名前は `validate_basename` を通るので行き先は変わらない）。`tauri` の `test` の feature を dev-dependencies で有効にすれば `mock_app` で呼べるが、`Cargo.toml` は範囲3の外。mock の識別子は既定で空なので、`app_config_dir` が利用者のホームの下を指す。一時の名前を付けて呼ぶ |
| `docs/spec/screens/file-tree.md` の「読み取れないサブフォルダが黙って消える → #179」 | #179 は「仕様上こうなっているで良い」で閉じたが、仕様は「いま満たしていないこと」に載せたまま。`workspace/tree.rs` の `build_file_tree_recursive` は、読めない行と root の外へ出る symlink を黙って落とす。範囲3では、コメントを仕様の文に合わせた。仕様の行を「できること」へ移すか、#179 を開き直すかを決める |

## 次に取る範囲

TypeScript の表は範囲17で全部「済」になった。Rust の範囲1は段34で、範囲1bは段35で、範囲2は段36で、範囲3は段37で取った。次は Rust の範囲4。

範囲4: `src-tauri/src/ai_library`（808行。ファイル内のテストを含む。2026-11-04 に数えた）。
ファイル内の試験があるのは `commands.rs` だけ。所見の表の `ai_library/commands.rs` の
`create_ai_profile_dirs` の行は、読み手がこの範囲に居る。

範囲3では、`AppHandle` を受けるコマンドの本体に crate の試験が届かなかった（所見の表の
`workspace/commands` の行）。範囲4のコマンドも `AppHandle` を受けるなら、本体を割る前に
`tests/root_guard.rs` が `#[command]` の本体の何を読むかを確かめる。

段35から、`npm run verify:rust` と CI の `cargo test` と `cargo clippy` は `--workspace` で `crates/*` も走らせる。
crate の試験は `cargo test --manifest-path src-tauri/Cargo.toml -p <crate>` で個別にも走らせられる。

所見の表の `EngineState` の union は、範囲の表に載らない独立の段として残る。
取るなら `entities/engine` の型と reducer から呼び手までを1段にし、整理の段とは分ける。

`docs/IDEAS.md` の「feature の SCSS が shared の部品の内部クラスを掴んでいる」は、
外すのに `shared/ui/Form` の手が要るので、範囲15では閉じない。
