# レビュー: #169 ファイル操作の失敗を出す — ラウンド6

- 日付: 2026-08-30
- ブランチ: `fix/169-file-tree-error`
- 範囲: ラウンド5 の対応（`10930c1..4c090e4`）以降に動いた全て
- 観点: architecture / react / ui / robustness / rust / comment / oss-hygiene（7観点、並列）
- 前のラウンド: [r5](./2026-08-29-file-tree-error-r5.md)

## このラウンドの狙い

ラウンド5 でも、私の修正が新しい退行を5件生んでいた。7つの reviewer 全部に
「**今回もそれを疑って見てほしい**」と明示し、`Escape` の段の移動・`useOverlayLayer`・
`commitName` の第3引数など、**そのラウンドで入れたばかりの装置**を名指しで疑わせた。

結果、**BLOCK 2 / HIGH 17 / MEDIUM 24**。

**書き戻しの事実誤りは0件**（3ラウンド続いていたのが止まった）。
oss-hygiene が r5 の19コミットを1件ずつ突き合わせ、`CONTRIBUTING` の検査の表11行、
docs が引く識別子・issue 番号・相対リンクも全て実在することを確認している。

---

## BLOCK

### B-1: ワークスペースそのものを消せてしまう（architecture / rust が独立に検出）

- 場所: `src-tauri/src/file_system/operations.rs` の `delete_directory`、
  `src/widgets/file-tree/ui/FileTree.tsx` の `isRoot`
- 内容: `validate_under_root` は `root == target` を「配下」として通すので、Rust は
  ワークスペースの削除を止めていなかった。止めていたのは widget の三項演算子1本だけで、
  その判定は `config.root_dir`（ダイアログが返した生の文字列）と `node.path`
  （Rust が canonicalize した結果）を比べている。
  **Windows では `fs::canonicalize` が `\\?\C:\...` を返すので必ず一致しない。**
  macOS でも `/tmp` や iCloud の symlink を1つ挟むと一致しない。
  一致しないと Delete が出て、`remove_dir_all` で棋譜ごと消える。取り消せない。
- **対応**: Rust が `is_project_root` で止め、`root_not_deletable` を返す（`e1cafa3`）。
  TS 側の判定は「いま読み込んでいるツリーの根」に揃えた（Rust と同じ canonicalize 済みの値）。
  `root_guard` に「そのコマンドだけが呼ばなければならない関門」の対応表を足した。

### B-2: ラウンド5 で Escape をバブル段へ移したことで、既存の2画面が閉じなくなった

- 場所: `src/features/study-positions-manager/ui/StudyPositionsManagerModal.tsx`、
  同 `TagFilterPanel.tsx`
- 内容: 内側が Escape を消費する方法を `preventDefault()` の1通りだと決めてかかった。
  repo にはもう1通り `stopPropagation()` があり、そちらは `document` まで
  イベントを届かせないので **`defaultPrevented` の判定にすら到達しない**。
  局面管理の検索欄で文字を打ち、Escape でクエリを消したあと、
  **もう一度 Escape を押してもモーダルが閉じない**。移す前は閉じていた。
- **対応**: 2箇所を `preventDefault()` へ（`12d4bad`）。`Modal` の側では守れない
  （キャプチャへ戻すと今度は内側が使えない）ので、`escapeReceivers` で機械的に止める。

---

## HIGH

