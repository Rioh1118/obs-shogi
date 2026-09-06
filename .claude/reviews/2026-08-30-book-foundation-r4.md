# レビュー book-foundation ラウンド4

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/` 全7ファイル、`src-tauri/src/lib.rs` の book 登録部分、`.claude/hooks/verify-gate.sh` / `verify-gate.test.sh`
- 走らせた reviewer: rust / robustness / comment
- 対象コミット: `d0a4dcb`（R3 の報告書まで）
- 前ラウンド: `-r1.md`（15件）/ `-r2.md`（17件）/ `-r3.md`（12件）

## 所見

### I-01 [HIGH] ゲートが `cd <別のツリー> && git commit` の宛先を解決しない（H-01 の直し方が不完全）

3体とも指摘。`verify-gate.sh:34-48`。`gate_target_dir` が拾うのは `-C` と `--work-tree` だけ。
実測（hook の CWD を wt-53 にして）:

```
cd .../wt-90 && git commit -m x   -> .../wt-53   ← 別のツリーを検証する
git -C .../wt-90 commit -m x      -> .../wt-90   ← 直っている
git --git-dir=/tmp/other/.git commit -m x -> hook の CWD（--git-dir を見ていない）
git commit -m x && git -C /tmp/gA log     -> /tmp/gA（-C の帰属を見ていない）
```

検出側の表には `cd /x && git commit` が CATCH として載っているのに、決定側の表には `cd` の行が1つも無かった。

robustness がさらに指摘: **Bash ツールの CWD は呼び出しを跨いで持続する**ので、
前の呼び出しで `cd` していれば**素の `git commit` でも**同じことが起きる。文字列解析だけでは閉じない。

→ 直す。起点を payload の `cwd` から渡し、`git ... commit` の呼び出し区間に属する指定だけを見る。

### I-02 [MEDIUM] `-C` の抽出が git 以外の `-C` を拾い、解けない理由で正当なコミットを止める

rust。`grep -C 3 foo f.txt && git commit -m x` で `git -C 3 rev-parse` に失敗し、**コミットを完全にブロック**。
案内は「git のディレクトリ指定を外せ」だが、利用者は外すべき `git -C` を持っていないので従えない。
R2/R3 が許容と決めた誤発火（余分に検証が走るだけ）とは別で、解除手段の無い停止。

**このラウンドの作業中に実際に踏んだ。**

→ 直す。I-01 と同じ「呼び出し区間だけを見る」で閉じる。

### I-03 [MEDIUM] `open_at` が返す `err.path` に2つの規約が混ざる（H-03 が H-06 を打ち消していた）

rust / robustness。`api.rs:79-86`, `reader.rs:60,67,74`。H-06 は「利用者が選んでいないパスについて
答えるな」を理由に食い違いの枝を直したが、同じラウンドの H-03（`open_reader(&canonical)`）が
io 系4種と `UnsupportedFormat` を canonical 側へ戻していた。

`open_book` は #91 まで必ず `UnsupportedFormat` なので、**今この経路を通る利用者は100%解決後のパスを見る。**

→ 直す。`open_at` が返す失敗の `path` は常に呼び出し側が渡した綴りにする。

### I-04 [MEDIUM] `join_error` だけが `path` を持たない

robustness。`api.rs:228-233`。`BookError::from_io` の doc がまさにこの性質を問題として書いている。
`BookReader` の doc は「壊れた内容で panic しない」を要求しており、panic した場合の受け皿がこの関数。
定跡を3本開いていると、どれが壊れているか分からないまま同じ失敗が出続ける。

→ 直す。パスと、次の操作（閉じてから開き直す）を添える。

### I-05 [HIGH] `BookHandle` の doc が、実装より弱い保証を書いている

comment。`types.rs:5-6`。「close するまで再利用しない」は「close 後は再利用しうる」と読める。
実装は単調増加で close 後も配り直さず、`a_closed_handle_is_not_handed_out_again` が固定している。
公開型はフロントが受け取る唯一の契約面なので、弱い方が書いてあると再利用する変更を入れられる。

→ 直す。

### I-06 [MEDIUM] ケース表に書いた `git -c` の外部仕様が事実と違う

comment。`verify-gate.test.sh:37-39`。git は `-c <name>`（`=` 無し）を受け付け boolean true として扱う。
`git -c user.name a commit` が commit に到達しないのは「`-c` が値を要求して失敗するから」ではなく、
**`a` がサブコマンドとして解釈されるから**。期待値 SKIP は正しいが根拠が誤り。

→ 直す。`git -c foo.bar commit`（`=` 無しで commit に到達する形）を CATCH として表に足す。

### I-07 [MEDIUM] NUL を弾く理由に書いた挙動が、Rust の実際の挙動と違う

comment。`api.rs:104-107`。`std::fs::canonicalize("/tmp/a\0b.db")` は `InvalidInput` を返す。
切り詰めは起きないので、`a\0b.db` が `a` として別ファイルを開く筋道は無い。
この検査が守っているのは「原因が `Io` に化けて、パスの書き間違いという復帰導線を出せなくなる」こと。

→ 直す。

### I-08 [MEDIUM] `cargo doc` の book に関する警告が2件復活（G-13 の退行）

comment。`mod.rs:3`（`BookReader` へのリンクが解決できない）と `types.rs:8`（private な
`BookFormat::from_path` へのリンク）。G-04 / G-12 の可視性の絞り込みで復活していた。

→ 直す。

### I-09 [MEDIUM] ケース表の冒頭にレビューのラウンド履歴が書かれている

comment。`verify-gate.test.sh:4-6`。「2ラウンド続けて穴を出した」は経緯で、CONTRIBUTING に正面から当たる。
実際このラウンドで3件目の穴が出たので数字自体も古い。

→ 直す。危険の向き（素通し > 誤発火）だけ残す。

### I-10 [MEDIUM] symlink のテストが、名前が述べていない性質を3つ固定している

comment。`api.rs:285-331`。(a) 形式が違うリンクを弾く、(b) 判別できない場合の `err.path`、
(c) 同じ形式のリンクは弾かない、の3つ。名前は (a) しか述べていない。
特に (c) は `UnsupportedFormat` と直接比べているので、#91 で reader が入ると
**このアサーションだけが理由なく落ちる**。落ちたとき出る名前は「別形式を指すリンクを弾く」。

→ 直す。性質ごとに分け、(c) は「`InvalidPath` にはならない」を見る形にする。

## 重複・矛盾した所見

- I-01 / I-02 は同じ関数の逆向きの失敗（素通しと過剰な停止）。**どちらも「コマンド文字列全体を見ている」
  ことに帰着する**ので、`git ... commit` の呼び出し区間を切り出して両方閉じた
- I-03 は R3 の H-03 と H-06 が互いに逆を向いていたという指摘。**同じラウンドで入れた2つの修正が
  打ち消し合った**形で、片方だけを見ていては気づけない。`open_at` の失敗の `path` に1つの規約を置いて閉じた
- robustness は「`count > 18` で弾かれる入力に正当な局面は無い」「`InvalidPath` に寄せた判定で
  正当な使い方は弾かれない」を実測で確認し、**所見にしなかった**と明示している

## 見ていない範囲

- フロント側（`src/`）。`open_book` / `lookup_book_moves` / `list_books` / `close_all_books` /
  `get_book_info` の呼び出しは grep で0件のまま
- 実際の定跡ファイルでの動作。`open_reader` は今も必ず `Err` を返す
- やねうら王 `source/book/book.h` / `Position::sfen()` の一次資料（R1 から変わらず）
- Windows / Linux でのパス挙動。`canonicalize` / symlink / NUL の実測は macOS のみ。
  Windows の `\\?\` 前置きが `BookInfo.path` に出る点は未確認
- ネットワークマウントでの `canonicalize` / `metadata` のハング。`spawn_blocking` に timeout が無く
  `await` は無期限だが、これは issue #197（中断）と地続きなので再提出されていない
- **検査と使用の間の窓**。`canonicalize` → `metadata` → #91 の `File::open` で解決が3回起きる。
  窓が狭くなっただけで消えてはいない。robustness は「単一利用者のデスクトップアプリで悪用の筋道を
  書けなかった」として所見にしなかった。#91 で `File` を1回開いて持ち回る形にすれば消える
- ゲートの誤発火側（クォート内の `git ... commit` で発火）。R2/R3 の判断のまま
- `cargo audit` / dashmap 6.1.0 の deadlock 実測

## lint / hook で強制できるもの

- **検出側の表と決定側の表の網羅性を揃える** — I-01 が滑ったのは、検出側に有る綴り（`cd ... && git commit`）が
  決定側の表に無かったため。**今回 `expect_dir` に `cd` 系・`tar -C` 系・`--git-dir` 系を足した**
- **`open_at` が返すエラーの `path` を組で見るテスト** — I-03 は「`code` だけを見るテスト」だったから
  反転に気づけなかった。**今回 `errors_report_the_requested_spelling_not_the_resolved_one` を足した**
- **`git -c foo.bar commit`（`=` 無し）の CATCH ケース** — I-06 の理解をテストに固定した
- `RUSTDOCFLAGS="-D warnings" cargo doc --no-deps` は `src/engine/types.rs:160,163,186` の既存3件が
  残っている限り入れられない（R2 と同じ結論）。**book の2件だけ消した**

## 修正結果

| 所見 | 結果 | コミット |
| ---- | ---- | -------- |
| I-05 | 直した | `55b782e` |
| I-07 | 直した | `e3977a4` |
| I-08 | 直した | `58801f1` |
| I-03 | 直した | `96e0e15` |
| I-10 | 直した | `96e0e15` |
| I-04 | 直した | `3c6fc3b` |
| I-01 | 直した | `63238ab` |
| I-02 | 直した | `63238ab` |
| I-06 | 直した | `63238ab` |
| I-09 | 直した | `63238ab` |

コミットの粒度: I-03 と I-10 は同じテストブロックの書き換えで、片方だけ戻すことがないので1コミット。
I-01 / I-02 / I-06 / I-09 は `verify-gate` の判定を1つの形に作り替えた結果としてまとまる。

提案どおりに直さなかったもの:

- **I-01 の `--git-dir`** — rust は「`--git-dir` も拾って解決する」を提案したが、**deny 側へ落とした。**
  `--git-dir` は作業ツリーを一意に決めない（`--work-tree` が無ければ cwd が作業ツリーになる）ので、
  解決したつもりで別のツリーを検証する余地が残る。H-01 の「決められないなら deny」を適用した

自分が作った退行: I-02（`-C` の取りこぼし）と I-03（`err.path` の反転）と I-08（`cargo doc` の警告）は
いずれも**前ラウンドの修正が持ち込んだもの**。報告書に記録した上で直した。

## 検証

`npm run verify:rust` を通した。book のテストは 47件。
`bash .claude/hooks/verify-gate.test.sh` も通した（判定のケース 15 + 宛先のケース 11）。
`cargo doc --no-deps` の book に関する警告は0。
