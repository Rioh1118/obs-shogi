# レビュー: #169 ファイル操作の失敗を出す — ラウンド8

- 日付: 2026-08-30
- ブランチ: `fix/169-file-tree-error`
- 範囲: ラウンド7 の対応（`58ae56f..0df3616`）以降に動いた全て
- 観点: architecture / react / ui / robustness / rust / comment / oss-hygiene（7観点、並列）
- 前のラウンド: [r7](./2026-08-29-file-tree-error-r7.md)

## 対応の書き方（今回から）

`git log --no-merges 0df3616..HEAD --stat` の出力を先に手元へ出し、**対応列をそこから引いた**。
記憶から書かない。ラウンド7 で「突き合わせてから書く」と決めたのに6件を外したのは、
突き合わせの網羅を確かめる手段が無かったため。

このラウンドで私が作ったコミットは2つだけ（`acb848d` / `87d6d88`）。

結果、**BLOCK 4 / HIGH 8 / MEDIUM 22**。

---

## BLOCK

### B-1: `create_ai_profile_dirs` が `..` を通し、ai_root の外にフォルダを作る

- 検出: rust / architecture（独立に2件）
- 内容: ラウンド7 で `create_directory` から移すとき、名前の規則を**写して** `.` / `..` の
  1つを落とした。AI 名の欄に `..` と打つと `<ai_root>/../eval` と `../book` が作られ、
  コマンドは `Ok` を返す。続くスキャンは ai_root の下しか見ないので画面は
  「まだありません」のまま。**利用者は作成に失敗したとも別の場所に作られたとも知らされない。**
- **対応**（`acb848d`）: 規則を写すのをやめ、`validate_basename` を呼ぶ。

### B-2: symlink の網でノード数が組み合わせ爆発する

- 検出: rust
- 内容: ラウンド7 の `ancestors` は**その経路で辿った symlink**しか見ないので、循環は
  止まるが総数に上限が無い。互いを指す symlink を8本置くと**深さ8のまま175万ノード**になり、
  深さの上限は一度も効かない。1ノードに UUID とフルパスの String を持ち、
  `get_file_tree` は同期実行なので応答が返らない。
- **対応**（`acb848d`）: ノード数の予算を持たせ、打ち切りを `truncated` で返す
  （空のフォルダと区別が付かない形にしない）。互いを指す symlink の網でノード数が
  抑えられることをテストで固定した。

### B-3: `invalid_path` の意味を宣言した先頭コメントが、同じラウンドの実装と食い違う

- 検出: comment
- 内容: 「`invalid_path` は root の外専用」と書いたが、ラウンド7 で足した
  `load_root_dir` が `app.json` の read / parse 失敗をこの code で返す。
  `mv.rs` の4箇所も親や名前を解決できないときに返す。
- **対応**（`acb848d`）: 「その場所を扱えない」の意味に直し、3つの入口を並べた。

### B-4: 別セッションの作業を、私のコミットが巻き込んでいた

- 検出: oss-hygiene
- 内容: `git add -A .claude` が、別セッションが編集中の `verify-gate.sh`（+295/-44）と
  新規の `verify-gate.test.sh`（251行）を `b526df4`（`docs:`）へ入れていた。
  コミット本文には一言も書かれておらず、**7観点のレビュアーが差分を見たあとに、
  レビュー対象として名前が挙がらないまま入った**。しかもそのフックには
  「読み取り専用の `git show` / `git log` が deny される」不具合があり、
  このセッションで3回踏んでいる（3回目はその issue を立てようとしたとき）。