| #    | 検出              | 内容                                                                         | 対応                                                   |
| ---- | ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| H-1  | rust / robustness | ルート改名の判定が Rust と TS で別物。ずれるとディスクだけ改名され設定が残る | `e1cafa3`                                              |
| H-2  | robustness        | 読み直しの失敗が「ファイル操作に失敗しました」として出る                     | `8e603dd`                                              |
| H-3  | robustness        | 送信中に欄の外へ出て失敗すると、名前の失敗がどこにも出ない                   | `8e603dd`                                              |
| H-4  | robustness        | 親フォルダが消えているときの `invalid_path` で、再読み込みが消える           | `e1cafa3`                                              |
| H-5  | robustness        | ルート改名後に `setRootDir` が失敗すると、押せるものが0の画面で止まる        | **ラウンド6 では未対応**（下の訂正）。ラウンド7 で対応 |
| H-6  | react             | `TagsInput` の Escape が `blur()` するので、焦点がフォームの先頭へ飛ぶ       | `12d4bad`                                              |
| H-7  | architecture      | 関門が `AppConfig` の形を写しており、ずれると黙って全開になる                | `406a3c2`                                              |
| H-8  | architecture      | `PositionNavigationModal` の `window` keydown が Tab の既定動作を消す        | r5 で対応済み（`e6306bc`）と確認                       |
| H-9  | ui                | 失敗の箱で行が伸びると、アイコンと chevron が名前欄から離れて落ちる          | `8bc46eb`                                              |
| H-10 | ui                | `.fsError__raw` のスクロールバーに `-thumb` が無く、つまみが出ない           | `8bc46eb`                                              |
| H-11 | ui                | 送信中の `readOnly` を示す見た目が1つも無く、`:disabled` が死んだ            | `8bc46eb`                                              |
| H-12 | comment           | `validate_under_root` の順序の理由が、同じファイルの実装で成立しない         | `e1cafa3`                                              |
| H-13 | comment           | `vite.config.ts` の「`src/` の中だけ」が3行下の `include` と違う             | `a8b8c09`                                              |
| H-14 | comment           | `commentHistory` の `で対応` の説明が一覧と一致していない                    | `a8b8c09`                                              |
| H-15 | comment / oss     | `file-tree.md` の「S4 の間は積まない」が `reload_failed` の例外を落とす      | `a8b8c09`                                              |
| H-16 | comment           | `inline-name-editor.md` の E1 行が、空欄・同名の分岐を落としている           | `a8b8c09`                                              |
| H-17 | oss               | この PR が3つの独立した変更を1本に載せている                                 | 下記「反論」                                           |

## MEDIUM（24件）

主なもの。**対応したものにコミットを併記する。併記の無いものは未対応**（下の訂正）。

- **rust**: root 改名の例外が存在オラクルを開ける（順序の理由を実態に合わせて訂正）／
  `mv_directory` が自分の子孫への移動を弾かず EINVAL が `io` に丸まる（`e1cafa3`）／
  `root_guard` が引数付きの属性 `#[tauri::command(async)]` を1件も見ない（`e1cafa3`）／
  `STRUCT_CARRIED_PATH` から `save_config` が漏れ、単体テストがその見逃しを固定していた／
  `EXEMPT` の理由が指す `TODO(#215)` がソースに無い
- **react**: `isEditting` prop が5経路とも `true` 固定で、`return null` が到達不能（`a8b8c09`）／
  `PositionNavigationModal` が同じ同期を2つの effect で書き、閉じている間も走る（`a8b8c09`）／
  `TODO(#216)` が `loadFileTree` の TSDoc と宣言のあいだに割り込む（`8e603dd`）
- **robustness**: symlink を無条件で落としたので、root の中で閉じたものまで黙って消える
  （`e1cafa3` で root の外へ出るものだけに絞り、消えることは #179 へ）／
  ルート行だけ改名中のクリックでツリーが畳まれる（`8e603dd`）／
  テストのコメントが、消した `pointer-events: none` をまだ根拠にしている（`8e603dd`）
- **ui**: placeholder のコントラスト直しが4本中2本で止まっていた（残り2本は 2.49:1、`8bc46eb`）／
  同じ役割の失敗の面が3通り（`406a3c2` で入力の直下に出す2つを揃えた）／
  ファイル名のツールチップが下端の行で画面外へ落ちる（`8bc46eb`）／
  空状態が定義の無いクラス名で描かれ、左上端に貼り付いていた（`8bc46eb`）
- **architecture**: barrel を明示列挙にしたのに `api/fileSystem` と `api/service` は
  外から直に読まれたまま（**公開面を狭く保つほど境界が緩む**、`406a3c2`）／
  9コマンドが同じ関門プロローグを写経（順序を `root_guard` の検査にした、`406a3c2`）／
  `walk.ts` に寄せた8検査のうち4本が走査0件でも緑（**ラウンド6 では未対応**。ラウンド7 で対応）
- **oss**: `root_guard` の下限が現在値ちょうど（正当に減らすと無関係な文言で落ちる）／
  `sliceBarrels` の `TODO(#216)` が実態と違う（穴はレイヤではなく barrel の有無）／
  `renameNode` に戻り値の注釈が無く `asyncResultUse` の対象外（`8e603dd`）／
  ADR-0001 の worktree の置き場が `.gitignore` と食い違う／
  `OPERATING-MODEL` §5 の Now の出所が2箇所

