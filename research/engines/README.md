# 実エンジンの測定

**手元の USI エンジンへ実際に行を送り、返ったものを記録する場所。** 方針は書かない。

| 測定日     | エンジン                                   | 申告の写し                                                 |
| ---------- | ------------------------------------------ | ---------------------------------------------------------- |
| 2026-10-31 | やねうら王 NNUE V8.30（halfKP1024X2-8-32） | `src-tauri/tests/fixtures/usi/yaneuraou-v830.usi.txt`      |
| 2026-10-31 | やねうら王 NNUE V9.00（halfkp_256x2-32-32）| `src-tauri/tests/fixtures/usi/yaneuraou-v900.usi.txt`      |
| 2026-10-31 | zermelo `f558898`（αβ + NNUE の自作）      | `src-tauri/tests/fixtures/usi/zermelo.usi.txt`             |

環境: macOS arm64、`Threads` を持つものは 1、`USI_Hash` 64。各項目は**1件ごとに起動し直す**
（前の項目の壊れ方を持ち越さないため。詳細は [usi-measurements.md](usi-measurements.md) の「測り直し」）。

`raw/` に測定の台本と生の結果がある。**DL 系（dlshogi 系）は手元に無く、測っていない。**

- [usi-measurements.md](usi-measurements.md) — 応答の遅れ・`go` の形・壊れ方
