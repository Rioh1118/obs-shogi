# レビュー book-foundation ラウンド2

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/` 全7ファイル、`src-tauri/src/lib.rs` の book 登録部分、`.claude/hooks/verify-gate.sh`
- 走らせた reviewer: rust / robustness / comment
- 対象コミット: `ca58b13`
- 前ラウンド: `.claude/reviews/2026-08-30-book-foundation-r1.md`

R1 の修正で新しく入った問題を見る回。3体とも「前回の修正が持ち込んだもの」を挙げた。

## 所見

### G-01 [HIGH] 持駒と盤面の駒数を通しで見ていないので、実在しない局面が正当なキーになる

robustness / comment / rust。`sfen.rs:169-189`, `sfen.rs:111-147`。

枚数の検査がトークン単位にしか掛かっていない。reviewer が実際に走らせた結果:

- `18P1P` → `Ok("19P")`、`18P18P` → `Ok("36P")`
- 上限が駒種によらず 18 なので `3R` / `5B` / `9G` が通る
- 盤面側も `KKKKKKKKK/9/9/9/9/9/9/9/9`（玉9枚）と歩81枚が通る

`19P` は同じ関数に入れ直すと `InvalidSfen` になるので、**`to_book_key` の出力が自身の入力として成立していない。**
F-04 が潰そうとした失敗（壊れた入力が「未収録」に化ける）が、合算のぶんだけ残っている。

→ 直す。駒種ごとの上限表を持ち、盤上と持駒を通しで数える。

### G-02 [MEDIUM] 盤面の空きマスの綴りを畳んでいないので、同じ局面が2つのキーになる

rust / robustness。`sfen.rs:104-107,111-147`。

`validate_board` は各段の合計が9かだけを見るので、`4k22` と `4k4` が両方通り**別のキー**になる。
持駒だけ畳んで盤面を畳んでいない。

→ 直す。畳む側に寄せる。あわせて冪等性（`to_book_key(k.as_str()) == k`）をテストで固定する。

### G-03 [HIGH] `to_book_key` の契約を on-the-fly の reader が守れない（**前回の直し方が誤り**）

comment。`sfen.rs:41-43`, `reader.rs:9`。

F-04 で「定跡ファイル側のキーもこの関数を通す」と決めたが、on-the-fly の `.db` reader は
**ファイル上の二分探索**で、ファイルに書かれた生のバイト列と直接比較する
（`research/findings/L3-book-solved.md:41`、同 `:131`「定跡DBは SFEN 文字列順に sort されている必要があります」）。
通したら二分探索の順序が壊れるので、この契約は #91 の実装者が守れない。

実際に効く条件は「`HAND_PIECES` の並びがやねうら王の書き出す順とバイト単位で一致していること」だが、
それはどこにも書かれておらず、並びを選んだ出典も無い。ズレていれば on-the-fly の全 lookup が静かに空を返す。

→ 直す。契約を「展開する reader」と「ファイル上を探索する reader」に割り、`HAND_PIECES` の並びが
外部仕様に従属することを、確認できている範囲を明示して書く。

### G-04 [MEDIUM] `BookKey` がファサードから漏れ、公開した `BookReader` が外から使えない

rust / robustness / comment の3体。`mod.rs:11-24`, `reader.rs:32`。

F-05（newtype 化）と F-10（サブモジュール private 化）を別々に入れた結果、
`BookReader::lookup(&self, key: &BookKey)` の `BookKey` を `book` の外から名指しできない（E0603）。
公開されているのに実装も呼び出しもできない。`cargo doc` にも `BookKey` は出ない。

3体とも「reader は `book` の内側でしか作らせない方針（`mod.rs` の doc がそう宣言している）なら
`BookReader` を facade から落とす」を勧めている。

→ 直す。落とす側を採る。あわせて `BookState` のメソッドを `pub(crate)` に降ろす（G-12）。

### G-05 [MEDIUM] symlink を開くと `BookInfo` の `format` と `path` が別のファイルを指す

rust / robustness。`api.rs:34-51`。

形式は渡された綴りから、`path` は解決後の実体から作るので、
`~/books/latest.db -> apery_book.bin` を開くと `BookInfo { path: ".../apery_book.bin", format: yaneuraouDb }`
という自己矛盾した値がフロントへ渡る。`BookInfo.path` はフロントが持つ唯一のパスなので、
それで開き直すと別形式の reader ができる。

→ 直す。解決後の拡張子と要求時の拡張子が食い違うなら拒否する。

### G-06 [MEDIUM] `close_book` / `close_all_books` が、閉じ終わっているのに失敗として返る

robustness。`api.rs:139-152,167-173`。

`state.close` が成功した時点でハンドルは無効。その後の join が失敗すると `Unknown` が返るので、
利用者は「閉じられなかった」と読んで再試行し、`InvalidHandle` で行き止まりになる。
実際には閉じ終わっている。`close_all_books` は件数まで捨てる。

→ 直す。除去が済んだ後の join 失敗はログに落として成功を返す。

### G-07 [MEDIUM] 利用者に見せるメッセージに Rust の識別子と OS の英語が出る

rust。`reader.rs:67-71`, `error.rs:90`。

`open_reader` は今どの経路でも成功しないので、**定跡を開いた利用者が必ず見る文字列が
「YaneuraouDb の reader をまだ持っていない」**になる。enum のバリアント名で、次に何をすればよいかも無い。
io 側は「定跡ファイルを読めない: Permission denied (os error 13)」。

→ 直す。`BookFormat` に表示名を持たせ、io は kind ごとに次の操作まで書く。

### G-08 [MEDIUM] `BookInfo.path` の「実体のパス」を型が持っていない

rust。`session.rs:46-54`, `types.rs:72`。

`register(path: String, ...)` は任意の文字列を受けるので、doc だけが静かに嘘になりうる。
F-05 で `BookKey` を newtype にした理由と同じ性質が、こちらは `String` のまま残っている。

→ 直す。`PathBuf` を受ける形にして、文字列を組み立てて渡す経路を消す。

### G-09 [MEDIUM] 検証ゲートが `git -C <dir> commit` を素通しする

rust。`.claude/hooks/verify-gate.sh:18`。

正規表現の `-[^[:space:]]+` は値を取るオプションを許さないので、`git -C /tmp/wt commit -m x` は
`commit` に到達せず**ゲート全体が素通し**になる。今回直した「ワークツリーで別のツリーを検証する」
という不具合の、最も自然な回避手段がゲートを完全に外す形になっている。
ファイル冒頭の「逃げ道は用意しない」と噛み合わない。

→ 直す（値を取るオプションを許す）。

### G-10 [MEDIUM] 手数の数値検査に付けた理由が、その検査が守っているものと違う

comment。`sfen.rs:90-102`。reviewer が変異で確認: 数値検査を削っても
`rejects_a_position_with_moves` は通る。`moves` を止めているのは直前の行。

→ 直す。

### G-11 [MEDIUM] `close_all` が2段構えなのは dashmap の deadlock 回避だが、理由が無い

comment。`session.rs:110-116`。dashmap 6.1.0 の `remove` は map への参照を握ったまま呼ぶと
deadlock しうる（`dashmap-6.1.0/src/lib.rs:478`）。1段に畳むとコマンドがアプリを固める。

→ 直す。

### G-12 [MEDIUM] `mod.rs` の「定跡を開く唯一の経路は open_book」が可視性で成立していない

comment。`mod.rs:6-9`, `session.rs` の各 `pub`。`BookState` のメソッドが全て `pub` なので、
`book` の外で `BookReader` を実装して `register` を呼ぶ経路が開いている。
`book` の外から使われているのは `BookState::new()` だけ。

→ 直す。G-04 と同じ修正で閉じる。

### G-13 [MEDIUM] `cargo doc` が警告を出す（公開 doc から private 関数へのリンク）

comment。`api.rs:21`。`public documentation for open_book links to private item validate_book_path`。

→ 直す。

### G-14 [MEDIUM] `open_book` の doc に「今は必ず失敗する」が書かれていない

comment。`api.rs:14`。事実が書いてあるのは private な `open_reader` の `//`（非 doc）だけ。

