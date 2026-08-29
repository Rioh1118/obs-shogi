# IDEAS

「やるかもしれないが、6週間以内に着手しない」もの置き場。

**運用ルール**: issue を新規に立ててよいのは **6週間以内に着手するものだけ**。それ以外はここに1行で書く。
ここから issue に昇格するのは、現在の `Now` が完了したときだけ。

> 背景: backlog は持ち越すだけでコストになる。本当に重要なアイデアは何度でも戻ってくる。
> 番号を残してあるものは**すべて issue として再オープン可能**。

---

## 定跡(book) — 旧 T1-④ / #84 #90–#101

**ADR-0002 で「自前で作らない」と決めた。** ShogiHome が4形式の read/write/変換を実装済みで、
テストも 3 OS 配布も揃っている。→ `docs/PREMISES.md` P-006（反証）

- #90 Rust `book/mod` + BookReader trait + Tauri commands
- #91 `db_text.rs` YANEURAOU-DB2016 parser
- #92 `db_bin.rs` — **前提が誤り。`.db.bin` というフォーマットは存在しない**（実在するのは `.ybb`）
- #93 `apery_bin.rs` Apery `book.bin` reader
- #94 `.sbk` → `.db` 変換
- #95 FE `entities/book` + `widgets/book-viewer`
- #96 定跡 hit バッジ + **複数 book 同時ロードと重ね合わせ**
- #97 `db_text.rs` write（atomic + `.bak`）
- #98 `merge_into_book` + MergePolicy
- #99 Book Viewer 編集 UI
- #100 現棋譜の全枝を定跡に出力 — 依存先の `normalizedTree.ts` が**どのブランチにも存在しない**
- #101 Settings に「研究」タブ統合
- #84 `ai_library` を4種類の book 拡張子に対応 — 4拡張子のうち `.db.bin` が実在しない

**#96 だけが本物のギャップ。** ただし ShogiHome 側も issue #1456 として認識しており（2026-01-10 起票、
現在も open）、実装速度を踏まえると先を越される側に賭ける方が分が良い。**着手を検討するなら #1456 の
状態を先に見ること。**

- #102 解析キャッシュ import / export（JSON + CSV）
- #103 AI Library UI を新 book formats に対応
- #104 `.sbk` 直接対応の調査タスク

## エンジン UX — 旧 Phase 0 / #83 #85 #107 #110

親 Epic #77 は close 済み。方針転換メモ（#112）は「維持」と書いたが、
**書いた時点で実装状況を確認していない**（→ `PREMISES.md` P-007）。

コードは残してある。**捨てたのは issue の器だけで、実装ではない。**

| #    | 内容                                                        | どこにあるか                                                                 |
| ---- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| #107 | preset → AnalysisConfig の配線（mode: 時間/深さ/ノード/詰） | `feature/phase-0-engine-ux`（PR #109 がここにマージ済み。**main には無い**） |
| #83  | USI オプションの GUI 編集                                   | `archive/issue-83-usi-options`（#107 の上、24ファイル946行の未完成）         |
| #85  | preset 切替の進捗表示と no-op 分岐                          | 未着手                                                                       |
| #110 | finite 解析を raw send に切り替える                         | 未着手。**起票者自身が backlog / priority low と本文に明記**                 |

**着手前に読むこと**: `feature/phase-0-engine-ux` は main から67コミット遅れており、
#120 のレイヤ再配置（FSD）を丸ごと被る。**救出コストが新規実装を上回る可能性がある。**
設計の議論は #83 のコメントと `.claude/plans/issue-83-usi-options-gui.md` に残っている。

## 解析キャッシュ永続化 — 旧 Phase 1 / #86–#89

局面に解析結果を紐付けて保存する構想。4 issue に分解済みだった。

- #86 Rust `analysis_cache` モジュール（load/save + atomic write）
- #87 FE `entities/analysis-cache` + Provider 統合 + 自動書込
- #88 `KifuMoveCard` 解析済バッジ + AnalysisPane 履歴セクション
- #89 解析キャッシュの肥大化対策 policy

