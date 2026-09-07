# レビュー book-foundation ラウンド3

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/` 全7ファイル、`src-tauri/src/lib.rs` の book 登録部分、`.claude/hooks/verify-gate.sh`
- 走らせた reviewer: rust / robustness / comment
- 対象コミット: `105ba38`
- 前ラウンド: `2026-08-30-book-foundation-r1.md` / `-r2.md`

R2 の修正が持ち込んだものを見る回。**3体とも「前ラウンドの直し方が不完全」を出した。**

## 所見

### H-01 [HIGH] ゲートが `-C <dir>` を検出しても、検証するのは hook の CWD のツリー

rust。`verify-gate.sh:22-23,30-32`。R2 の G-09 は `git -C <worktree> commit` を**検出**できるように
正規表現を広げたが、その後で `project_dir` に使うのは `git rev-parse --show-toplevel`（hook の CWD）のまま。

失敗の筋道: CWD が wt-53（docs のみ変更）で `git -C .claude/worktrees/wt-90 commit` を実行すると、
`git status` は wt-53 を見て `needs_rust=0` になり素通し。**wt-90 の `.rs` 変更は一度も検証されずに通る。**
R2 が `CLAUDE_PROJECT_DIR` を捨てた理由と同じ失敗を、同じラウンドの拡張が明示的に開けていた。

→ 直す。`-C` / `--work-tree` の値を取り出して、その先を検証する。決められないなら deny。

### H-02 [MEDIUM] 正規表現がまだ素通しする（G-09 の直し方が不完全）

rust が実測した表:

```
git -C /tmp/wt commit -m x                                CAUGHT
git --git-dir=/tmp/x/.git commit -m x                     CAUGHT
git --git-dir /tmp/x/.git commit -m x                     BYPASS
git --work-tree /tmp/x --git-dir /tmp/x/.git commit -m x  BYPASS
git --namespace foo commit -m x                           BYPASS
```

`--(git-dir|work-tree|namespace)` を `=` 形しか許していなかった。git は空白区切りも受ける。

→ 直す。両方の形を許す。**判定は純粋な文字列関数なのでケース表のテストを置く。**

### H-03 [MEDIUM] 形式を検査したパスと reader が開くパスが別（G-05 の直し方が不完全）

rust。`api.rs:46-74`。検査は `path` と `canonical` を突き合わせるのに、reader には `path` を渡していた。
`open_reader` は `metadata` で symlink をもう一度たどるので、検査した解決結果と実際に開くファイルが
別物になりうる。張り替えが挟まると `BookInfo.path` が旧いファイルを指したまま reader は新しい方を読む。

→ 直す。`open_reader(&canonical)` にして解決を1回に減らす。

### H-04 [MEDIUM] 検査順序が、本番経路では doc とテストの逆になっている

rust / robustness。`api.rs:46-58` と `reader.rs:37-39,89-95`。`open_at` は `canonicalize` を先に呼ぶので、
存在しない `.txt` に `UnknownExtension` ではなく `NotFound` が返る。R1 の F-12 で決め、変異 M5 で固定した
順序が**唯一の本番呼び出し元で反転**していた。テストが `open_reader` を直接叩いていたので気づけない。

→ 直す。順序を戻し、コマンド経路のテストでも固定する。

### H-05 [MEDIUM] `#[cfg(test)]` で塞いだ `BookKey::as_str` が、契約上必要な口を消していた

robustness。`sfen.rs:12-21`。`BookKey` のフィールドは private で、唯一の取り出し口が
`#[cfg(test)]` になったので**本番ビルドでは完全に不透明**。`sfen.rs` が明文化した
「ファイルに書かれた綴りとキーを直接比較する reader」（G-03 で足した契約）が書けない。
R2 の dead code の処置が、この trait の主要な実装形態そのものを塞いでいた。

→ 直す。`#[allow(dead_code)]` に置き換える。

### H-06 [MEDIUM] リンク先の拡張子が未知だと、利用者が選んでいないパスについて答える

robustness。`api.rs:57-69`。`resolved` を `?` で返していたので、`latest.db -> plain` では
`UnknownExtension` と**解決後のパス**が返る。利用者は `latest.db` を見て「拡張子は .db なのに」と読む。

→ 直す。判別できない場合も食い違いとして扱い、`path` には利用者が渡した綴りを載せる。

### H-07 [MEDIUM] `HAND_PIECES` の出典に挙げた調査ノートに、持駒順の記録が無い

comment。`sfen.rs:44-50`。`research/findings/L3-book-solved.md` を全文検索しても
「持駒」も「RBGSNLP」も0件。G-03 はこの依存を明示するための修正だったので、根拠が空だと効果が反転する。

→ 直す。「USI の慣例に合わせた並び。一次資料とは未突合」と書き、`TODO(#91)` を付ける。

### H-08 [MEDIUM] `close_book` の doc が、この関数が走らないスレッドを理由にしている

comment。`api.rs:171-182`。async な `#[tauri::command]` は `async_runtime::spawn` に載るので
IPC を受けたスレッドでは実行されない。`spawn_blocking` を外して実際に起きるのは
「tokio ワーカが埋まって他のコマンドの応答が止まる」。同じファイルの `open_book` は正しく書いている。

→ 直す。

### H-09 [MEDIUM] 「玉はここで弾かれる」が、弾いていない行に付いている

comment。`sfen.rs:291-300`。`PieceCounts::add` は盤上の玉を数えるために `K` を受け付ける。
実際に弾いているのは4行上の `position(...)` の `?`。

→ 直す。

### H-10 [MEDIUM] 持駒の枚数の上限が、数え上げの歯止めであることが書かれていない

