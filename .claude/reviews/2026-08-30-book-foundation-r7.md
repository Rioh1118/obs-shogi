# レビュー book-foundation ラウンド7

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/` 全7ファイル、`src-tauri/src/lib.rs` の book 登録部分、`.claude/hooks/verify-gate.sh` / `verify-gate.test.sh`
- 走らせた reviewer: rust / robustness / comment
- 前ラウンド: `-r1.md`〜`-r6.md`（計73件）

## 所見

### L-01 [HIGH] commit の検出が行単位・`git` の綴り前提なので、当たらない綴りは deny も検証もされない

rust。`verify-gate.sh:25-33`。`gate_matches_commit` が false なら `exit 0`。
**deny も検証も走らない完全な素通しで、`gate_target_dir` の deny 側にすら落ちない。** 実測:

```
git \ + 改行 +   commit -m x       SKIP（素通し）
/usr/bin/git commit -m x           SKIP（素通し）
'git' commit -m x                  SKIP（素通し）
\git commit -m x                   SKIP（素通し）
$(which git) commit -m x           SKIP（素通し）
```

grep は行単位なので `git` と `commit` の間に行継続が入ると成立しない。
**この repo のコミットはヒアドキュメントを含む複数行コマンドで打つのが常なので、現実に踏む形。**

R6 は `gate_target_dir` を白リストに変えたが、そこへ入る唯一の入口が黒リスト型の正規表現のままだった。

→ 直す。1行に畳み、`git` の前置き（パス修飾・引用・エスケープ）を飲む。
それでも切り出せないのに `git` と `commit` が並んでいるなら deny に落とす。

### L-02 [HIGH] `GIT_DIR=` / `GIT_WORK_TREE=` / `nohup` / `ssh` が deny されない

rust / comment。`verify-gate.sh:69-72`。手前を拒否リストで見ているので、列挙外の綴りが通る。実測:

```
GIT_DIR=/tmp/other/.git GIT_WORK_TREE=/tmp/other git commit -m x -> <here>
nohup git commit -m x                                            -> <here>
ssh host git commit -m x                                         -> <here>
```

rust は実際に repo a / b を作り、cwd を a にしたまま `GIT_DIR=…/b/.git GIT_WORK_TREE=…/b git commit`
でコミットが b に入り、ゲートが検証するのは a であることを確認している。

**R6 は方針（白リスト）を doc に書いただけで、判定は列挙のままだった。**

→ 直す。手前に置いてよいのは「ディレクトリ指定の無い git 呼び出し」だけ、という白リストにする。

### L-03 [MEDIUM] `resolve_lookup` が SFEN 検査の失敗で `Arc` を async ワーカ上に落とす

rust / robustness。`api.rs:201-208`。`get` の doc（K-05 で足した「落とす場所は blocking プールに」）を、
**`get` の唯一の本番呼び出し元が失敗の枝で破っていた。**
`to_book_key` が `InvalidSfen` を返す間に `close_book` が map から外していれば、
この `Arc` が最後の参照になり reader の Drop が async ワーカで走る。

F-06 → K-05 と2度潰した性質の3度目。

→ 直す。ハンドルの生死は `info` で先に見て、`Arc` は失敗しない位置でだけ取る。

### L-04 [MEDIUM] `open_book` の doc が symlink の形式食い違いで成り立たない

comment。`api.rs:23-25`。`link.db -> target.bin` は「形式が判別できて実体がファイル」の条件を満たすが
`InvalidPath` になる。**J-08（常に UnsupportedFormat）、K-09（ディレクトリ）に続いて3回目。**
いずれも「返る種別を列挙する」形が原因で、列挙は検査が増えるたびに嘘になる。

→ 直す。列挙をやめ、検査の順序を書く。

### L-05 [MEDIUM] リネーム行を新しい方だけ見るので、`.rs` を別拡張子へ改名すると検証が走らない

comment。`verify-gate.sh:108-121`。`git mv src/a.rs src/a.txt` を stage して commit すると
`needs_rust=0` になる。コメントが「新しい方だけを見れば足りる」と断言しているので、次に触る人は疑わない。
このブランチが持ち込んだ行ではないが、書かれた理由が条件と一致していない。

→ 直す。両側を見る。

### L-06 [MEDIUM] `lookups_on_a_closed_handle_say_to_open_it_again` が `info` の経路も一緒に固定している

comment。`session.rs:263-276`。`info` の呼び手は `get_book_info` で「引く」経路ではない。
R6 K-10 と同じ形。

→ 直す。名前と doc を両方の経路を含む形にする。

## 重複・矛盾した所見

- L-03 は rust と robustness が独立に同じ場所を指した。robustness は `resolve_lookup` を廃して
  `lookup_inner` に畳む案、rust は `info` を先に呼ぶ案。**後者を採った。** 前者は「ハンドルを先に見る」
  順序を固定しているテスト（`reports_a_closed_handle_before_a_broken_position`）の対象関数が消える
- L-01 / L-02 はどちらも「R6 で白リストに変えたつもりの箇所が、実際には黒リストのまま残っていた」。
  入口（検出）と手前（prefix）の2箇所

## 見ていない範囲

- フロント側（`src/`）。呼び出しは R1 から0件のまま
- 実際の定跡ファイルでの動作。`open_reader` は今も必ず `Err`
- やねうら王 `source/book/book.h` / `Position::sfen()` の一次資料
- Windows / Linux の実行時挙動。実測は macOS のみ
- ゲートを実際の PreToolUse payload で end-to-end 実行していない（判定関数は `GATE_LIB_ONLY=1` で実測）
- 意図して見送っている4件（issue #197 / ゲートの誤発火側 / 検査と使用の窓 / Windows CI）は再提出されていない
- comment は R6 で足した doc の条件と実装の対応（`BookState::info` / `invalid_handle` の `recovery` /
  `annotate` / `read_link` の枝 / `position_count: Option<u64>`）が**全て一致している**と確認し、
  `TODO(#91)` 3箇所も #91 で消せる形、変更の経緯の混入は0件と明示している

## lint / hook で強制できるもの

- **判定表に行を跨ぐ綴りを入れる** — 現在の表は全て1行の文字列で、grep が行単位であることを一度も
  踏んでいなかった。**今回 `printf 'git \\\n commit'` の行を足した**
- **宛先表に環境変数の前置を入れる** — `GIT_DIR=` / `GIT_WORK_TREE=` / `GIT_INDEX_FILE=` /
  `nohup` / `ssh` / `npm run build &&` を deny 期待で足した
- **`gate_mentions_commit` の表** — 切り出せない綴り（`$(which git)` / `x=git; $x commit`）を
  CATCH、無関係な綴り（`npm run commit-helper` / `echo commit`）を SKIP として固定した
- **L-03 は機械では拾えない。** `Arc` の落ちる場所は型でも lint でも表せず、外から観測もできない
  （map 側の参照が残っているので strong_count でも判別できない）。**構造で閉じただけで、
  テストでは固定していない。** これは明示しておく

## 修正結果

| 所見 | 結果 | コミット |
| ---- | ---- | -------- |
| L-03 | 直した | `f111671` |
| L-04 | 直した | `f111671` |
| L-06 | 直した | `f111671` |
| L-01 | 直した | `5a4ebe1` |
| L-02 | 直した | `5a4ebe1` |
| L-05 | 直した | `5a4ebe1` |

提案どおりに直さなかったもの:

- **L-02 の白リストの粒度** — comment は `git add|rm|mv|stage` の列挙を提案したが、
  **`git` で始まりディレクトリ指定を含まない呼び出し**という形にした。サブコマンドの列挙は
  拒否リストと同じ問題（次の綴りに置いていかれる）を持つ
- **L-01 の最後の網** — 「`commit` という部分文字列があれば deny」までは広げず、
  `git` と `commit` が**両方**語として現れる場合に限った。`npm run commit-helper` や
  `echo commit` まで止めると、誤発火が「余分な検証」ではなく「解除手段の無い停止」になる

## 検証

`npm run verify:rust` を通した。book のテストは 51件。
`bash .claude/hooks/verify-gate.test.sh` も通した（判定 26 / 綴り 5 / 宛先 27）。
