# 語の対応と慣習

語の定義の正本は `CONTEXT.md`。ここは外の語との対応だけを持つ。
数は 461d7da5（2026-11-01）で `word-usage.mjs words` を走らせた値で、現在値ではない。

## 将棋の語

| 語         | USI                                | JKF                        | python-shogi                 | 英語の説明               | このリポジトリ                                    |
| ---------- | ---------------------------------- | -------------------------- | ---------------------------- | ------------------------ | ------------------------------------------------- |
| 指し手     | `moves`、`bestmove`                | `moves`、`move`            | `Move`                       | move                     | `move` 113、`te` 8                                |
| 局面       | `position`、`sfen`                 | 語なし                     | `Board`、`sfen()`            | position                 | `position` 100、`board` 29（盤そのもの）          |
| 持ち駒     | SFEN の欄                          | `hands`                    | 語なし                       | pieces in hand           | `hand` 46                                         |
| 成り       | 末尾の `+`                         | `promote`                  | 末尾の `+`                   | promotion                | `promote` 7                                       |
| 打         | `G*5b`                             | `from` なし、相対の `H`    | `B*4b`                       | drop                     | `drop` 33                                         |
| 手数       | 語なし                             | 語なし（配列の添字）       | 手数の値あり                 | 本文で未確認             | `tesuu` 16（`json-kifu-format` の再生器の語）、`ply` 1 |
| 分岐       | 語なし                             | `forks`                    | 語なし                       | variation                | `fork` 39、`branch` 43                            |
| 読み筋     | `pv`                               | 語なし                     | 語なし                       | principal variation      | `pv` 7、`line` 46                                 |
| 評価値     | `score cp`                         | 語なし                     | 語なし                       | evaluation               | `eval` 15、`evaluation` 9、`score` 1              |
| 詰み       | `go mate`、`checkmate`、`score mate` | 語なし                   | checkmate の述語              | checkmate                | `mate` と `checkmate` 1。`mate` は3つの意味に注意 |
| 先手と後手 | `b`、`w`                           | `color` の0、1             | `BLACK`、`WHITE`             | Black、White、Sente、Gote | `Side` 17、`color` 13、`turn` 25、`sente` 8       |
| 手合割     | 語なし                             | `initial.preset`           | 語なし                       | handicap                 | `handicap` 9、`preset` は**プリセットと衝突**     |
| 定跡       | 語なし                             | 語なし                     | 語なし                       | 本文で未確認             | `book` 112（`CONTEXT.md` の語）   |

**先後は3語が役割で分かれている。** `Side` は Rust の enum とその写し、`Color` は `tsshogi` の値、`turn` は局面の手番。
`colorToSide` と `sideToTsColor` が変換を担う。新しいコードは層の語に合わせ、4つ目を足さない。

## 言語の形

| 形                     | 意味                                       | 出典                       |
| ---------------------- | ------------------------------------------ | -------------------------- |
| Rust `as_`             | 借用から借用へ。コストなし                 | Rust API Guidelines C-CONV |
| Rust `to_`             | 同じ抽象度で作り直す。コストあり           | 同上                       |
| Rust `into_`           | 所有を受け取る                             | 同上                       |
| Rust `get_` を付けない | `first()` の形。`get` は明白な1つのときだけ | C-GETTER。Tauri コマンドの名前は線の名前なので別 |
| Rust `iter`            | コレクションの列挙                         | C-ITER                     |
| Rust の語順            | crate の中と標準ライブラリに揃える         | C-WORD-ORDER               |
| 頭字語                 | 型の中でも1語（`Uuid`）     | C-CASE、Google TS          |
| React `use`            | 中で Hook を呼ぶ関数だけ                   | React 公式                 |
| React `on` と `handle` | prop は `on`、受ける関数は `handle`        | React 公式                 |
| 真偽                   | 問いとして読める                           | Swift、R-NAM-5             |
| 副作用の有無           | 無ければ名詞句、あれば動詞                 | Swift                      |

TS の略語はこのリポジトリで `JKF` `USI` を大文字で書く綴りが既にある。**触ったファイルの綴りに揃え、1語の綴りを割らない。**

## 動詞

| 動詞                           | このリポジトリで期待する意味           |
| ------------------------------ | -------------------------------------- |
| `get`                          | 手元にある値を返す。IO を含まない      |
| `read`                         | ファイルやストリームから読む（`write` の対） |
| `load`                         | 保存先から取り出す（`save` の対）。移行や既定値を含むことがある |
| `fetch`                        | 外から取ってくる                       |
| `parse`                        | 文字列を構造へ。失敗しうる             |
| `normalize`                    | 同じ意味の表現を1つに揃える            |
| `save`                         | 保存先へ置く                           |
| `write`                        | ファイルやストリームへ書く             |
| `delete`                       | 保存先や棋譜から消す                   |
| `create`                       | 永続するものを新しく作る               |
| `build`                        | 部品から値を組み立てる                 |
| `validate`                     | 判定して失敗を返す。値を変えない       |
| `start`、`stop`                | 走り続けるものを動かす、止める         |
| `close`                        | 面を消す。ADR-0011 の別の語に注意      |

表は既存の語の意味を言語化した。`get` 53、`read` 37、`create` 20、`build` 17 の本体が全て従うとは確かめていない。
名前を決めるときは表を起点にし、`SKILL.md` の手順3で本体を読む。

## 出典

- [Rust API Guidelines: Naming](https://rust-lang.github.io/api-guidelines/naming.html)
- [Effective Go: Names](https://go.dev/doc/effective_go#names)（getter に `Get` を付けない）
- [Swift API Design Guidelines](https://www.swift.org/documentation/api-design-guidelines/)（確立した意味を守る、略語は検索で見つかること、慣例を尊重する）
- [React: Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks)、[Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks)、[Responding to Events](https://react.dev/learn/responding-to-events)
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)（Identifiers は要約を介して読んだ）
- [USI プロトコル（将棋所）](https://shogidokoro2.stars.ne.jp/usi.html)
- [JSON Kifu Format](https://github.com/na2hiro/json-kifu-format)（アーカイブ済み。移行先は Kifu-for-JS）
- [python-shogi](https://github.com/gunyarakun/python-shogi)
- [Shogi（Wikipedia 英語版）](https://en.wikipedia.org/wiki/Shogi)。定跡、千日手、入玉の英語は本文で確かめられていない
