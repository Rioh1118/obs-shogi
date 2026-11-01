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
| 6b | `src/entities/game` の `model`                           | 1574 | 未着手 | 未着手 |
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
| `src/entities/kifu/lib/applyMoveWithBranch.ts` の `usedExisting` と `createdNew` | 本番の読み手が0。テストだけが読んでいる |
| `src-tauri/src/kifu/commands.rs` の `convert_jkf_to_format` と `normalize_jkf` | TS の呼び手が0になった。線の名前なので消すかを `/decide` で決める |
| `src/entities/analysis/model/__tests__/provider.test.tsx` の「次の局面が保留されていても、届かなかった回に読み始めない」 | 2回に1回の頻度でゲートを止めた。`entities/analysis` の範囲で原因を調べる |
| `src/features/settings/ui/tabs/WorkspaceTab.tsx` の `copyText` | `shared/api/clipboard` と同じ名前で別の本体を持つ。寄せられるかを本体で判定する |
| `src/widgets/game-board/ui/PromotionDialog.tsx` の `promotionMap` | `positionDraft.ts` の `promotedKind` の写し。`src/widgets` の範囲で寄せると `PieceImage` の `kind` を `Kind` で受けられる |
| `src/entities/position/lib/positionDraft.ts` の `PROMOTED` | `shogi.js` の `Piece.promote` の写し。`promotionMap` の行と合わせて寄せる |
| `src/entities/kifu/lib/applyMoveWithBranch.ts` の `promotable` | `src/entities/game/lib/moveValidation.ts` の `canPromote` と同じ規則。`entities/kifu` は `entities/game` より下なので、寄せるなら `shared/lib/shogi` へ下げる |
| `src/features/game-ruling/lib/rulingAdapter.ts` の `toRuling` の doc | 主語が `judgeGameOutcome` だが、この関数が呼ぶのは `createOutcomeJudge`。`features/game-ruling` の範囲で直す |
| `src-tauri/src/storage/disk.rs` の読み手 | 2つの rename の間で値があるのに `NotFound` を受ける筋がある。未再現 |
| `src-tauri/src/storage/disk.rs` の load の doc | この save では起きない破損を理由に挙げている疑いがある。未確認 |
| `.claude/skills/tidy-code/scripts/emit-unchanged.mjs` | 基点に無い新規ファイルで落ちる |

## 次に取る範囲

`src/entities/game` の `model`。`lib` と合わせて2000行を超えるので割った。