方針転換メモで「あると良い」＝必須ではない。解析は現状 transient で設計されており
（Analysis aggregate は永続しない）、永続化は aggregate 境界の変更を伴う。T1 が片付くまで着手しない。

## 既存 UX の作り直し — 旧 T2 / #46 #54 #66

**`track:T2-ux-a11y` と `type:epic`（#116 #117）は廃止した。** Epic の器に子 issue が付いておらず、
親だけが残っていたため。

- #46 盤面のドラッグアンドドロップ — 局面編集（#113）と重なるので、単独では決められない
- #54 タブで複数の棋譜をアクティブにする — レイアウトシステムの設計と連動
- #66 棋譜の分岐を別ファイルに切り出す（+ 棋譜のコピー操作）— 実戦譜と研究手順のファイル責任を分ける
- **WAI-ARIA / RFC 準拠**（旧 #117）— これは issue ではなく**全 UI 作業に乗せる品質基準**。
  規約として扱うなら `CONTRIBUTING.md` に置くこと

## レイアウト / IA — 旧 T3

**`track:T3-layout` は廃止した。** 劣後トラックにラベルを1本使う意味が無い。

- レイアウトシステムとブレークポイントの設計。#32 がその入口として issue に残っている

## 横断検索まわり

- #25 ファイル名で検索 — 方針転換メモでは「維持」枠。局面検索とは別経路

## #120 の積み残し（構造）

レビュー3ラウンドで「別 issue に送る」と判定した所見のうち、**bug でも T1 でもないもの**。
失敗経路に関わる分は #157 / #158 として issue にした。以下は構造的な負債で、
単独で着手する価値がまだ判断できていない。

- **局面の同一性キーが3系統3粒度ある** — Rust の `position_key_from_sfen` にまで及ぶ。
  横断検索は `PositionKey`(SFEN由来)、棋譜内は `tesuuPointer`、解析はまた別。**触るなら一度に揃える**
- **`tesuuPointer` の生成が3箇所に重複** — `CLAUDE.md` は「`indexOf(",")` によるパースの重複」と
  書いているが**該当0件**。実在するのは生成側の重複。記述を直すこと
- **`bridges` / `gates` を分ける基準が無い** — gate が何も gate していない
- **`entities/` の公開境界が10スライス中2つ欠落** — 揃えるには3段階の順序が要る
- **`ModalType` union が上位層のスライス名簿を持っている** — 下位層が上位層の一覧を知っている。
  design-system の議論と連動する
- **`app-config` ⇄ `engine-presets` の双方向依存** — `PresetId` を branded type にすると切れる
- **`convertJkfPiece` の到達不能コードと死んだ `isPromoted`**
- **Rust `open_project` にコマンド層・ドメイン・IO が同居**（144行）

**状態遷移表を他のモジュールに広げるかは未決。** いまは非同期・並行・外部プロセスが絡む箇所に
限って使う道具であって、規約ではない。

## 棋譜内しおり（#118）

「この棋譜の山場」を手にマークする機能。課題局面（study positions）とは別物。
注釈機能（marks / file-meta）の設計が未決着なので、それを決めるまで着手しない。

---

## 未 issue のアイデア

- **合流 / transposition を DAG として扱う** — ShogiHome issue #236 が要求し未解決。
  ただし L2 の調査は「ShogiHome は DAG 化せず SFEN 索引で同じ痛みを解決し v1.25.0 で出荷済み」
  と報告している（未再確認）。**着手前に `research/findings/L2-transposition-demand.md` を読むこと**
- **「ShogiHome で開く」導線** — エンジン/対局/検討 GUI を自前で磨くより価値が高い可能性
- **棋譜ブログ向けの出力** — ShogiHome #1271（複数棋譜横断の一括局面図）が 2025-07 から open のまま
