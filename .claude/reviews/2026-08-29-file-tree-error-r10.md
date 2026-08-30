# レビュー: #169 ファイル操作の失敗を出す — ラウンド10

- 日付: 2026-08-30
- ブランチ: `fix/169-file-tree-error`
- 範囲: `095e765..ada0725`（ラウンド9 の対応を**含む**。`A..B` は A 自身を含まないので、
  起点は1つ手前を書く）
- 観点: architecture / react / ui / robustness / rust / comment / oss-hygiene（7観点、並列）
- 前のラウンド: [r9](./2026-08-29-file-tree-error-r9.md)

## 対応の書き方

**表に「固定」列を持たせ、空欄を作らない。** ラウンド9 は「解決したと書く行は
テストを指す」と決めたが、適用できたのは BLOCK だけで HIGH と MEDIUM には
何も書かなかった。書かなかった行に、実際に3件の誤りがあった
（[r9 の訂正節](./2026-08-29-file-tree-error-r9.md)）。

結果、**BLOCK 5 / HIGH 9 / MEDIUM 13**。導入元の内訳は下の「訂正」を参照
（ここに書いていた「7件がラウンド9 の退行」は誤り）。

---

## BLOCK

| #   | 検出               | 内容                                                                  | 対応      | 固定                                               |
| --- | ------------------ | --------------------------------------------------------------------- | --------- | -------------------------------------------------- |
| B-1 | react / robustness | 起動エラーの画面が `/` と `/app` を無限に往復する（**私の退行**）     | `e8699a6` | `src/pages/__tests__/AppLoading.test.tsx`          |
| B-2 | robustness         | 設定が壊れていると、選び直す出口が同じ理由で落ちる                    | `7802fb7` | **未検証**（ピッカーの mock が要る。手で確かめた） |
| B-3 | comment            | `rust-types.ts` の doc の複写（`lastModified` に `truncated` の説明） | `ead9c23` | **未検証**（doc の文言は機械で見ていない）         |
| B-4 | comment            | `onUnshowable` の TSDoc が、消した「欄の外へ出た」判定のまま          | `ead9c23` | **未検証**（同上）                                 |
| B-5 | comment            | テスト名が「焦点を戻して」のまま。隣のテストと逆の仕様を主張          | `ead9c23` | **未検証**（同上）                                 |

### B-1: 行き止まりを塞いだつもりが、行き止まりより悪い状態を作った

`AppLoading` の `error` の枝に `FolderSelect` をそのまま置いたのが誤り。あちらは
`config.root_dir` があれば `/app` へ飛ぶページで、`RequireRootDir` は `error` を見て
`/` へ戻す。`configReducer` の `error` は `config` を残すので、この2つは同時に成り立つ。

react と robustness が独立に再現させた。React は「Maximum update depth exceeded」で
ツリーごと投げ、`AppRouter` の上に境界が無いので**真っ白なウィンドウ**になる。
`app.json` が書けないディスクでは `EnginePresetsProvider` が起動直後に
`setLastPresetId` を呼ぶので、利用者の操作なしに到達する。

選ばせるボタンだけを部品に切り出し、行き先はページごとに決める形にした。
往復は型でもレンダでも捕まらない（`Navigate` は effect で動く）ので、通った
pathname を数える回帰テストを置いた（`<FolderSelect />` に戻すと落ちることを確認）。

---

## HIGH

