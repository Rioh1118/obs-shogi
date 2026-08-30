# レビュー: #169 ファイル操作の失敗を出す — ラウンド11

- 日付: 2026-08-30
- ブランチ: `fix/169-file-tree-error`
- 範囲: `cd7a685~1..51ab042`（実際に叩いたのは `git log --no-merges ada0725..HEAD --stat`）
- 観点: architecture / react / ui / robustness / rust / comment / oss-hygiene（7観点、並列）
- 前のラウンド: [r10](./2026-08-29-file-tree-error-r10.md)

## 対応の書き方

**表の欄を「退行か否か」でなく「導入コミット」にする。** ラウンド10 は印だけを
付けたので、既存の欠陥（2026-03-07）を「私の退行」と書き、件数も現物と合わなかった
（[r10 の訂正節](./2026-08-29-file-tree-error-r10.md)）。sha を書くには
`git log -S` を叩くことになるので、印より強い。

**受け入れた指摘は反論節に書かない。対応表に行を作る。** ラウンド10 は反論節に
「移した」と書いて sha を持たせず、実際には未了のまま報告書を出した。

結果、**BLOCK 5 / HIGH 10 / MEDIUM 15**。

---

## BLOCK

| #   | 検出                      | 内容                                                                | 導入      | 対応                                                     | 固定                                           |
| --- | ------------------------- | ------------------------------------------------------------------- | --------- | -------------------------------------------------------- | ---------------------------------------------- |
| B-1 | robustness / architecture | `loadConfig` の失敗を空に潰したので `saveConfig` が設定を書き潰す   | `7802fb7` | `d6b3272`                                                | `app-config/api/__tests__/directories.test.ts` |
| B-2 | oss                       | Release が Windows / Linux で必ず落ちる                             | `0f14733` | [#256](https://github.com/Rioh1118/obs-shogi/issues/256) | —（範囲外）                                    |
| B-3 | comment                   | `create_ai_profile_dirs` の「だから」が同じコミットで変えた行を指す | `bc4f255` | `3e0d7f5`                                                | **未検証**（doc の文言は機械で見ていない）     |
| B-4 | comment                   | `commit` の doc「閉じるのは欄が無くなったときだけ」が本文と食い違う | `51ab042` | `1a22401`                                                | **未検証**（同上）                             |
| B-5 | comment                   | reducer の `case "error"` の前提が実在の経路と逆                    | 既存      | `1a22401`                                                | **未検証**（同上）                             |

### B-1: 行き止まりを塞ぐのに、他の設定を捨てる経路を作っていた

ラウンド10 は `loadConfig()` の失敗を「空の設定」に潰して出口を通したが、
`save_config` はファイルごと置き換える。この catch に入るのは `app.json` が
**壊れているときだけ**（無ければ `AppConfig::default()` が `Ok` で返る）。
つまり唯一の到達経路で、読めていない `ai_root` と `last_preset_id` を `null` で
書き潰していた。

AI フォルダを選び直しただけで `root_dir` が消え、**次の起動でワークスペースが
無くなる**。利用者から見て2つの操作は結び付かない。

壊れた JSON でも中の文字列は利用者が選んだ場所そのものなので、`app.json.broken` へ
退避してから書く。退避したことを画面に出すのは [#255](https://github.com/Rioh1118/obs-shogi/issues/255)。

---

## HIGH

| #    | 検出               | 内容                                                          | 導入      | 対応                  | 固定                                               |
| ---- | ------------------ | ------------------------------------------------------------- | --------- | --------------------- | -------------------------------------------------- |
| H-1  | rust               | `eval` だけのプロファイルへ黙って合流する                     | `bc4f255` | `3e0d7f5`             | `an_eval_only_profile_is_not_merged_into`          |
| H-2  | rust               | `create_dir_all` の失敗が OS の英文のまま名前欄に出る         | `7eb83a4` | `3e0d7f5` / `b28d995` | `a_blocking_file_is_named_as_such`                 |
| H-3  | rust               | `validate_basename` が Windows の `C:x` を通す                | 既存      | `3e0d7f5`             | `rejects_names_that_are_not_a_single_segment`      |
| H-4  | robustness / react | ピッカーを閉じただけで「初期化に失敗しました」に差し替わる    | 既存      | `36b2a81`             | `選び直しを取り消しても、元の失敗の理由を消さない` |
| H-5  | robustness         | AI フォルダの選択が provider を通らず、失敗が誰にも掴まれない | 既存      | `6049a97`             | **未検証**（`AiLibraryTab` にテストが無い）        |
| H-6  | robustness / react | 名前と無関係な失敗まで名前の欄の下に英語で出る                | `f50feb1` | `b28d995`             | `a_rejected_name_carries_a_code`                   |
| H-7  | architecture       | テストが `@/app` を動的 import してレイヤ規則をすり抜ける     | `e8699a6` | `03e767c`             | `動的 import と vi.mock も下向きだけ`              |
| H-8  | comment            | 経緯を書いたコメントが4箇所                                   | 各所      | `03e767c` / `1a22401` | **未検証**（`commentHistory` の語彙外）            |
| H-9  | oss                | r10.md の H-2 を「私の退行」と書いたが既存（2026-03-07）      | `f2a9929` | r10.md に訂正         | —                                                  |
| H-10 | oss                | r10.md の「7件」がどの数え方とも合わない                      | `f2a9929` | r10.md に訂正         | —                                                  |

### H-9 / H-10: 誤った自己帰属

`git log -S"isSameOrDescendantPath(state.activeKifuPath"` の結果は
`f5dbebf`（2026-03-07）。`deleteNode` の stale closure は**既存の欠陥**で、
ラウンド9 の `c3ac21c` が同じ形の片方だけ直して残したもの。「入れた」ではない。

`align-items: flex-start`（H-7）も `571b6d3` ＝ **ラウンド7** の対応。

ラウンド9 起因は6件で、7件でも8件でもなかった。**進め方の指標に使う数を、
現物を見ずに書いていた。**

---

## MEDIUM（15件）

| 検出         | 内容                                                            | 対応                                                     |
| ------------ | --------------------------------------------------------------- | -------------------------------------------------------- |
| rust         | 隠した行が無いフォルダに打ち切りの印が付く                      | `b4bc480`（`an_empty_folder_at_the_budget_edge_...`）    |
| rust         | `read_profiles` の除外が綴りを無視し、正当なプロファイルを消す  | `3e0d7f5`                                                |
| rust         | `describe` の `_ =>` が `Debug` 出力を画面に出す                | `b28d995`（関数ごと削除）                                |
| react        | `SetupGuide` の作成に再入の防ぎ手が無い                         | `b28d995`（`inFlightRef`）                               |
| react / ui   | `SInput` に `aria-invalid` を直接渡し `data-invalid` が立たない | `b28d995`（`invalid` prop へ）                           |
| comment      | `MAX_DEPTH` を見る唯一の条件が性能の話しか説明していない        | `b4bc480`                                                |
| comment      | 利用者向けの文言が Rust と TS に二重化                          | `b28d995`（Rust 側を削除）                               |
| architecture | `FsErrorCode` の性質が5つの述語に散り、1つは型検査が来ない      | [#257](https://github.com/Rioh1118/obs-shogi/issues/257) |
| rust         | `list_file_candidates` の上限が絞り込みの前に掛かる             | [#259](https://github.com/Rioh1118/obs-shogi/issues/259) |
| oss          | Tauri のシステム前提が README / CONTRIBUTING に無い             | [#258](https://github.com/Rioh1118/obs-shogi/issues/258) |
| react        | `FolderSelect` の redirect `useEffect` は到達しない             | **未対応** → PR 本文へ                                   |
| react / ui   | `AppLoading` の `role="alert"` が常設でない／失敗の見た目が無い | **未対応** → PR 本文へ                                   |
| ui           | `__actions` の `align-self` がフォルダ行を 1px ずらす           | **未対応** → PR 本文へ                                   |
| ui           | `.setupGuide__createError` が他2件と形が違う／`pointer-events`  | **未対応** → PR 本文へ                                   |
| comment      | `→ #N` と `TODO(#N)` の表記揺れ／`staleClosure` の被覆の穴      | **未対応** → PR 本文へ                                   |

**未対応の5行は、利用者に見える失敗を1つも作らない**（見た目のずれ、到達しない
コード、表記の揺れ、テストの被覆）。PR 本文に「次に見るもの」として並べる。

## 範囲の外へ送ったもの

| 内容                                        | 送り先                                                   |
| ------------------------------------------- | -------------------------------------------------------- |
| 設定を退避したことが利用者に伝わらない      | [#255](https://github.com/Rioh1118/obs-shogi/issues/255) |
| Release が Windows / Linux で必ず落ちる     | [#256](https://github.com/Rioh1118/obs-shogi/issues/256) |
| `FsErrorCode` の性質が5つの述語に散っている | [#257](https://github.com/Rioh1118/obs-shogi/issues/257) |
| Tauri のシステム前提が文書に無い            | [#258](https://github.com/Rioh1118/obs-shogi/issues/258) |
| `list_file_candidates` の上限の掛け方       | [#259](https://github.com/Rioh1118/obs-shogi/issues/259) |

## 検証

`3e0d7f5` から `1a22401` まで、各コミットの時点で通している。

- `npm run verify` — 緑
- `npm run build` — 緑
- `npm run verify:rust` — 緑

変異を当てて落ちることを確認したもの:

- `saveOver` から退避を外す → `directories.test.ts` が落ちる
- 取り消しでも `loading` を立てる → `provider.test.tsx` が落ちる
- `entities` のテストで `@/app` を動的 import する → `testsLayerBoundary` が落ちる
- `budget == 0` を降りる前の条件へ戻す → `an_empty_folder_at_the_budget_edge_...` が落ちる
