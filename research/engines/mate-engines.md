# 詰将棋エンジンの応答（2026-11-21）

**詰み探索（`go mate`）に、詰将棋エンジンと通常のエンジンが何を返すか。** 方針は書かない。
方針は [features/mate-search.md](../../docs/spec/features/mate-search.md) が持つ。

## 出典

| 対象                     | 版                                 | 確かめ方                                                                    | ライセンス |
| ------------------------ | ---------------------------------- | --------------------------------------------------------------------------- | ---------- |
| KomoringHeights          | `kh-v1.1.0`（2023-12-28 のリリース） | リリースの mac 版に同梱のソースを読んだ。**実行はしていない**               | GPL-3.0    |
| やねうら王の詰将棋エンジン | 同梱ソースの `engine/yaneuraou-mate-engine/` と `engine/tanuki-mate-engine/` | ソースを読んだ。実行はしていない                                            | GPL-3.0    |
| やねうら王 NNUE / zermelo | [usi-measurements.md](usi-measurements.md) | 2026-10-31 の実測                                                           | —          |

ここにはコードを書き写さず、ファイルと関数の名前で指す。

## `go mate` の引数

`go mate <n>` の `<n>` を**ミリ秒**として読み、`infinite` なら上限なしにする（同梱 `source/usi.cpp` の go の解釈）。
USI の原案では手数で、意味が違う（[01-usi-original.md](../usi-spec/01-usi-original.md) §2）。[確定]

## 返す行

KomoringHeights（`engine/user-engine/user-search.cpp` の `PrintResult` と `MainThread::search`）:

| 探索の結果     | `go mate` への応答           | 通常の `go` への応答                                   |
| -------------- | ---------------------------- | ------------------------------------------------------ |
| 詰みを見つけた | `checkmate <手順を空白区切り>` | `bestmove <詰み手順の初手>`                            |
| 詰まないと示した | `checkmate nomate`           | `bestmove resign`                                      |
| 時間内に決まらない | `checkmate timeout`        | `bestmove resign`                                      |

[確定・ソースのみ]

**探索の途中は、検討と同じ形の `info` を流す。** `PvInterval`（既定 1000ms）ごとに、根の候補手を `MultiPV` の数だけ
`info ... score <値> depth <深さ> multipv <番号> pv <手順>` の行で出す（`engine/user-engine/komoring_heights.cpp` の `Print`）。
詰みが示された手は `score mate <手数>`、まだ示されていない手は `score cp <値>`。`go mate` でも通常の `go` でも同じ。[確定・ソースのみ]

- **`go mate` には `bestmove` を返さない。** 終わりの行は結論の `checkmate` の1行
- **通常の `go` では、詰まない局面でも `bestmove resign` を返す。** 候補手や評価値は出さない。
  `go infinite` なら `stop` まで待ってから返す
- やねうら王の `yaneuraou-mate-engine` は、上の3つに加えて `checkmate none`（結果不明）を返す経路を持つ
  （`yaneuraou-mate-search.cpp`）。[確定・ソースのみ]

通常のエンジンは `go mate` に `checkmate` を返さない。手元のやねうら王 V9.90 開発版は、`go mate 2000` を通常の探索として扱い、`info ... pv ...` を流して `bestmove` を返した（2026-11-21 に実測）。**上限のミリ秒を読まず、`stop` まで探索を続ける**——`go mate 2000` と `go mate infinite` のどちらも、6秒後に送った `stop` で初めて `bestmove` を返した（2026-11-22 に実測。定跡は切った）。ただし**詰みのある局面では読み切って自分で止まる**——1手詰の局面で `info ... score mate 1 ... pv 1c1b+` を流し、0.01秒で `bestmove` を返した（同日、V9.90 開発版。定跡の有無では変わらない）。やねうら王 NNUE は `bestmove`、zermelo は
`checkmate notimplemented`（[usi-measurements.md](usi-measurements.md) の「`go` の形」）。[確定]

## 他の GUI の見せ方

ShogiHome（`sunfish-shogi/shogihome` の `8aef2262`）は、詰み探索の `info` を検討と同じ経路（`src/renderer/players/usi.ts` の `onUSIInfo` から `src/renderer/store/index.ts` の `updateUSIInfo`）で読み筋の欄に出す。
始めると読み筋のタブへ切り替える（`store/index.ts` の `startMateSearch`）。[確定・ソースのみ]

## 測っていないこと

- 詰将棋エンジンを実際に起動した応答（時間、`stop` への応答）。`[未確認]`
- dlshogi 系が探索の中で詰みを調べる機能（エンジンの中の話で、GUI への応答の形は変わらない）。`[未確認]`

## 失効条件

- KomoringHeights の新しいリリースで `PrintResult` の分岐が変わったら測り直す
- USI の改訂で `go mate` の応答が定まったら、表をその規格に合わせて読み直す