comment。`sfen.rs:280-289`。`count > 18` は妥当性の検査ではなく `add_many` のループを有限回に
留める唯一の歯止め。隣のコメントが「駒種ごとの上限は後段が見る」としか書いていないので重複に見える。
外すと `"4294967295P"` の1回で async ランタイムのワーカが埋まる。

→ 直す。理由を書き、テストで固定する。

### H-11 [MEDIUM] `flush_empty` の「9マスまでしか溜まらない」が成り立っていない

comment。`sfen.rs:252-258`。列数の検査は段を読み切った後なので、`"99"` という段では 18 のまま入る。
1桁前提に書き換えると利用者由来の文字列で panic する。

→ 直す。

### H-12 [MEDIUM] `OpenBookInput.path` にだけ値の条件が書かれていない

comment。`types.rs:93-97`。隣の `LookupBookMovesInput.sfen` はフィールドに条件を書いている。
`mod.rs` に決めた「型名から読めないものにだけ付ける」に照らすと、書くべき側の代表例。

→ 直す。条件はワイヤ型のフィールドに置く、で揃える。

## 重複・矛盾した所見

- H-03 / H-04 / H-06 は rust と robustness が独立に `open_at` を指した。**全て「symlink の解決を
  どこで1回だけ行うか」を決めていなかったことに帰着する。** 解決を canonicalize の1回に寄せて、
  形式の判別・reader・`BookInfo.path`・エラーの `path` を同じ基準に揃える形で3件まとめて閉じる
- H-01 / H-02 は同じ関数の別の穴。**素通し（検証されないまま通る）と誤発火（余分に検証が走る）は
  危険の向きが違う。** 今回は素通しだけを塞ぎ、誤発火は残す
- robustness は `PieceCounts` を単体クレートに切り出して駒落ち・詰将棋型・成駒だらけ・持駒の境界を
  実測し、「正当な局面を弾く例も、駒箱を超える局面を通す例も見つからなかった」と明示した。
  玉0枚・二歩・行き所のない駒を通すのは、任意の閲覧局面を受ける以上**意図的な寛容さとして妥当**と判断

## 見ていない範囲

- フロント側（`src/`）。`invoke("open_book")` は依然0件
- 実際の定跡ファイルでの動作。`open_reader` は今も必ず `Err` を返す
- やねうら王 `Position::sfen()` と `source/book/book.h` の一次資料（R1 から変わらず）
- Windows / Linux でのパス挙動。`canonicalize` と symlink の実測は macOS のみ。Windows の `\\?\` 前置きが
  `BookInfo.path` に出る点は未確認
- ネットワークマウント上での `canonicalize` / `metadata` のハング
- `spawn_blocking` の join が `Err` になる条件、`drop_in_background` の future が cancel されたときの挙動
- `cargo audit` / dashmap の deadlock 可能性（ライブラリ doc からの推論のまま）

## lint / hook で強制できるもの

- **ゲートの判定のケース表テスト** — R2 と R3 の2回とも挙がった。**今回置いた**（`verify-gate.test.sh`）
- **検査順序を本番呼び出し元に対して書くテスト** — R2 の変異 M5 が `open_reader` 止まりだったのが
  H-04 の穴の原因。**今回 `open_at` に対しても書いた**
- **`"4294967295P"` のテスト** — H-10 の歯止めを外すとテストが目に見えて遅くなる。**今回置いた**
- `#[expect(dead_code, reason = ...)]` は `#[allow]` より良いが、`Cargo.toml` の
  `rust-version = 1.77.2` では使えない（`expect` は 1.81 以降）。**採らなかった**
- H-01 / H-03 / H-07 / H-08 / H-09 / H-11 / H-12 は機械では拾えない

## 修正結果

| 所見 | 結果 | コミット |
| ---- | ---- | -------- |
| H-04 | 直した | `5311192` |
| H-03 | 直した | `ddf1d62` |
| H-06 | 直した | `9ad711a` |
| H-05 | 直した | `541a3f9` |
| H-07 | 直した | `5b6d17c` |
| H-08 | 直した | `6232322` |
| H-09 | 直した | `28db207` |
| H-10 | 直した | `05b3d17` |
| H-11 | 直した | `87097b5` |
| H-12 | 直した | `72ab654` |
| H-01 | 直した | `0057f54` |
| H-02 | 直した | `0057f54` |

提案どおりに直さなかったもの:

- **H-01 の直し方** — rust は「(b) ディレクトリを付け替えるオプション付きの commit を一律 deny」も挙げたが、
  **(a) 値を取り出してその先を検証する**を採った。ワークツリー運用が前提のこの repo で
  `git -C` を一律に禁じると、正当な操作まで止まる。ただし取り出した値が git リポジトリでなければ deny する
- **H-02 の誤発火側** — 直していない。クォート内の `git ... commit` で発火するのは余分な検証が走るだけで、
  素通しは検証されないまま通る。正しく直すにはシェルの構文解析が要る
- **H-05 の `#[expect]`** — MSRV が 1.77.2 なので使えない。`#[allow(dead_code)]` + `TODO(#91)` にした

`verify-gate.sh` は判定部分を関数に切り出した。`GATE_LIB_ONLY=1` で読み込むと関数だけが定義され、
テストから判定を直接呼べる。ケース表は `.claude/hooks/verify-gate.test.sh`（`bash` で単体実行）。
`npm run verify` には載せていない — ワークツリーには `node_modules` が無く、`package.json` を触ると
Rust だけの変更でも TS 側の検証が走ってしまうため。

## 検証

`npm run verify:rust` を通した。book のテストは 44件。`bash .claude/hooks/verify-gate.test.sh` も通した。