→ 直す。

### G-15 [MEDIUM] 「数百万個の String の解放」がまた根拠の無い量的主張

comment。`session.rs:84-85`, `api.rs:155-157`。on-the-fly の reader は Drop してもファイルハンドルが
閉じるだけで、`String` の山は解放されない。F-12 で撤回した「数百 MB」と同じものが別の場所で復活している。

→ 直す。条件付きの言い方にし、件数は書かない。

### G-16 [MEDIUM] `LookupBookMovesInput.sfen` の「手数は無視される」が実装と食い違う

comment。`types.rs:92-94`。実際は書式を検査し、数値でない手数・`moves`・余りは `InvalidSfen`。

→ 直す。

### G-17 [MEDIUM] F-15 が部分的にしか直っていない

comment。`BookInfo.handle` / `.format`、`BookState::new` / `is_empty`、`BookKey::as_str` が裸のまま。
ばらつきは「どこまで書くのが正か」の判断が無いことの表れ。

→ 直す。「型から読めるものは書かない」で統一する。

## 重複・矛盾した所見

- G-01 / G-02 は3体が別の入口から同じ根に当たった。「入力の検査が値の妥当性まで届いていない」1件と見て、
  **駒数の通し検査（G-01）と綴りの正規化（G-02）を分けて直す。** 冪等性テストは両方を同時に固定する