| #   | 検出                       | 内容                                                                               | 対応                      | 固定                                                     |
| --- | -------------------------- | ---------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------- |
| H-1 | architecture               | 衝突の対話が開いている間、`config_write_failed` を reducer が捨てる                | `420188b`                 | **未検証**（この経路を覆うテストが無い → #254 と一緒に） |
| H-2 | react / architecture / oss | `deleteNode` に同じ stale closure が残っていた（既存。`f5dbebf` 2026-03-07）       | `e9862dd`                 | `model/__tests__/staleClosure.test.tsx`                  |
| H-3 | rust                       | `engines` の拒否が大文字小文字を見ない。macOS 既定では素通り（**退行**）           | `bc4f255`                 | `the_engines_directory_is_not_a_profile_name`            |
| H-4 | robustness                 | 「すでにあります」が作りかけのやり直しを塞ぐ（**私の退行**）                       | `bc4f255`                 | `a_half_made_profile_can_be_completed`                   |
| H-5 | robustness / rust          | 名前の失敗が開発者向けの英文のまま画面に出る                                       | `bc4f255`                 | `a_rejected_name_is_explained_in_the_users_language`     |
| H-6 | robustness                 | AI フォルダ作成の失敗が「フォルダを確認できませんでした／再スキャン」              | `f50feb1`                 | **未検証**（`SetupGuide` にテストが1本も無い）           |
| H-7 | ui                         | `__content` の `align-items` が残り、縦中心が4通りに割れた（`571b6d3`＝ラウンド7） | `bfcdcb7`                 | **未検証**（実測は headless Chrome。回帰検査は未整備）   |
| H-8 | ui / react / robustness    | 打ち切りの行が押せる見た目・当たり判定を持つ（**私の退行**）                       | `bfcdcb7`                 | **未検証**（`cursor` は静的検査で見ていない）            |
| H-9 | comment / oss              | r9.md の「テストの上限を `<= 501` へ」がどのコミットにも無い                       | `331a19d` ＋ r9.md に訂正 | `a_web_of_symlinks_does_not_blow_up_the_node_count`      |

### H-9: 編集を当てるスクリプトが一度も走っていなかった

`git log -S"501" 0090fcc..HEAD -- src-tauri/` は0件。原因は、`python3 ... && git add && git commit`
と繋いだコマンドが検証ゲートに弾かれ、**python が走らないまま**次のコマンドで
`git add` だけをやり直したこと。同じスクリプトに入っていた `budget` の doc の
書き換えも未了だった。

**「スクリプトが `ok` と出した」ことを、記憶の側で確認済みと数えていた。**
以後、報告書に書く前に現物を `grep` する。

---

## MEDIUM（13件）

