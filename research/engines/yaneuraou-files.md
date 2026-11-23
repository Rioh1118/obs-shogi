# やねうら王が自分で読むファイル（2026-11-21）

**GUI が `setoption` で渡したもの以外に、やねうら王が自分で探して読むファイルの事実。** 方針は書かない。
方針は [features/book.md](../../docs/spec/features/book.md) と
[features/eval-files.md](../../docs/spec/features/eval-files.md) が持つ。

出典は2つ。

- ソース: `yaneurao/YaneuraOu` の `master`（`2deff5b2`、2026-11-20）。GPL-3.0。ここには書き写さず、ファイルと関数の名前で指す
- 実測: 手元の macOS arm64 で、次の2本に行を送った結果

| 実行ファイル                                          | `id name`                    |
| ----------------------------------------------------- | ---------------------------- |
| `YaneuraOu_SFNN_halfka2_1024_7_64_k3k3-V990DEV_APPLEM1` | （V9.90 開発版）             |
| `YaneuraOu_NNUE_halfkp_768x2_16_64-V900Git_APPLEM1`     | `YaneuraOu NNUE V9.00Git 64APPLEM1 TOURNAMENT` |

## 定跡

### `BookFile` は選択肢で、`.ybb` の名前は選択肢に無い

`BookFile` は `combo` で、選択肢は `no_book` / `standard_book.db` / `yaneura_book1〜4.db` /
`user_book1〜3.db` / `book.bin` の10個（`source/book/book.cpp` の `book_list`）。**`.ybb` の名前は1つも無い。** [確定]

### `.db` の名前を受けて、無ければ同じ名前の `.ybb` を読む

`BookDir` と `BookFile` を繋いだパスにファイルが無く、末尾が `.db` なら、末尾を `.ybb` に替えたパスを読む
（`book.cpp` の `resolve_book_filename_with_ybb_fallback`）。切り替えたときは
`info string book file fallback : <.db のパス> -> <.ybb のパス>` を出す。[確定]

`.ybb` だけを置いた `book/`（1,573,291,616 バイト）で送った結果（V9.90 開発版）:

| `BookFile` に送った値      | 起きたこと                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `user_book1.db`            | `book file fallback` の行のあと `read book file : <.ybb の絶対パス>` を出して読み、17,000,703 局面。定跡の手で指した |
| `user_book1.ybb`           | `combo value not found` を出して値を捨て、既定の `standard_book.db` を読みに行き `can't read file`。`readyok` は返る |
| `.ybb` の絶対パス          | 同上                                                                                                            |

**`.ybb` の名前やパスを送ると、エラーの行が1つ出るだけで、定跡なしで指し続ける。** [確定]

**V9.00 は `.ybb` を読まない。** 同じ `book/`（`.ybb` だけ）に `user_book1.db` を送ると、
`read book file : <.db のパス>` と `Error! : can't read file : <.db のパス>` の2行を出して
`readyok` を返し、定跡なしで動く。`book file fallback` の行は出ない（2026-11-23 実測）。[確定]
`.ybb` を読み始めた版は確かめていない。

同じ名前の `.db` と `.ybb` が両方あるときは、`.db` が先に存在するので `.db` を読む
（同じ関数。`.ybb` を読ませる綴りは無い）。[確定・ソースのみ]

### 優先定跡: `<名前>-000.db` から順に、本体より先に引く

`BookFile` が `user_book1.db` なら、同じフォルダの `user_book1-000.*`、`user_book1-001.*` … を
番号が途切れるまで読み、最後に `user_book1.db` を読む。引くときは読んだ順で、先に当たったものを使う
（`book.cpp` の `get_book_names` / `resolve_priority_book_filename` / `find_in_books`）。
各番号は `.db` と `.ybb` のどちらでもよい。[確定]

実測: 初期局面に `7g7f` だけを持つ `user_book1-000.db` と、`2g2f` だけを持つ `user_book1.db` を置くと、
両方を読んだと言ったうえで **`bestmove 7g7f`**（優先定跡の手）を返した。[確定]

## 評価関数フォルダの `eval_options.txt`

`isready` を受けると、`setoption` を全部反映した後に、実行ファイルの隣の `engine_options.txt` と、
`EvalDir` の中の `eval_options.txt` を読み、書かれたオプションを**上書きする**
（`source/usi.cpp` の isready の処理。読む順はこの2つの順）。[確定]

実測（V9.90 開発版）。`EvalDir` に `FV_SCALE 24` と書いた `eval_options.txt` を置き、`setoption name FV_SCALE value 40` を送った:

- `info string engine option override. name = FV_SCALE , value = 24` を出した
- `getoption FV_SCALE` は **24**（送った 40 ではない）

`eval_options.txt` を `EvalDir` の外（評価関数フォルダの1つ上）に置いた場合は読まず、`FV_SCALE` は既定の **16** のままだった。[確定]

## 評価関数の型

評価関数ファイル（`nn.bin`）の先頭には、型を表す文字列が入っている
（例: `Features=HalfKA2(Friend)[131949->1024x2],Network=SFNN-1024{LayerStack=9}`、
`Features=HalfKP(Friend)[125388->256x2],...`）。[確定・2ファイルを見た]

型の違う評価関数を読ませると、`isready` の後に `Error! : failed to read nn.bin : FileMissMatch` を出し、
`readyok` を返さない（V9.00Git の halfkp_768x2_16_64 版に HalfKA2 の `nn.bin` を渡した）。[確定]

実行ファイルの名前は型を含む（`YaneuraOu_SFNN_halfka2_1024_7_64_k3k3-...`）が、`id name` は含まない
（上の表）。**エンジンが申告する行から型は取れない。** [確定・この2本の範囲]

## 失効条件

- `BookFile` の選択肢に `.ybb` の名前が入るか、`combo` でなくなったら、定跡の節は測り直す
- `isready` で読むファイルの順が変わったら、`eval_options.txt` の節は測り直す