- **対応**（`87d6d88`）: このブランチから外した。内容は `b526df4` と
  退避用の `chore/verify-gate-wip` に残してある。不具合は
  [#235](https://github.com/Rioh1118/obs-shogi/issues/235) へ。

---

## HIGH

| #   | 検出               | 内容                                                             | 対応                                                                                                                                         |
| --- | ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| H-1 | oss                | **r7.md の対応列に6件の誤帰属。しかも「確かめた」と書いていた**  | `acb848d`（下記）                                                                                                                            |
| H-2 | robustness / react | ルート改名後に `setRootDir` が失敗すると、行き止まりの画面へ飛ぶ | `acb848d` は**未了**（下記の訂正）。`a4bc4c3` / `c633f41` / `ddf714c` で解決                                                                 |
| H-3 | ui                 | ラウンド7 の `align-self` が no-op。揃え直す相手が違った         | `acb848d`                                                                                                                                    |
| H-4 | ui                 | `:read-only` の面がカードと同じ色で、差が 1/255 未満             | `acb848d`                                                                                                                                    |
| H-5 | react              | blur で確定して失敗すると、打った文字列ごと消える                | `acb848d`                                                                                                                                    |
| H-6 | rust               | root の外へ出る symlink を落とす1行にテストが無い                | `acb848d`                                                                                                                                    |
| H-7 | architecture       | `setRootDir` だけ `{ ok }` 形で、`asyncResultUse` の網の外       | `acb848d`                                                                                                                                    |
| H-8 | robustness / arch  | AI フォルダの失敗が生の英文で、復帰操作も無関係なものが出る      | 一部（`acb848d` で名前の失敗を `validate_basename` へ）。`String` → `FsError` は [#231](https://github.com/Rioh1118/obs-shogi/issues/231) へ |

## MEDIUM（22件）

主なもの。

- **rust**: `MAX_DEPTH` の打ち切りが空フォルダと区別できない（`acb848d`）／
  `ancestors` を全項目で `clone()`（`acb848d` で `&mut` に）／
  `guarded_variables` が引数の括弧で変数名を取り違える（[#231](https://github.com/Rioh1118/obs-shogi/issues/231)）／
  `#[cfg(windows)]` が CI で一度もコンパイルされない（`acb848d` の skip は効いていなかった。`6610086` で解決）
- **comment**: `escapeReceivers` の doc が持っていない性質を主張（`acb848d` で実装を doc に合わせた）／
  `vite.config.ts` のコメントが変更の経緯そのもの（`acb848d`）／
  `EXTRA_GUARDS` の doc に同じ行が2つ（`acb848d`）／
  `without_comments` の「偽陽性で済む」が `/*` には当たらない（`acb848d`）／
  同じ理由が3箇所に写っている（`acb848d` で参照に）
- **oss**: r7.md の Rust テスト件数が実測と合わない（`acb848d` で数を消した）／
  `CLAUDE.md` の「`.claude/` だけの変更は素通し」がゲートの実装と違う（[#235](https://github.com/Rioh1118/obs-shogi/issues/235) へ）／
  ADR-0001 に誰も使わない手順が残っている（下記の反論）
- **ui**: 前置きと失敗の箱の余白の持ち主（`acb848d` で1枚に包んだ）／
  長い名前の扱いがファイル行とフォルダ行で違う（[#230](https://github.com/Rioh1118/obs-shogi/issues/230) へ）／
  `$sidebar-width` が参照0の死んだトークン（[#231](https://github.com/Rioh1118/obs-shogi/issues/231) へ）
- **architecture**: `entities/engine/api/aiLibrary.ts` の置き場、`entities/app-config` の
  barrel に同名2つ、`ALLOWED`/`getExt` の死んだ export（すべて [#231](https://github.com/Rioh1118/obs-shogi/issues/231) へ）

## H-1: 私の「確かめた」が事実でなかった

ラウンド7 の報告書の対応列に、**`.rs` も `.ts` も触っていないコミットのハッシュが6件**
書かれていた。しかも `0df3616` のコミットメッセージは
「各行の主張が実際にそのコミットの差分に入っていることを `git show --stat` で1件ずつ
確かめてから書いた」と書いている。**確かめたのは11組で、その6件は入っていない。**

r7.md に訂正節を足し、6行を `1092a77` / `a765bbd` に直した。

**書き戻しの誤りは5ラウンド続いている。** ラウンド8 からは
`git log --no-merges <base>..HEAD --stat` の出力を先に出し、対応列をそこから引く。

## 訂正（ラウンド9 で判明）

**2件、事実でないことを書いていた。**

### 1. H-2 を `acb848d` で解決済みとしていた

`acb848d` のコミット本文は「失敗のモーダルに『ワークスペースを選び直す』を出す。
ツリーが残っていてもその根が実在しない状態は、そこでしか脱出できない」と書いているが、
`git show acb848d | grep fallback` は**0件**。`fallback` はツリーが1本も無い枝に
`7fb596f` の時点から渡っていただけで、モーダル側には渡っていない。
`acb848d` が `FileTree.tsx` に入れたのは `.file-tree__failure` の `<div>` だけ。

しかもこの H-2 には、コミットの外にもう2つ穴が残っていた（どちらもラウンド9 の BLOCK）。

- `setRootDir` の `catch` から `dispatch({type:"error"})` を外したとき、
  その手前の `dispatch({type:"loading"})` を残していた。`isLoading` が `true` で
  固定され、**逃げ道として案内した設定タブのボタンが押せなくなる**
- `AppLoading` の `error` の枝には元から出口が無く、`/` へ回っても抜けられない

`a4bc4c3`（モーダルにも `fallback`）/ `c633f41`（`settled` で `isLoading` を降ろす）/
`ddf714c`（起動エラーの画面に選び直しを出す）で解決した。

### 2. `symlink_dir` の skip が効いていなかった

`return` が抜けるのはヘルパだけで、呼び出し側のテストは symlink 0本のまま
assert まで進む。`children.all(|c| c.name != "escape")` は空振りで真になるので、
**カバレッジ0で緑になる**。「飛ばす」でも「黙って通さない」でもなかった。
`6610086` で `-> bool` にして、飛ばす判断を呼び出し側へ移した。

**書き戻しの誤りはこれで6ラウンド続いている。** ラウンド8 で決めた
「`git log --stat` を先に出して対応列をそこから引く」は、**帰属**の誤りは
止めたが、**「そのコミットで解決した」という判定**の誤りは止めていない。
ラウンド9 からは、解決したと書く行について**その主張を固定するテストを指す**
（テストが無いなら「未検証」と書く）。

## 反論（直さずに残したもの）

### ADR-0001 の手順ブロックを消すべき

oss-hygiene は「手順は決定ではないので ADR から落とし、`OPERATING-MODEL` §1 に
4つ目の例外（決定でない記述の削除）を足せ」とした。**このラウンドではやらない。**

ADR の書き換えの境界は、この PR で既に2往復している（ラウンド6 で書き換え、
ラウンド7 で戻した）。3度目を `#169` の中でやると、失敗の見せ方の PR に
運用規約の変更がまた1つ乗る。ADR-0001 の本文には
「実際の置き場は `CONTRIBUTING.md` を見ること」を残してあるので、
現在値へは辿れる。§1 の例外を増やす判断は運用の話として別で扱う。

## 範囲の外へ送ったもの

| 内容                                                                                                                           | 送り先                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 検証ゲートが読み取り専用の git コマンドを deny する                                                                            | [#235](https://github.com/Rioh1118/obs-shogi/issues/235) |
| `aiLibrary.ts` の置き場 / `app-config` の barrel の同名2つ / 死んだ export / `$sidebar-width` / `guarded_variables` の切り出し | [#231](https://github.com/Rioh1118/obs-shogi/issues/231) |
| 長い名前の扱いがファイル行とフォルダ行で違う                                                                                   | [#230](https://github.com/Rioh1118/obs-shogi/issues/230) |

## 検証

- `npm run verify` — 緑
- `npm run build` — 緑
- `npm run verify:rust` — 緑

件数は書かない（`CLAUDE.md`）。`npm run test` と `cargo test` の末尾で確認する。

変異を当てて落ちることを確認したもの:

- root の外へ出る symlink の判定（`is_under` を外すと落ちる）
- `escapeReceivers` の文字列の扱い（潰さない形に戻すと落ちる）
- blur で確定したときの扱い（`fromBlur` を渡さない形に戻すと落ちる）