| 検出         | 内容                                                                        | 対応                                                                     |
| ------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| rust         | 予算が尽きたあとに `read_dir` + 全項目の整列を1回やる（**私の退行**）       | `331a19d`                                                                |
| rust         | `sort_by_key` のキー（`OsString`）が比較のたびに確保される                  | `331a19d`（`sort_by_cached_key`）                                        |
| rust         | 一覧に出さない項目しか残っていなくても `truncated` を立てる                 | `331a19d`                                                                |
| rust         | テストが `$TMPDIR` 直下を assert し、一度落ちると落ち続ける（**私の退行**） | `bc4f255`                                                                |
| architecture | `DROPPED` の `extension` が、その欄の検査を切っていた                       | `76844f2`                                                                |
| architecture | `failureHeading` の `if` に型検査が来ない（code ごとの分岐で4つ目）         | `76844f2`（`isOperationAlreadyCommitted`）                               |
| architecture | `FsError.message` に利用者向けの日本語が入る                                | `bc4f255`（Rust 側）。TS 側の `setRootDir` は #249                       |
| react        | `role="alert"` が中身と同時に DOM へ入るので VoiceOver が読まない           | `ead9c23`                                                                |
| ui           | ツールチップの面が生の16進 + 百分率の直書き                                 | `cd7a685`（`$surface-overlay`）                                          |
| comment      | 状態遷移表の「送信中の印」と、レビューのラウンド数                          | `ead9c23`                                                                |
| comment      | `file-tree.md` のボタンの表に「閉じる」が無い                               | `ead9c23`                                                                |
| oss          | 検査の一覧に `fileTreeWire` が無い                                          | `ada0725`                                                                |
| oss          | r8 の訂正の「Windows の CI」が未解決のまま解決扱い                          | r8.md に訂正 ＋ [#253](https://github.com/Rioh1118/obs-shogi/issues/253) |

## 反論（直さずに残したもの）

### 「本文に説明コメントが何段も要る関数は分ける」

comment-reviewer は `build_file_tree_recursive` / `InlineNameEditor.commit` /
`create_ai_profile_dirs` の3つを挙げた。**`commit` の1件だけ受け入れ、残り2つは
このラウンドではやらない。**

`commit` の「焦点は動かさない」はコードを1行も伴わないコメントで、指摘のとおり
関数頭の doc に属する。移した。

残り2つは、本文のコメントがどれも**分岐の理由**（なぜこの項目を飛ばすか、
なぜこの名前を弾くか）で、切り出すと理由が呼び出し側と実装に分かれる。
`build_file_tree_recursive` はこのラウンドだけで3回書き換わっている場所なので、
構造を動かすのは所見がゼロになってからにする。

### reducer の `case "error"` で code を見て振り分ける

architecture は「code を一切見ずに落とすのは広すぎる」とした。**落とす判断は
積む側に置く。** reducer で code を見ると、対話が「自分で出す」と決めた失敗まで
裏に重なる（既存のテスト「ダイアログの上に別の失敗を重ねない」が落ちる）。
対話で直せない失敗は先に `conflict_closed` を送ってから積む、という契約にした。
`not_found` の既存の扱いと同じ形。

## 訂正（ラウンド11 で判明）

**3件、事実でないことを書いていた。**

### 1. 「7件がラウンド9 で私が入れた退行」が現物と合わない

導入元を1件ずつ `git log -S` で当たると、ラウンド9 起因は**6件**。

| 行              | 導入コミット            | いつ          |
| --------------- | ----------------------- | ------------- |
| B-1             | `ddf714c`               | ラウンド9     |
| H-2             | `f5dbebf`（2026-03-07） | **既存**      |
| H-3 / H-4       | `7eb83a4`               | ラウンド9     |
| H-7             | `571b6d3`               | **ラウンド7** |
| H-8             | `095e765`               | ラウンド9     |
| MEDIUM read_dir | `6610086`               | ラウンド9     |
| MEDIUM $TMPDIR  | `7eb83a4`               | ラウンド9     |

**H-2 は「入れた」ではなく「片方だけ直して残した」。** `c3ac21c` が
`reconcilePathMutation` を直したときに、同じ形の `deleteNode` を残した。
誤った自己帰属は、後続に「ラウンド9 の変更を疑え」という誤った探索先を与える。

ラウンド11 からは、表の欄を「退行か否か」でなく**導入コミットの sha** にする。
sha を書くには `git log -S` を叩くことになるので、印だけを付ける形より強い。

### 2. 反論節の「移した」が、書いた時点では未了だった

`commit` の doc を移したのは `51ab042` で、この報告書（`f2a9929`）より後。
自分で `51ab042` のメッセージにそう書いたが、報告書側には残していなかった。
**受け入れた指摘は反論節でなく対応表に行を作る**（sha の欄があれば書けない）。

### 3. 検証の範囲が最後のコード変更を含んでいない

「`ada0725` から `cd7a685` まで」と書いたが、`51ab042` がそのあとにある。
正しくは `ada0725..51ab042`。

## 範囲の外へ送ったもの

| 内容                                                               | 送り先                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| エンジンが USI に応答しないと停止も再初期化もできない（3件）       | [#252](https://github.com/Rioh1118/obs-shogi/issues/252) |
| Windows 専用のテストコードが CI で一度もコンパイルされない         | [#253](https://github.com/Rioh1118/obs-shogi/issues/253) |
| 設定だけ書けなかったあと、ツリーが古いルート名を出し続ける         | [#254](https://github.com/Rioh1118/obs-shogi/issues/254) |
| 長い名前の扱いがファイル行とフォルダ行で違う（横溢れの実測を追記） | [#230](https://github.com/Rioh1118/obs-shogi/issues/230) |

## 検証

`ada0725` から `51ab042` まで、各コミットの時点で通している。

- `npm run verify` — 緑
- `npm run build` — 緑
- `npm run verify:rust` — 緑

件数は書かない（`CLAUDE.md`）。`npm run test` と `cargo test` の末尾で確認する。

変異を当てて落ちることを確認したもの:

- `AppLoading` の枝を `<FolderSelect />` に戻す → 往復の検査が落ちる
- `deleteNode` を `state.*` から読む形に戻す → `staleClosure` が落ちる
- `create_ai_profile_dirs` から `validate_basename` を外す → `root_guard` が落ちる

**レビュー中に作業ツリーが汚れていた。** 別のレビュアーが `src/__tests__/` に
scratch を置いたまま終わり、`no-restricted-imports` と `testsLayerBoundary` に
当たっていた（`zz_scratch_loop.test.tsx` / `tmpcheck/`）。消してある。
scratch は `src/` の下に作らない。
