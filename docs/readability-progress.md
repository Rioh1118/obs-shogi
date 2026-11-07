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
| 34 | `refactor/tidy-rust-fs-kifu-text` | `src-tauri/crates` の `fs`、`kifu-text`、`test-support`（Rust の範囲1）、`fs` のテストのコンパイル | #702 | マージ済み |
| 35 | `refactor/tidy-rust-settings` | `src-tauri/crates/settings`（Rust の範囲1b）、`crates/*` のテストを `verify:rust` と CI に載せる | #704 | マージ済み |
| 36 | `refactor/tidy-rust-storage` | `src-tauri/src/storage`（Rust の範囲2）、`.` の後ろだけが違う key の取り違え | #705 | マージ済み |
| 37 | `refactor/tidy-rust-kifu-workspace` | `src-tauri/src/kifu`、`src-tauri/src/workspace`（Rust の範囲3） | #706 | マージ済み |
| 38 | `refactor/tidy-rust-ai-library` | `src-tauri/src/ai_library`（Rust の範囲4） | #707 | マージ済み |
| 39 | `refactor/tidy-rust-engine-launchable` | `src-tauri/src/engine` の `launchable`、`types`、`utils`、`option_line`（Rust の範囲5） | #709 | マージ済み |
| 40 | `refactor/tidy-rust-engine-child-registry` | `src-tauri/src/engine` の `child`、`registry`（Rust の範囲5b）、「試験」を「テスト」に揃える | #710 | マージ済み |
| 41 | `refactor/engine-crate-visibility` | `src-tauri/src/lib.rs` の `pub mod engine` と呼び手の無い `pub`（Rust の範囲「公開」）、5c を設計の段にする | #712 | マージ済み |
| 42 | `docs/engine-usi-design` | USI のやりとりの作り直しの設計（Rust の範囲5c）。ADR-0016、`engine.md` と `analysis.md` の目標の形 | #713 | マージ済み |
| 43 | `test/usi-u0-baseline` | 作り直しの段 U0。載せ替えの前に要るテスト T1〜T10 と性能の基準線 M1〜M3。製品のコードは変えない | #714 | マージ済み |
| 44 | `refactor/usi-u1-procedures` | 作り直しの段 U1。手順の関数と `Search` を、いまの `UsiProtocol` の上に置く。`registry` と `setup` を手順へ移し、B-10 と D-1 の置き場を入れる | #715 | マージ済み |
| 45 | `refactor/readability-range6` | `src-tauri/src/engine` の `option_labels`、`binding`、`setup`、`start_failure`（Rust の範囲6）。C-4、R-10、範囲内の W-1 を閉じ、`setup` の関数名を手順の語に揃える | #716 | マージ済み |
| 46 | `refactor/usi-u2a-analyzer` | 作り直しの段 U2a。`analyzer` を手順「探索」と `Search` へ移し、検討の側から受け手の登録をなくす。D-1 の検討の写しを消す | #717 | マージ済み |
| 47 | `refactor/readability-8a-analyzer` | `src-tauri/src/engine/analyzer.rs`（Rust の範囲8a）。起動の手順を段 `analysis_start` へ割り、`begin_start` と `shutdown` を `take_over` に畳み、起動した要求の番号を `analyzer` へ移す。D-2、R-7、R-8、B-13、範囲内の W-1 を閉じる | #718 | マージ済み |
| 48 | `refactor/readability-7a-session` | `src-tauri/src/engine/game/session.rs`（Rust の範囲7a）。番人を `stall`、起動の段取りと締切を `start`、入口の書式を `input` へ割る。割るだけで中身は動かさない。R-2 を閉じ、R-5、R-6、W-3 を 7b へ送る | — | レビュー待ち |

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

`src-tauri/tests/layering.rs` の `LAYERS` の下の段から取る。行数は範囲5bまではファイル内のテストを含み、
6 から 8b はテストを除く（切り方は `docs/audits/2026-11-engine.md` の「残りの範囲の切り方」）。

