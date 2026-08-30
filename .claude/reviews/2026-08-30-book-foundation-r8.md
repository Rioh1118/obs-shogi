# レビュー book-foundation ラウンド8

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/` 全7ファイル、`src-tauri/src/lib.rs` の book 登録部分、`.claude/hooks/verify-gate.sh` / `verify-gate.test.sh`
- 走らせた reviewer: rust / robustness / comment
- 前ラウンド: `-r1.md`〜`-r7.md`（計85件）

rust は「Rust 側は所見なし」と明示した（並行性・エラー処理・IO・所有権のいずれも、R7 の修正後に
新しく壊れている箇所は無い）。以下はゲート2件と、robustness / comment の8件。

## 所見

### M-01 [HIGH] 引用の中身まで数えるので、メッセージ本文に `git commit` と書くと deny になる

comment。`verify-gate.sh:82-83`。`gate_commit_count` は文字列全体を grep する。

```
git commit -m "fix: git commit の検出を直す"   count=2 → deny
```

**このブランチの `79695f0` を、いまのゲートは deny する**（reviewer が `origin/main..HEAD` の67件を
全て流して確認）。deny の案内は「commit を2つ以上並べないこと」で、本文が原因の利用者は従いようがない。
**ゲートの仕事を説明するコミットほど落ちる。**

→ 直す。空白を含む引用だけを潰してから数える。`$(` とバッククォートを含む引用は中で本当に走るので潰さない。

### M-02 [HIGH] コミットを作る他のサブコマンドが、deny も検証もされずに素通しする

rust。`verify-gate.sh:36-40,56-61`。実測:

```
PASSTHROUGH   git revert --no-edit HEAD
PASSTHROUGH   git cherry-pick abc123
PASSTHROUGH   git merge --no-ff feature
PASSTHROUGH   git rebase --continue
PASSTHROUGH   git am /tmp/x.patch
```

どれもコミットを作るが `commit` の語を含まないので、検出も最後の網も外れて `exit 0`。
**worktree を並べて使うこの repo では `cherry-pick` も `rebase` も日常操作**で、
出来上がるツリー（main の `.rs` と手元の `.rs` を初めて突き合わせたもの）は定義上どこでも検証されていない。

→ 直す。コミットを作るサブコマンドを1つの語彙にまとめる。

### M-03 [MEDIUM] ゲート自身の変更をゲートが素通しし、ケース表テストはどこからも走らない

rust。`verify-gate.sh:7,151-167`、`package.json`。`.claude/hooks/*.sh` はどの `case` にも当たらず
`needs_ts=0 / needs_rust=0` で `exit 0`。

**このリポジトリで唯一「何を検証するか」を決めているファイルが、自分の変更だけは一切検証されずに
コミットできる。** しかもこのファイルは R2→R7 の6ラウンド連続で素通しの穴を出している。
判定を1文字変えて全て外しても、テストが走らないままコミットが通り、以後すべての `.rs` が無検証で通る。

→ 直す。`.claude/hooks/*.sh` の変更でケース表を走らせる。

### M-04 [MEDIUM] `to_book_key` の契約が、ファイルの破損を「利用者の入力の誤り」として返させる

robustness。`sfen.rs:70-71` と `reader.rs:14-22`。doc はファイル側のキーもこの関数に通すよう指示するが、
`to_book_key` の失敗は `InvalidSfen` 固定で `path` も無い。`reader.rs` は逆に
「書式が壊れているときは `InvalidContent`」「io の失敗はパスを添えて」と要求している。

#91 の実装者が指示どおり書くと、壊れた定跡を開いた利用者は盤を1手進めただけで
「局面の指定が SFEN として読めない」を受け取り、正しい復帰導線（この定跡が壊れている）に辿り着けない。
どの定跡が壊れているかも分からない。

→ 直す。ファイル側の入口を分ける。

### M-05 [MEDIUM] L-03 の直し方を、追加したテストが1本も守っていない

robustness。`api.rs:196-211,342-359`。差し戻し形にしても、R7 で足した2本は**両方とも通る**
（閉じたハンドルなら `get` が先に落ちて `InvalidHandle`、生きたハンドルなら `to_book_key` が落ちて
`InvalidSfen`。順序を変えても種別は同じ）。

**F-06 → K-05 → L-03 と3ラウンド連続で再発している性質が、テストで固定されていない。**

→ 直す。`get` の呼び出し回数で順序を固定する。

### M-06 [MEDIUM] 「切り出せないと素通しする」が、同じファイルの最後の網と食い違う

comment。`verify-gate.sh:27-29`。R7 で `gate_mentions_commit` を足した時点で、結末は
「素通し」から「誤 deny」に変わっている。危険の向きを逆に説明しているので、
次に触る人は「取りこぼすと穴が開く」と読んで正規表現を広げる方向にだけ動く。

### M-07 [MEDIUM] ゲートの doc にレビューの経緯（「4ラウンド続けて」）が残っている

comment。`verify-gate.sh:65-69`。CONTRIBUTING「変更の経緯を書かない」に当たる唯一の残り
（grep で確認）。次に穴が1つ見つかると自動的に嘘になる種類の値。
列挙されている綴り自体は「言い当てられない」の証拠として価値があるので残す。

### M-08 [MEDIUM] `register_fills_the_info_from_the_reader` が、名前の主張を区別できない

comment。`session.rs:219,192-207`。doc も実装も「reader に問い合わせない」なのにテスト名だけが
`from_the_reader`。しかも `FakeReader::position_count()` と `opened()` が同じ値なので、
**どちらから埋めても緑になる。**

### M-09 [MEDIUM] `rejects_a_path_that_cannot_be_resolved` は何も解決していない

comment。`api.rs:507`。このファイルで "resolve" は `canonicalize` の意味で一貫しているのに、
ここだけパスの**形**の検査を指している。

### M-10 [MEDIUM] 「数え上げるより先に打ち切る」を固定したと書いたテストが、打ち切りの有無を区別できない

comment。`sfen.rs:488-503`。早期打ち切りを外しても、42.9億回回った**あとで**
`PieceCounts::validate` が同じ `InvalidSfen` を返すので、テストは（遅くなっても）緑のまま通る。

## 重複・矛盾した所見

- M-05 と M-10 と M-08 は同じ形。**「実装を壊してもテストが緑のままになる」** ものが3件。
  種別だけを見る / fake と材料が同じ値 / 遅くなるだけで結果は同じ、と原因は違うが、
  いずれも「テストがあるから固定されている」という誤った安心を与えていた
- M-01 と M-02 はゲートの逆向きの失敗（誤 deny と素通し）。どちらも `commit` という語だけを見ていたこと
  に帰着する

## 見ていない範囲

- フロント側（`src/`）。呼び出しは R1 から0件のまま
- 実際の定跡ファイルでの動作。`open_reader` は今も必ず `Err`
- やねうら王 `source/book/book.h` / `Position::sfen()` の一次資料
- Windows / Linux の実行時挙動。実測は macOS のみ
- **hook の payload の `.cwd` が Bash ツールの持続する作業ディレクトリを追随するか。**
  `gate_target_dir` の起点はここに依存しているが、実物の payload を観測する手段が無く確認できていない
- 意図して見送っている4件（issue #197 / ゲートの誤発火側 / 検査と使用の窓 / Windows CI）は再提出されていない

## lint / hook で強制できるもの

- **M-03 それ自体が hook での強制。** これを入れれば M-02 のような退行も、ケース表に行を足す限り機械で止まる
- **コミットを作るサブコマンドの語彙をケース表で固定する** — M-02。今回7行足した
- **偽陽性側の行を宛先表に置く** — M-01。これまでの表は真陽性（`commit` を2つ並べる）しか持っていなかった
- **`get_calls` カウンタ** — M-05。差し戻しを `cargo test` が止める。変異で確認した
- **fake と材料の値を分ける** — M-08。値が同じである限り、実装を壊しても緑になる

## 修正結果

| 所見 | 結果 | コミット |
| ---- | ---- | -------- |
| M-04 | 直した | `9a8dea5` |
| M-05 | 直した | `9a8dea5` |
| M-08 | 直した | `9a8dea5` |
| M-09 | 直した | `9a8dea5` |
| M-10 | 直した | `9a8dea5` |
| M-01 | 直した | `27b2506` |
| M-02 | 直した | `27b2506` |
| M-03 | 直した | `27b2506` |
| M-06 | 直した | `27b2506` |
| M-07 | 直した | `27b2506` |

提案どおりに直さなかったもの:

- **M-01 の潰し方** — reviewer の提案どおり「空白を含む引用だけ」を潰した。最初に空白を条件から外して
  実装したところ、`'git' commit -m x`（語ひとつの引用）が検出できなくなり、ケース表がその場で落ちた。
  条件は reviewer の提案が正しい

副次的に分かったこと: この修正の結果、`git commit -m "$(cat <<'EOF' … EOF)"` という書き方は
deny になる（`$(` を含む引用は潰さないので、本文中の `git commit` が2つ目の呼び出しとして数えられる）。
**コミットメッセージはファイルに書いて `git commit -F` で渡す**のが、この repo での正しい打ち方になる。

## 変異による確認

- M-05 のテスト: `resolve_lookup` を `get` 先行の形に差し戻すと
  `a_broken_position_does_not_take_a_reference` が落ちることを確認した

## 検証

`npm run verify:rust` を通した。book のテストは 54件。
`bash .claude/hooks/verify-gate.test.sh` も通した（判定 33 / 綴り 5 / 宛先 30）。