- G-04 / G-12 は同じ可視性の穴。rust は「(a) `BookKey` も公開する / (b) `BookReader` を落とす」の両論、
  robustness と comment は (b) を推した。**(b) を採る。** `mod.rs` の doc が既に (b) を宣言している
- G-03 は R1 の F-04 の直し方に対する反証。**再提出として受ける**
- G-07 の io メッセージについて rust は「OS の原文は message ではなくログへ」と提案したが、
  `logged` が出すのは `Display`（= message を含む）なので、message から落とすと**ログからも消える**。
  次の操作を書いた日本語を前に置き、OS の原文はその後ろに残す形で部分採用する

## 見ていない範囲

- フロント側（`src/`）。`invoke("open_book")` は依然0件。エラー種別ごとの復帰導線は #91 以降に別途レビューが要る
- 実際の定跡ファイルでの動作。`open_reader` は必ず `Err` を返すので `canonicalize` 以降は本番で一度も動いていない
- やねうら王本体の `source/book/book.h` と `Position::sfen()`。`HAND_PIECES` の並びは repo 内の調査ノート
  （`research/findings/L3-book-solved.md`）までしか確認できていない
- `tauri::async_runtime::spawn_blocking` の join が `Err` を返す条件（tauri のソースまで降りていない）
- `close_all` の deadlock 可能性はライブラリの doc からの推論で、再現実験はしていない（ハングするため）
- `cargo audit`（dashmap 6.1.0）
- ゲートの誤発火側（クォート内の `git ... commit` で発火する）。実際にこのラウンド中に1回起きた

## lint / hook で強制できるもの

- **冪等性テスト `to_book_key(k.as_str()) == k`** — G-01 と G-02 の両方を1本で固定する。今回で最も効く
- **`#![warn(unreachable_pub)]`** — facade から漏れた公開型（G-04）を機械で拾える。
  ただし crate 全体に掛かり、既存の `search` / `engine` にも波及するので今回は入れない
- **`RUSTDOCFLAGS="-D warnings" cargo doc --no-deps`** — G-13 を機械で止められる。
  ただし `src/engine/types.rs:160,163,186` に既存の警告が3件あり、先にそちらを消す必要がある
- **ゲートの正規表現のケース表テスト** — 判定は純粋な文字列関数なので `.claude/hooks/` 内で完結して検証できる
- G-03 / G-05 / G-06 / G-07 / G-10 / G-11 / G-15 / G-16 は機械では拾えない

## 次ラウンドの対象

直すもの: G-01〜G-17（全件）。見送りは無し。

---

## 修正結果

