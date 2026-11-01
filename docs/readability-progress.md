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
2. `git rebase --onto origin/main <下の段の旧先端> <枝>`
3. `git push --force-with-lease`
4. `gh api -X PATCH repos/Rioh1118/obs-shogi/pulls/<番号> -f base=main`

ours 戦略のマージは使わない。

## 段の並び

下から順に積む。番号は PR。

| 段 | 枝 | 範囲 | PR | 状態 |
| -- | -- | ---- | -- | ---- |
| 1 | `refactor/readability-structure-standard` | 部品の構造と書き方の基準、`componentShape` | 未作成 | 作業中 |
| 2 | `refactor/tidy-shared-lib` | `src/shared/lib`、`src/shared/api` | 未作成 | 作業中 |

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
| 2  | `src/shared/ui`                                          | 2023 | 未着手 | 未着手 |
| 3  | `src/entities/kifu/lib`                                  | 1287 | 済     | —      |
| 4  | `src/entities/kifu` の残り                               | 1023 | 未着手 | 未着手 |
| 5  | `src/entities/position`                                  | 1894 | 未着手 | 未着手 |
| 6  | `src/entities/game`                                      | 2734 | 未着手 | 未着手 |
| 7  | `src/entities/engine`、`src/entities/engine-presets`     | 2542 | 未着手 | 未着手 |
| 8  | `src/entities/analysis`                                  | 2298 | 未着手 | 未着手 |
| 9  | `src/entities/game-session`                              | 1488 | 未着手 | 未着手 |
| 10 | `src/entities/file-tree`                                 | 2168 | 未着手 | 未着手 |
| 11 | `src/entities/search`、`src/entities/book`               | 2454 | 未着手 | 未着手 |
| 12 | `src/entities` の残り（app-config、dock、study-positions、updater） | 1664 | 未着手 | 未着手 |
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
| `src/features/settings/ui/tabs/WorkspaceTab.tsx` の `copyText` | `shared/api/clipboard` と同じ名前で別の本体を持つ。寄せられるかを本体で判定する |

## 公開の名前の候補

`shared` と `entities` の公開の名前は、呼び手を含めて独立した段にする。

| 名前 | 問い |
| ---- | ---- |
| `convertSfenSequence` | 何へ変換するかが読めない。返すのは日本語表記の手 |
| `NotificationContextType` | この形の context は無い。出す関数と出ている通知の組 |

## 次に取る範囲

`src/shared/ui`。