## 反論（直さずに残したもの）

### H-17: PR を3本に分けるべき

oss-hygiene は「#169 本体 / ADR-0005 の面の統一 / Rust の root 関門」の3つに
分けるべきだとした。**分けない。** 理由は2つ。

1. **3つは因果でつながっている。** 失敗を出す先を作るたびにボタンとダイアログの面が
   増えたのが ADR-0005 の動機で、root 関門は「失敗の code と文言」を直す過程で
   `not_found` / `invalid_path` の割り当てを変えたもの。切り離すと、
   どちらの PR も「なぜこの値なのか」を自分の中で説明できなくなる
2. **いま分けると内容が変わる。** ラウンド1〜6 の修正は互いを踏んでおり、
   3本へ切り直すのは実質の再実装になる

代わりに **PR 本文に「この PR に含まれる独立な変更」として3つを並べ**、
それぞれの検証の当て方を書く（reviewer の「最低でも」の線）。
次回からは着手時に範囲を切る。

## 範囲の外へ送ったもの

| 内容                                                                          | 送り先                                                   |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| 画面内へ丸める処理が6通り / `utils.rs` が5責務の集積所 / 関門プロローグの写経 | [#231](https://github.com/Rioh1118/obs-shogi/issues/231) |
| symlink を落としたことが利用者に出ない                                        | [#179](https://github.com/Rioh1118/obs-shogi/issues/179) |
| ルート改名後の `setRootDir` 失敗が行き止まりの画面へ落ちる                    | [#230](https://github.com/Rioh1118/obs-shogi/issues/230) |

## 自分が作った退行（2件）

1. **Escape をバブル段へ移したとき、内側が消費する方法を1通りだと決めてかかった**（B-2）。
   repo に `stopPropagation()` が2箇所あり、そちらは `document` まで届かない。
   「置いた装置が、同じラウンドで自分が扱っていない書き方を見ていない」は**3ラウンド続いた**。
   今回は `escapeReceivers` として機械で止め、変異を当てて落ちることを確認した。
2. **symlink を無条件で落とした**（MEDIUM）。root の中で閉じた symlink は普通の使い方で
   中身も開けるのに、何も伝えないまま一覧から消していた。

## `main` の取り込み

作業中に `origin/main` が2度動いた。1度目（PR #232 のマージコミット形）は普通に取り込み、
2度目は**同じ PR が squash に置き換わって**いた。

`git diff f992cc2 ce9afb8` は**0ファイル**（中身は同一、履歴の形だけが違う）。
そのまま再マージすると共通の祖先が置き換え前の `main` になり、同じ変更を2度当てるため
67ファイルが衝突する。rebase も同じ理由で最初の1件から19ファイル衝突した。
ツリーを動かさず上流を祖先として記録した（`-s ours`）。

そのうえで `npm run verify` / `npm run build` / `npm run verify:rust` を通し直している。

## 訂正（ラウンド7 で判明）

**この報告書の書き戻しに、事実でない記述が2件あった。** 同じ形が4ラウンド続いている。

1. **H-5 の対応列**。「一部（`a8b8c09`）。残りは #230 へ」と書いたが、
   `a8b8c09` に `setRootDir` まわりの差分は無く（空状態の導線を置いたのは `8bc46eb`）、
   #230 にもコメントを立てていなかった。**どちらも事実でない。**
   実体（成否を見ずに `Ok` を返す）はラウンド6 の時点で残っていた。
2. **MEDIUM の「全件対応済み」**。`walk.ts` に寄せた4検査が走査0件でも緑になる件は
   直していなかった。「全件対応済み」と書くと、再掲しない規則のもとで恒久的に見えなくなる。

原因は、対応列を書くときにコミットの中身を見ていないこと。ラウンド7 からは
**書き戻しの各行を `git show --stat` で突き合わせてから記録する**。

## 検証

- `npm run verify` — 緑（41ファイル / 330件）
- `npm run build` — 緑
- `npm run verify:rust` — 緑（ベンチを除く `#[test]` は 19件）

変異を当てて落ちることを確認したもの:

- `escapeReceivers`（`preventDefault` を `stopPropagation` に戻す → 落ちる）
- 関門の順序（`read_file` の関門を存在確認の後ろへ → 落ちる）
- `root_guard` の crate 全体走査（`kifu.rs` の関門を消す → 落ちる。以前の形では通っていた）