| 所見 | 結果 | コミット | 備考 |
| ---- | ---- | -------- | ---- |
| G-01 | 直した | `4583b54` | 駒種ごとの上限表を持ち、盤上と持駒を通して数える |
| G-02 | 直した | `4583b54` | 空きマスを畳む。冪等性のテストで固定 |
| G-03 | 直した | `4583b54` | 契約を「展開する reader」「ファイル上を探索する reader」に割り、`HAND_PIECES` の並びが外部仕様に従属することと、確認できている範囲を書いた |
| G-08 | 直した | `a735fe8` | `register` が `PathBuf` を受ける |
| G-04 | 直した | `64c618a` | `BookReader` / `BookSession` / `BookKey` を `pub(crate)` に。ファサードにはコマンドとワイヤ型だけ |
| G-12 | 直した | `64c618a` | 同上。`BookState` の操作も `pub(crate)` |
| G-05 | 直した | `444e2c7` | 指定と実体の形式が食い違うなら開かない。`display_name` を追加 |
| G-06 | 直した | `418e6c9` | 除去後の join 失敗はログに落として成功を返す |
| G-07 | 直した | `fe393d0` | 形式は表示名で出す。io は次の操作まで書く |
| G-09 | 直した | `79695f0` | ゲートの正規表現が値付きオプションを越える |
| G-10 | 直した | `422a2d8` | 数値検査に自分の理由を書く |
| G-11 | 直した | `46bb1a8` | dashmap の deadlock 回避であることを書く |
| G-13 | 直した | `f40a9bd` | private へのリンクを外す。`cargo doc` の book 警告は0 |
| G-14 | 直した | `f40a9bd` | 「#91 まで常に UnsupportedFormat」を公開 doc に |
| G-15 | 直した | `1aa18db` | 量的主張を、当てはまる reader の条件付きに |
| G-16 | 直した | `54a8d97` | 「手数は無視される」を実装に合わせる |
| G-17 | 直した | `6a02fae` | 「型名から読めないものにだけ付ける」と mod doc に決めを書く |

提案どおりに直さなかったもの:

- **G-01 の上限** — robustness は「先後合計で見れば足りる」としたが、**玉だけは先後それぞれ1枚**を
  別に見ている。合計2枚の検査では「0対2」を弾けない。**この差はテストでも一度落とした**（下記 M15）
- **G-07 の io メッセージ** — rust は「OS の原文は message ではなくログへ」としたが、
  `logged` が出すのは `Display`（= message を含む）なので、message から落とすとログからも消えて
  切り分けができなくなる。日本語の案内を前に置き、原文は括弧で後ろに残す形にした
- **G-09 の誤発火側** — 値付きオプションの穴（＝素通し）だけを塞ぎ、クォート内の文字列で発火する側は
  直していない。誤発火は余分な検証が走るだけで、素通しは検証されないまま通る。**危険の向きが違う。**
  正しく直すにはシェルの構文解析が要る
- **G-04 で `BookKey::as_str` / `BookState::len` / `is_empty` が dead code になった** —
  `#[cfg(test)]` で塞いだ。`as_str` は #91 の reader が使うものなので `TODO(#91)` を添えてある

コミットの粒度: G-01 と G-02 は同じ関数の同じ書き換えで、戻すときも一緒に戻すので1コミットにした。
G-13 と G-14 は同じ doc ブロックの隣り合う行なので同様。それ以外は1所見1コミット。

自分が作った退行: 無し。ただし **G-04 の可視性を絞った結果、テストからしか呼ばれない項目が3つ露出した**
（上記）。塞ぎ方は `#[cfg(test)]`。

## 変異による確認

R2 で足したテストにも変異を当てた。

| # | 壊した箇所 | 結果 |
| - | ---------- | ---- |
| M13 | 駒数の通し検査をしない | `rejects_more_pieces_than_the_set_holds` が落ちた |
| M14 | 空きマスを畳まず元の綴りを使う | 5件落ちた（冪等性テストを含む） |
| M15 | 同じ側の玉2枚を見逃す | **最初は落ちなかった。** 盤面に先手の玉も置いていたので合計3枚になり、駒種ごとの合計の検査で先に落ちていた。玉を後手2枚だけにした盤面へ直して、片側の検査でしか落ちないことを確認（`105ba38`） |
| M16 | リンク先の形式の食い違いを見ない | `rejects_a_link_that_points_at_another_format` が落ちた |

## 検証

`npm run verify:rust` を通した。book のテストは 43件。`cargo doc --no-deps` の book に関する警告は0。
TS 側は触っていない。
