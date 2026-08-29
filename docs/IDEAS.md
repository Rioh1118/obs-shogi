# IDEAS

「やるかもしれないが、6週間以内に着手しない」もの置き場。

**運用ルール**: issue を新規に立ててよいのは **6週間以内に着手するものだけ**。それ以外はここに1行で書く。
ここから issue に昇格するのは、現在の `Now` が完了したときだけ。

> 背景: backlog は持ち越すだけでコストになる。本当に重要なアイデアは何度でも戻ってくる。
> 以下は 2026-07-27 に `direction:maybe` ラベルごと整理したもの。**すべて issue として再オープン可能**（番号を残してある）。

---

## 解析キャッシュ永続化（旧 Phase 1 / #86–#89）

局面に解析結果を紐付けて保存する構想。4 issue に分解済みだった。

- #86 Rust `analysis_cache` モジュール（load/save + atomic write）
- #87 FE `entities/analysis-cache` + Provider 統合 + 自動書込
- #88 `KifuMoveCard` 解析済バッジ + AnalysisPane 履歴セクション
- #89 解析キャッシュの肥大化対策 policy

判断: 方針転換メモで「あると良い」＝必須ではない。解析は現状 transient で設計されており（Analysis aggregate は永続しない）、永続化は aggregate 境界の変更を伴う。T1 が片付くまで着手しない。

## 定跡まわりの周辺タスク（旧 Phase 4 / #102–#104）

- #102 解析キャッシュ import / export（JSON + CSV）← 上記が前提
- #103 AI Library UI を新 book formats に対応
- #104 `.sbk` 直接対応の調査タスク

判断: 定跡の read/write 本体（#90–#100）が先。加えて、定跡の編集・変換は ShogiHome が v1.20.0 以降やねうら王 `.db` を read/edit/save 対応済み、BookConv が `.sbk` ↔ `book.bin` ↔ `.db` を処理しており、**既に解決済みの領域**である可能性が高い。着手前に実物での再調査が必要。

## 棋譜内しおり（#118）

「この棋譜の山場」を手にマークする機能。課題局面（study positions）とは別物。
判断: 注釈機能（marks / file-meta）の設計が2系統に分裂したまま未決着なので、それを決めるまで着手しない。

---

## 未 issue のアイデア

- **合流 / transposition を DAG として扱う** — ShogiHome issue #236（30コメント、最多議論）が「木構造では千日手や局面の合流に対応できない、グラフを直接可視化・編集したい」と要求し未解決のまま。KIF/KI2/CSA いずれも仕様として合流を持たない。横断検索側は `PositionKey`(SFEN由来) なので既に合流に強く、棋譜内表現だけが木。**差別化の最有力候補**だが、着手前に現行 `normalizedTree` の設計影響を調べること
- **「ShogiHome で開く」導線** — エンジン/対局/検討 GUI を自前で磨くより価値が高い可能性
- **棋譜ブログ向けの出力** — ShogiHome #1271（複数棋譜横断の一括局面図）が 2025-07 から open のまま