**5c は整理ではなく設計の段にした**（利用者の決定）。`protocol.rs` をいまの形のまま磨くと、作り直しで書き直す行を磨くことになる。
設計は ADR-0016（`docs/decisions/0016-usi-machine-shell-procedures.md`）。作り直しの段 U0〜U4 を、整理の範囲 6〜8b と交互に並べた
（触るファイルが重ならない順。理由は ADR-0016 決定10）。**下の表の順に取る。** U の段は整理ではなく作り直しで、行数の上限（2000行）は
整理の範囲にだけ掛ける。`protocol.rs` の整理の範囲は無い——作り直しで書き直す行は、書くときに `/readable-code` に揃える。

| 順 | 範囲                                                   | 行数  | 状態     |
| -- | ------------------------------------------------------ | ----- | -------- |
| 1  | `src-tauri/crates` の `fs`、`kifu-text`、`test-support`   | 773   | 済       |
| 1b | `src-tauri/crates/settings`                            | 1405  | 済       |
| 2  | `src-tauri/src/storage`                                | 552   | 済       |
| 3  | `src-tauri/src/kifu`、`src-tauri/src/workspace`        | 1895  | 済       |
| 4  | `src-tauri/src/ai_library`                             | 808   | 済       |
| 5  | `src-tauri/src/engine` の `launchable`、`types`、`utils`、`option_line` | 1787 | 済 |
| 5b | `src-tauri/src/engine` の `child`、`registry` | 1590 | 済 |
| 公開 | `src-tauri/src/lib.rs` の `pub mod engine` を `pub(crate)` にし、呼び手の無い `pub` を消す | 小 | 済 |
| 5c | USI のやりとりの作り直しの設計（ADR-0016） | — | 済 |
| U0 | 載せ替えの前に要るテスト（`docs/state-transitions/engine.md` の T1〜T10）と性能の基準線（ADR-0016 の M1〜M3）。製品のコードは変えない | — | 済 |
| U1 | 手順の関数と `Search` を、いまの `UsiProtocol` の上に置く。`registry`、`setup`、`probe` を手順へ移す | — | 済 |
| 6  | `src-tauri/src/engine` の `option_labels`、`binding`、`setup`、`start_failure` | 732 | 済 |
| U2a | `analyzer` を手順へ移す | — | 済 |
| 8a | `src-tauri/src/engine/analyzer.rs` | 828 | 済 |
| 7a | `src-tauri/src/engine/game/session.rs` を4つのファイルに割る。割るだけ | 2208 | 済 |
| U2b | `game` を手順へ移す | — | 未着手 |
| U3 | 状態機械を新しい段 `usi_machine` に作る。受け手の表と積み置きを消す | — | 未着手 |
| U4 | 殻（タスク1本）。送る面と落とす面を分ける | — | 未着手 |
| 7b | `src-tauri/src/engine/game` の残りと `engine/commands/game.rs` | U2b の後に数える | 未着手 |
| 8b | `src-tauri/src/engine` の `bridge`、`analysis_events`、`probe`、`state`、`commands`（`game.rs` を除く） | U4 の後に数える | 未着手 |
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
| `src-tauri/src/storage/disk.rs` の `load` | 本体が `NotFound` の後に `bak.exists()` を見るので、その間に置き直しが2つ目の rename と退避の削除を終えると、本体に値が在るのに `NotFound` を返す筋がある。範囲2で、置き直しを5000回続ける間に読み続けるテストを3回走らせ、1回も起きなかった（未再現）。起きても索引の復元が全件の構築へ落ちるだけ。直すなら、退避が読めなければ本体を読み直す。下の Windows の行で退避をやめるなら筋ごと消える |
| `src-tauri/src/storage/disk.rs` の `paths` の doc | 退避を挟む理由を「Windows で上書きの rename が失敗するため」と書くが、`std::fs::rename` は Windows でも `MOVEFILE_REPLACE_EXISTING` で上書きする。失敗するのは、他のプロセスが削除の共有を許さずに開いているときに限られる。Windows で確かめてから、退避をやめるかを決める |
| `src-tauri/src/storage/mod.rs` の `BlobStore::delete` | 本番の呼び手が0で、テストだけが呼ぶ。`search/cache/format.rs` の `CACHE_VERSION` の doc は、読めない旧版の blob がディスクに残り続けると書く。復元が版の違いで落ちたときに捨てるかを、索引のキャッシュを次に触るときに決める。捨てないなら trait から外す |
| `src/entities/game/model/provider.tsx` の `getCurrentMoveIndex` | `state.cursor?.tesuu ?? 0` を返すだけの包み。`getCurrentTurn` は範囲16の第3段で、`getTotalMoves` は第4段で読み手が0になったので消した。残る読み手は `src/features` の `StudyPositionSaveModal` だけで、`src/features` の範囲は済んでいる。`features/study-position-save` を次に触るときに `state.cursor` を読む形へ寄せ、包みを消す |
| `src-tauri/src/engine/commands/analysis.rs` の `get_analysis_result`、`get_last_result`、`get_analysis_status` | TS の呼び手が0になった。線の名前なので消すかを `/decide` で決める。範囲5で、`get_analysis_status` が返す `AnalysisStatus` の `elapsed_time` と `config` は組む経路が無く常に `None` で、`AnalysisConfig` はどこでも組まれないと確かめた（`engine/types.rs` の doc に書いた）。コマンドを消すなら2つの型も消える |
| `src-tauri/src/engine/launchable.rs` の分類を起動の失敗で使う範囲 | 起動の失敗の分類（`start_failure::describe`）は `inspect` の答えのうち `Quarantined` だけを見る。実行権限が無い、別の OS 向け、読めないファイルは `SpawnFailed` になり、画面は候補の一覧と違う言葉で説明する。範囲5まではファイルの冒頭に `TODO(#523)` があったが、#523（帯を閉じると起動に失敗した理由が残らない）は閉じていて、この作業を含んでいなかった。TODO を外してこの行へ移した。`StartFailureKind` に種類を足すと線の値と画面の文言が増えるので、整理の段では入れない |
| `src-tauri/src/engine/utils.rs` の役割 | 隠す判断を1つに言えない（R-RES-6）。名前も R-DUP-5 が概念の無い印とする `util` に当たる。2つの役割を持つ。`info` 行を読み筋へ畳む関数（`apply_info_params` ほか）と、ログに載せる文字列の部品（`shown`、`with_cause`、`LogThrottle`、`cmd_summary`、上限の定数）。`tests/layering.rs` の段の名前が `utils` なので、割ると `LAYERS` と段の検査の期待値（`["types", "utils"]`）を書き直す。範囲5では、触ってよい範囲の外なので割らなかった。割るなら、範囲6以降の段を取る前に独立した段にする |
| `src-tauri/src/engine/types.rs` の `EngineOption` の `current_value` | 組むのは `option_line::parse_option_line` だけで、常に `None`。TS（`entities/engine/api/rust-types.ts`）も型に持つだけで読まない。線の欄なので、消すかを `EngineInfo` の線の形と合わせて決める |
| `src/entities/engine/model/types.ts` の `EngineState` | `phase` ごとの欄を判別できる union にすれば、`engineFailureNoticeOf` の `?? "noAnswer"` と `?? "unknown"` が消える。範囲17でも送った。union にすると `entities/engine` の reducer（状態機械）と provider の `isReady`、`notReadyReasonOf` の入力が変わり、`entities` の公開の型が変わる。進め方の「`entities` の公開の名前を変えるなら、呼び手を含めて独立した段にする」に当たるので、整理の段に混ぜない。`src/app` で状態を読むのは `EngineFailureBridge`（`phase`、`error`、`unresponsiveReason`）と `EngineStartWarningBridge`（`phase`、`startWarnings`）の2つ。ほかの読み手は `features/engine-position-sync`、`entities/analysis` の provider、`src/widgets` の `AnalysisControls` と `useEngineStatus`。`engineFailureNoticeOf` は `exited`、`unresponsive`、`error`、未設定の順に見るので、union にしても判定の順は変わらない |
| `src/__tests__/crossSliceImports.ts` の `scanCrossSliceImports` | 層の直下のディレクトリを全部スライスとして歩くので、`src/pages/__tests__` が `pages/__tests__` というスライスに数えられる。doc は「`__tests__` は外す」と書くが、外れるのはスライスの中の `__tests__` だけ。範囲17では、テストの `satisfies typeof import` を相対パスで書いて避けた。層の直下の `__tests__` を歩かないように直すかを決める |
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
| `src/features/engine-position-sync/model/useEnginePositionSync.ts` の `pendingBeforeReadyRef` | `isReady` が `syncPosition` の依存にあるので、ready になると自動同期の effect が送り直す。保留を書かない変異を当てても `src/features src/pages src/widgets src/app` のテストは落ちない。保留の ref と送り直しの effect を消すかを、部品の構造の段で決める |
| `src/entities/game/lib/gameOutcome.ts` の `stalemate` の doc | 詰みと分ける理由を「棋譜に落とす綴りが違うため」と書くが、説明の綴りを決める `rulingAdapter.ts` の `detail` は Rust の終局の結果に載るだけで、棋譜にも画面にも読み手が無い |
| `src/__tests__/viMockShape.test.ts` の冒頭の doc | `satisfies` で export の増減と改名を tsc が落とすと書くが、`importActual` を展開する形では増えても落ちない。`entities/game` に export を足して `gameMoveBridge.test.tsx` の tsc が通ることを確かめた。差し替えの形ごとに何が落ちるかを書き分ける |
| `src/entities/game/model/provider.tsx` の `edit` の `forceCommit` | `makeMove` は必ず局面を動かすので、`forceCommit` と局面の不動の判定は結果を変えない。読み手が増えるなら残す判定で、消すかを `entities/kifu` の `applyMoveWithBranch` の契約と合わせて決める |
| `src/widgets/kifu-stream/ui/KifuForkMenu.tsx` の `normalizeSelected` と、`KifuStreamList.tsx` の分岐メニューの外側押下の `menuEl` の判定 | どちらも外すと結果が変わらない。行の選択は `buildStreamRowsFromCursor` が実際に降りた添字しか返さず、メニューの中の押下は `KifuForkMenu` の `stopPropagation` で document まで届かない。分岐メニューの閉じ方を直す #278 と合わせて、消すかを決める |
| `src/widgets/game-board/ui/useHandLayout.ts` の段の割り振り | 片側の持ち駒が21〜23枚と29枚以上のとき、1段の幅が駒台の 20em を超える（22枚で最後の段に10枚、29.3em。38枚で26枚）。仮に並べるときの上限 `10` で偏りの判定が1段4枚の配置に落ち、余りを最後の段に寄せるため。`useHandLayout` を単体で呼んで再現した。直すと並べ方が変わるので、何枚まで4段で収めるかと合わせて決める |
| `src/widgets/game-board/ui/Board.tsx` の成りの選択肢の取り消し | 待っている間に局面が動いたかを `player.tesuu` だけで見るので、同じ手数の別の変化へ移ると選択肢が残る。選ぶと、押した時点の `selectSquare` の閉包で前の局面の手として指す筋がある。未再現 |
| `src-tauri/src/ai_library/commands.rs` の `create_ai_profile_dirs` の `ai_root` の検査 | AI ルートが無いときも `invalid_path` で返す。範囲4で、`FsErrorCode` の doc が書く形（tier が `danger` になり「再読み込み」が消える）はここでは起きないと確かめた。AI ライブラリのタブは tier を読まず、`useAiLibrary` の `createAiFolder` が `describeFsError` の一文を `failKeepingIndex` で読み取りの失敗として積み、`SetupHero` が「フォルダを確認できませんでした」と「もう一度読み込む」を出す。違いは一文だけで、`not_found` なら「見つかりません。ほかで移動または削除された可能性があります」になる。分けると `crates/fs` の `InvalidPath` の doc（「AI ルートが空か、無いか、フォルダでない」）も直すことになり、範囲4の外へ出る。同じタブの `scan_ai_root` と `ensure_engines_dir` は失敗を英文の `String` で返し、画面にそのまま出る。AI ライブラリのコマンドの失敗を `FsError` へ揃えるときに、無いときの code を合わせて決める |
| `src-tauri/crates/fs/src/path.rs` の `is_move_into_itself` | 在る `src` は symlink まで解いて比べるので、フォルダへの symlink を、その指す先のフォルダの中へ動かすと「自分の中への移動」として断る。動くのはリンクそのもので、`rename` は通る。`mv_directory` の `src.is_dir()` はリンクの先を見るので、ツリーから選べる。未再現。断るのが望ましいか（自分を指すリンクの輪ができる）を、ツリーが symlink をどう出すかと合わせて決める |
| `src-tauri/crates/settings/src/app.rs` の `back_up_file` | 退避先の番号は `.broken.99` まで進むと、それが在るかを見ずに使うので、`app.json.broken` から `.broken.99` まで100個在ると、`.broken.99` を上書きする。未再現（範囲1bでパスを受ける関数に割ったので、テストで作れる）。100回壊れることはまず無いので、直すか（在れば `Err` を返す）を `app.json` の退避を次に触るときに決める |
| `src-tauri/src/workspace/commands` と `kifu/commands.rs` の `write_kifu_to_file` の本体 | `AppHandle` を受けるので、crate のテストが届かない。範囲3では `guard.rs` の判定だけをパスで受ける関数へ割った。本体まで割ると、`tests/root_guard.rs` が `#[command]` の本体で読む検査の順が見えなくなる。ルートの走査が落とさなかった変異は2本: `rename_directory` の `is_project_root` の分岐を外す（ワークスペースそのものの改名が root の外として断られる）と、`create_kifu_file` の2本目の `validate_under_root` を外す（名前は `validate_basename` を通るので行き先は変わらない）。`tauri` の `test` の feature を dev-dependencies で有効にすれば `mock_app` で呼べるが、`Cargo.toml` は範囲3の外。mock の識別子は既定で空なので、`app_config_dir` が利用者のホームの下を指す。一時の名前を付けて呼ぶ |
| `docs/spec/screens/file-tree.md` の「読み取れないサブフォルダが黙って消える → #179」 | #179 は「仕様上こうなっているで良い」で閉じたが、仕様は「いま満たしていないこと」に載せたまま。`workspace/tree.rs` の `build_file_tree_recursive` は、読めない行と root の外へ出る symlink を黙って落とす。範囲3では、コメントを仕様の文に合わせた。仕様の行を「できること」へ移すか、#179 を開き直すかを決める |
| `src-tauri/src/engine/registry.rs` の `spawn_cancellable` を待つ future を捨てたとき | `usiok` を待つ間に future を捨てると、プロセスは起動中の置き場（`starting`）に残り、`shutdown_all` まで落ちない。範囲5bで使い捨てのテストを書いて確かめ、doc に書いた。取り消しは `cancel` で行う契約にしてある。呼び手は `analyzer` と `probe`（`spawn_cancellable`）と対局の `session.rs`（`spawn`）の3つで、どれかが future を捨てる経路を持つかは確かめていない。持つなら、置き場から外す Drop の見張りを足すかを決める。未再現 |
| `src-tauri/src/engine/registry.rs` の `EngineProcess::protocol` が返す `Arc<UsiProtocol>` | 台帳と呼び手が同じ1本を共有する（R-RSM-7 の境界の漏れの grep に当たる）。台帳は落とすために、呼び手は送るために持つ。範囲5cで、U4 で送る面と落とす面の2つの型に分けると決めた（ADR-0016 決定6） |
| `src-tauri/src/engine/registry.rs` の `EngineRegistry` の `Debug` | 欄の `UsiProtocol` が `Debug` を持たないので付けられない（R-RSA-3）。U4 で取っ手がチャネルの送り手を包むだけになり、`Debug` を持てる。そこで付ける（ADR-0016 決定6） |

