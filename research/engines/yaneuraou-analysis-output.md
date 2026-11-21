# やねうら王の検討の出力と時間の扱い（2026-11-21）

**検討（`go infinite`）で何が出るか、時間の指定がどう効くか。** 方針は書かない。

- 実測: V9.90 開発版（`YaneuraOu_SFNN_halfka2_1024_7_64_k3k3-V990DEV_APPLEM1`）、macOS arm64、`Threads` 1、定跡なし（`BookFile no_book`）
- ソース: `yaneurao/YaneuraOu` の `master`（`2deff5b2`、2026-11-20）、GPL-3.0。書き写さず、ファイルと関数で指す

## `ConsiderationMode`

`ConsiderationMode` が true のとき、読み筋を置換表からたどって組み、`PvInterval` を無視する
（`source/engine/yaneuraou-engine/yaneuraou-search.cpp` の `computed_pv_interval` と読み筋の出力）。
`go infinite` でも `PvInterval` は無視される（同じ式）。[確定]

実測。`position startpos moves 7g7f 3c3d 2g2f`、`MultiPV 2`、`go infinite` を約3秒で `stop`:

| `ConsiderationMode` | `info depth` の行 | `lowerbound` / `upperbound` を含む行 | 読み筋が3手以下の行 | 止めた後の2番目の候補 |
| ------------------- | ----------------- | ------------------------------------ | ------------------- | --------------------- |
| false               | 50                | 1                                    | 11                  | `upperbound`、読み筋2手 |
| true                | 50                | 0                                    | 6                   | 境界なし、読み筋 34 手 |

[確定・1局面]

**true でも境界つきの値で終わることがある。** 先手番の別の局面（`sfen 7nl/7k1/9/7G1/9/9/9/9/K8 b G 1`、`MultiPV 3`、約2秒）では、
止めた後の最善手の行が `score cp 836 upperbound` だった。[確定・1局面]

## 詰んでいる局面

手番の側が詰んでいる局面（`sfen 8k/7G1/8G/9/9/9/9/9/K8 w - 1`）で `go infinite`:
`info depth 0 multipv 1 score mate -1 ... pv resign` を1行出し、`stop` の後に `bestmove resign`。[確定]

## 時間の指定

`go byoyomi <T>` では、使ってよい時間を「残り時間 + 秒読み − `NetworkDelay2`」とし、100ms を下限にする
（`source/timeman.cpp` の `remain_time`。`NetworkDelay2` の既定は通常の版で 1120ms、ふかうら王の版で 1400ms。`time_margin` の分岐）。`go movetime` はその値をそのまま使う（同ファイルの時間固定の分岐）。[確定]

実測（`position startpos moves 7g7f`、最後の `info` の `time`）:

| 送った行・設定                                              | `time` |
| ----------------------------------------------------------- | ------ |
| `go byoyomi 1000`（既定）                                   | 101    |
| `go byoyomi 1000`、`NetworkDelay2 0`                        | 1001   |
| `go byoyomi 3000`（既定）                                   | 1881   |
| `go movetime 1000`                                          | 1000   |

[確定]。`research/engines/usi-measurements.md` が `[未確認]` としていた「`byoyomi` 1000 で約 100ms」の原因はこれ。

## オプションの名前と値

- 名前の大小文字を区別しない: `setoption name multipv value 3` で `MultiPV` が 3 になった（`getoption`）。[確定]
- 値に空白を含むパス: `setoption name EvalDir value <空白を含むパス>` で、そのフォルダの `nn.bin` を読んだ。[確定]

## 失効条件

- `timeman.cpp` の `remain_time` の式か `NetworkDelay2` の既定が変わったら、時間の節を測り直す
- 読み筋の出力の分岐（`ConsiderationMode`）が変わったら、検討の節を測り直す
