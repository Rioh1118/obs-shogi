# USI (Universal Shogi Interface) プロトコル

USIプロトコルは、将棋GUIソフトと思考エンジンが通信をするためにTord Romstad氏によって考案された通信プロトコルです。本ドキュメントは将棋所などで実質的な標準となっている仕様を定義します。

## 1. 基本ルール

- GUIとエンジン間の通信は、標準入出力を通してテキストコマンドで行う。
- エンジンは常に（思考中であっても）コマンドを受信できなければならない。
- 文字は半角英数字を使用する。コマンドとオプションの間は半角スペースで区切る。
- エンジンがコマンドの行を送信する場合、最後に必ず**改行コード (`\n`)** を追加する。

## 2. 盤面と指し手の表記 (SFEN)

### 2.1 駒の表記

先手は大文字、後手は小文字で表記する。成駒は前に `+` をつける（例: `+P`）。

- 玉: `K`, `k` (King)
- 飛: `R`, `r` (Rook)
- 角: `B`, `b` (Bishop)
- 金: `G`, `g` (Gold)
- 銀: `S`, `s` (Silver)
- 桂: `N`, `n` (kNight)
- 香: `L`, `l` (Lance)
- 歩: `P`, `p` (Pawn)

### 2.2 局面の表記

`[盤面] [手番] [持ち駒] [手数]` のスペース区切りで表記する。

- **盤面**: 1段目から9段目までを `/` で区切る。空白マスは連続する数を数字で表す。
  - 例 (平手初期): `lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL`
- **手番**: 先手 `b` (Black)、後手 `w` (White)
- **持ち駒**: 駒の種類と枚数。2枚以上は前に数字。ない場合は `-`。
  - 例 (先手銀1歩2、後手角1歩3): `S2Pb3p`
- **手数**: 常に `1` とする。

### 2.3 指し手の表記

筋(1~9)と段(a~i)を組み合わせる（例: 5一は `5a`）。

- **盤上の移動**: 移動元と移動先を並べる（例: 7七から7六へ移動なら `7g7f`）。
- **成る場合**: 最後に `+` を追加する（例: `8h2b+`）。
- **駒打ち**: `[駒大文字]*[打つ場所]`（例: 金を5二に打つなら `G*5b`）。

## 3. コマンドリファレンス

### 3.1 GUIからエンジンへ送るコマンド

- `usi` : 起動時の初期化コマンド。
- `isready` : 対局準備の確認。
- `setoption name <id> value <x>` : エンジン設定値の送信。
- `usinewgame` : 対局開始。
- `position [sfen <sfen> | startpos] moves <m1> ... <mn>` : 局面の送信。
- `go` : 思考開始。
  - オプション: `ponder` (先読み), `btime`/`wtime` (残り時間 ms), `byoyomi` (秒読み ms), `binc`/`winc` (加算時間 ms), `infinite` (無制限), `mate <ms> | infinite` (詰将棋解答)
- `stop` : 思考停止と即時応答の要求。
- `ponderhit` : 先読み中の予想手が当たった場合の合図。
- `quit` : エンジン終了。
- `gameover [win | lose | draw]` : 対局終了の通知。

### 3.2 エンジンからGUIへ送るコマンド

- `id name <name>` / `id author <author>` : エンジン情報の応答。
- `usiok` : 初期化完了の応答。
- `readyok` : 対局準備完了の応答。
- `bestmove <m1> [ponder <m2>]` : 指し手の応答。先読み要求時は `ponder` を付加。
  - 投了時は `bestmove resign`、入玉勝ち宣言時は `bestmove win` を送信。
- `info` : 思考中の情報送信（1行にまとめて可）。
  - サブコマンド: `depth`, `seldepth`, `time`, `nodes`, `pv`, `multipv`, `score cp <x>`, `score mate <y>`, `lowerbound`, `upperbound`, `currmove`, `hashfull`, `nps`, `string`
- `option name <id> type <type> [default <x>] [min/max/var...]` : エンジンの設定項目の提示。
  - 種類: `check`, `spin`, `combo`, `button`, `string`, `filename`
- `checkmate [<m1> ... <mn> | notimplemented | timeout | nomate]` : 詰将棋の解答応答。

## 4. 通信シーケンス例

### 通常の指し手のやり取り

```text
> position startpos moves 7g7f
> go btime 60000 wtime 60000 byoyomi 10000
< info time 1000 depth 5 score cp 50 pv 3c3d 2g2f
< bestmove 3c3d
```