## 次に取る範囲

TypeScript の表は範囲17で全部「済」になった。Rust の範囲1は段34で、範囲1bは段35で、範囲2は段36で、範囲3は段37で、範囲4は段38で、範囲5は段39で、範囲5bは段40で、範囲「公開」は段41で、範囲5c（設計の段）は段42で、U0 は段43で、U1 は段44で、範囲6は段45で、U2a は段46で、範囲8aは段47で、範囲7aは段48で取った。次は U2b。

範囲「公開」から、`engine` は crate の外へ出ない。外へ出すのは `tests/engine_timeouts.rs` が読む上限の定数だけで、
`lib.rs` が再輸出する。`engine` の中で呼び手の無い `pub` は rustc の `dead_code` が拾うので、以後の範囲では grep で数えなくてよい。
**例外は `engine/protocol/search.rs`** の `Search::ponderhit` と `SearchLine::BestMove` の手の欄で、本番で使うのは対局だけなので `dead_code` を許してある。U2b で対局が移ったら外す。

範囲7a: `game/session.rs` を4つのファイルに割る（本体 2208 行）。割るだけで、整理は 7b に回す。
監査の行き先が 7a の所見は R-2、R-5、R-6、W-3（`docs/audits/2026-11-engine.md`）。

- 割る先は番人（`stalled_turn`、`Stall`、`SEARCH_GRACE`）、起動（`START_TIMEOUT`、`remaining`、`prepare_engine`）、
  書式（`validate_settings`、`validate_usi_move`）、状態機械（`Runner`、`finish`）の4つ（R-2）
