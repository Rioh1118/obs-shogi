# 読みやすさの整理の進捗

既存コードを `/readable-code` の基準へ揃える作業の順序と到達点。手順は `/tidy-code`、語は `CONTEXT.md` が正本。

## 到達点

- `src/__tests__/commentReadability.test.ts` の `BASELINE` が下がり続ける
- `CONTEXT.md` の「揺れが残っているもの」が空になる
- 下の表の全ての範囲が「済」になる

## 進め方

- 1セッション1PR。PR を積まず、次の PR は前の PR のマージ後に `origin/main` から切る
- 範囲は依存の下から取る。1回の範囲はテストを除いて2000行以内
- 線の名前（Tauri コマンド、serde の欄、イベント名、保存形式）は変えない

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

行数はテストを除く。

| 順 | 範囲                                                     | 行数 | 状態   |
| -- | -------------------------------------------------------- | ---- | ------ |
| 1  | `src/shared/lib`、`src/shared/api`                       | 1102 | 未着手 |
| 2  | `src/shared/ui`                                          | 2023 | 未着手 |
| 3  | `src/entities/kifu/lib`                                  | 1287 | 済     |
| 4  | `src/entities/kifu` の残り                               | 1023 | 未着手 |
| 5  | `src/entities/position`                                  | 1894 | 未着手 |
| 6  | `src/entities/game`                                      | 2734 | 未着手 |
| 7  | `src/entities/engine`、`src/entities/engine-presets`     | 2542 | 未着手 |
| 8  | `src/entities/analysis`                                  | 2298 | 未着手 |
| 9  | `src/entities/game-session`                              | 1488 | 未着手 |
| 10 | `src/entities/file-tree`                                 | 2168 | 未着手 |
| 11 | `src/entities/search`、`src/entities/book`               | 2454 | 未着手 |
| 12 | `src/entities` の残り（app-config、dock、study-positions、updater） | 1664 | 未着手 |
| 13 | `src/features/settings`                                  | 4778 | 未着手 |
| 14 | `src/features/position-search`、`src/features/position-editor` | 3186 | 未着手 |
| 15 | `src/features` の残り                                    | 4409 | 未着手 |
| 16 | `src/widgets`                                            | 5661 | 未着手 |
| 17 | `src/pages`、`src/app`                                   | 1682 | 未着手 |

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

## 次に取る範囲

`src/shared/lib` と `src/shared/api`。
