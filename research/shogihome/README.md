# ShogiHome の実装調査

対象: `sunfish-shogi/shogihome`
版: **`de27f0c1c352`（2026-08-30）** — 以下の記述は全てこの版のもの。
再取得は `research/README.md` の手順（`?ref=` で版を固定する）
構成: Electron + Vue 3 + TypeScript

## 引用について

このディレクトリの文書に含まれる引用は全て `sunfish-shogi/shogihome`（Copyright (c) sunfish-shogi、**MIT License**、
<https://github.com/sunfish-shogi/shogihome/blob/main/LICENSE>）から、
**その実装を論じる目的で必要な範囲だけ**を抜粋している。

引用ブロックは2種類ある。**混ぜない。**

| 種類           | 印                                        | 規約                                                                   |
| -------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| **原文どおり** | 印なし                                    | 原文と `diff` して 0 を確認したもの。**改変しない。**省略は `…` で示す |
| **要約**       | ブロックの直前に `**要約。原文ではない**` | 骨格だけを示す。型注釈やコメントを落としてよい                         |

- 抜粋は型定義・定数・数行の関数に限る。ファイル全体は載せない
- **説明のための注記は引用ブロックの外に置く**
- 「原文どおり」と書くなら、貼った版と原文を実際に `diff` に掛けて 0 を確認する。
  **目視で「近い」を確認しない**

obs-shogi 自身も MIT（`LICENSE.md`）。

**読む順**: 対局を設計するなら 01 → 02。レイアウトなら 03 → 06。局面編集なら 04。

| ファイル                                         | 何が書いてあるか                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| [01-app-state.md](01-app-state.md)               | アプリ全体の状態機械。**モーダルな `AppState` 1本＋直交する `ResearchState`** |
| [02-game.md](02-game.md)                         | 対局。`Player` 抽象・設定の型・時計・連続対局・SPRT                           |
| [03-board-layout.md](03-board-layout.md)         | 盤と駒台の3レイアウトと**比率の保ち方**。obs-shogi の駒台問題に直接効く       |
| [04-position-editing.md](04-position-editing.md) | 局面編集。**駒箱もごみ箱も無い**。枚数を直接編集する                          |
| [05-usi-engine.md](05-usi-engine.md)             | `USIEngine` 型と USI オプションの持ち方。obs-shogi の `EnginePreset` と比較   |
| [06-tabs-and-layout.md](06-tabs-and-layout.md)   | タブペインとカスタムレイアウト（絶対座標＋ドラッグ編集）                      |
| [07-project-ops.md](07-project-ops.md)           | CONTRIBUTING / issue テンプレ / `specs/` の使い方                             |

## 全体の骨格

ディレクトリの切り方が obs-shogi と比較しやすいので先に置く。

```
src/
  common/          両プロセスが共有する型とロジック（obs-shogi には対応物が無い）
    settings/      app app.ts / game.ts / player.ts / usi.ts / layout.ts / csa.ts / analysis.ts ...
    game/          time.ts / result.ts / csa.ts / usi.ts
    record/        comment.ts / score.ts / types.ts
    file/          conversion.ts / history.ts / path.ts / record.ts
    control/       menu.ts / state.ts        ← AppState はここ
    helpers/ i18n/ ipc/ links/ assets/ advanced/ nextmove/ book.ts log.ts message.ts uri.ts
  background/      Electron main（obs-shogi の src-tauri/src に相当）
    usi/           engine.ts / process.ts / metadata.ts / path.ts / index.ts
    book/ csa/ file/ image/ proc/ security/ stats/ headless/ helpers/
  renderer/        画面
    game/          clock.ts / coordinator.ts / game.ts / parallel.ts / result.ts / sprt.ts / start_position.ts
    players/       player.ts / human.ts / usi.ts / basic.ts / builder.ts   ← 対局の中核
    store/         index.ts ほか関心ごとに分割
    view/          dialog/ main/ tab/ menu/ primitive/ layout/ monitor/ overlay/ prompt/
    layout/ ipc/ devices/ helpers/ external/ wasm-engine/ webapp/
specs/             機能ごとの仕様書 13本
```

**共通して言えること**: どのディレクトリも `<関心>/<役割>.ts` の2段で、
1段目がドメイン、2段目が役割になっている。`background/` の直下にファイルが
散らばっているのは `index.ts` `log.ts` `settings.ts` の3つだけ。

→ obs-shogi の `src-tauri/src/` との比較は `docs/` 側の命名整理メモに置く。