- `game/` の中は `tests/layering.rs` が段を割らない（`module_of` は `game/` の下を全部 `game` と読む）。
  割った後の各ファイルが冒頭で何を隠すかを言えることは `every_engine_file_says_what_it_hides` が見る
- `tests/engine_timeouts.rs` が `session.rs` の上限の定数を読む。定数を動かしたら、読む側の綴りも同じコミットで直す

範囲8a で `analyzer` は、どのプロセスが検討のものか（`Startup` の世代、`latest_request`、`started_by`）と、
その上の探索（`run_infinite_search`、`collect_until_bestmove`、`stop_search`、`unanswered`）を持つ形になった。
起こして設定を送る手順は段 `analysis_start` にある。`bridge` が組む断りの文と
`superseded_request` の重複（D-3）は 8b で取る。

U2b で対局を `Search` へ移すとき、`StopAnswer::Unreachable(EngineError::Timeout)`（`stop` の書き込みが上限を超えた）の
行き先を決める。いまの対局は `StopTimedOut`（止めに答えない）と読み、検討は失敗と読む。写像を純関数にして、この1通りをテストで固定する。

7a の後は上の表の順に U2b、U3 と進む。各段の範囲と固定のしかたは ADR-0016 の決定8。

`tests/layering.rs` は `engine` の段の上下を
ファイルの `use` で読むので、ファイルを割るか動かすなら、先に `LAYERS` のどの段に入るかを決める。
所見の表の `utils.rs` の役割の行は、割るなら独立した段にする。

段35から、`npm run verify:rust` と CI の `cargo test` と `cargo clippy` は `--workspace` で `crates/*` も走らせる。
crate のテストは `cargo test --manifest-path src-tauri/Cargo.toml -p <crate>` で個別にも走らせられる。

所見の表の `EngineState` の union は、範囲の表に載らない独立の段として残る。
取るなら `entities/engine` の型と reducer から呼び手までを1段にし、整理の段とは分ける。

`docs/IDEAS.md` の「feature の SCSS が shared の部品の内部クラスを掴んでいる」は、
外すのに `shared/ui/Form` の手が要るので、範囲15では閉じない。
