# obs-shogi 研究/AI 機能ロードマップ

このドキュメントは [#56](https://github.com/Rioh1118/obs-shogi/issues/56) の親 Epic と紐付く実装ロードマップの index です。
詳細仕様の原本はローカルプラン (`~/.claude/plans/effervescent-tinkering-lynx.md`) ですが、ここでは GitHub 上で完結する開発フローと粒度を記録します。

## 目標

obs-shogi の研究検討環境を ShogiHome 相当まで引き上げる。**AI 対局は実装しない**。エンジンは研究のための補助計算機。

## 設計原則

1. 対局機能は作らない (`go` は研究のみ: infinite / time / depth / nodes / mate)。
2. Second Brain (`tone` / `importance`) ロジックには触らない。定跡ビューアは独立ウィジェット。
3. エンジンは単一インスタンス継続、preset 切替を高速化して十分性を担保。
4. 永続化は fileId スコープ (`meta/<fileId>-*.json`) に寄せる (既存 `file-meta` の流儀)。
5. 定跡フォーマット: `.db` (テキスト) を一次市民として扱い、`.db.bin` / Apery `book.bin` / `.sbk` は read-only。編集は `.db` のみ。

## Phase / Milestone / Epic 対応

| Phase                    | Milestone                | Epic                                                   | Branch                           |
| ------------------------ | ------------------------ | ------------------------------------------------------ | -------------------------------- |
| 0 — エンジン UX 基盤     | Phase 0 (due 2026-06-14) | [#77](https://github.com/Rioh1118/obs-shogi/issues/77) | `feature/phase-0-engine-ux`      |
| 1 — 解析キャッシュ永続化 | Phase 1 (due 2026-07-05) | [#78](https://github.com/Rioh1118/obs-shogi/issues/78) | `feature/phase-1-analysis-cache` |
| 2 — 定跡 read 基盤       | Phase 2 (due 2026-08-02) | [#79](https://github.com/Rioh1118/obs-shogi/issues/79) | `feature/phase-2-book-read`      |
| 3 — ユーザー定跡編集     | Phase 3 (due 2026-08-23) | [#80](https://github.com/Rioh1118/obs-shogi/issues/80) | `feature/phase-3-book-edit`      |
| 4 — 仕上げと統合         | Phase 4 (due 2026-09-06) | [#81](https://github.com/Rioh1118/obs-shogi/issues/81) | `feature/phase-4-polish`         |

## サブタスク一覧

### Phase 0 — エンジン UX 基盤

- [#82](https://github.com/Rioh1118/obs-shogi/issues/82) AnalysisPane に解析パラメータ inline コントロール
- [#83](https://github.com/Rioh1118/obs-shogi/issues/83) USI options GUI 編集 (Preset Edit Dialog 拡張)
- [#84](https://github.com/Rioh1118/obs-shogi/issues/84) ai_library を 4 種類の book 拡張子に対応
- [#85](https://github.com/Rioh1118/obs-shogi/issues/85) Engine preset 切替 UX

### Phase 1 — 解析キャッシュ永続化

- [#86](https://github.com/Rioh1118/obs-shogi/issues/86) Rust analysis_cache モジュール
- [#87](https://github.com/Rioh1118/obs-shogi/issues/87) FE entities/analysis-cache + Provider 統合
- [#88](https://github.com/Rioh1118/obs-shogi/issues/88) KifuMoveCard 解析済バッジ + AnalysisPane 履歴
- [#89](https://github.com/Rioh1118/obs-shogi/issues/89) キャッシュ肥大化対策 policy

### Phase 2 — 定跡 read 基盤

- [#90](https://github.com/Rioh1118/obs-shogi/issues/90) book/mod + BookReader trait + Tauri commands skeleton
- [#91](https://github.com/Rioh1118/obs-shogi/issues/91) db_text.rs YANEURAOU-DB2016 v1.00 parser
- [#92](https://github.com/Rioh1118/obs-shogi/issues/92) db_bin.rs YaneuraOu バイナリ on-the-fly
- [#93](https://github.com/Rioh1118/obs-shogi/issues/93) apery_bin.rs Apery book.bin reader
- [#94](https://github.com/Rioh1118/obs-shogi/issues/94) ShogiGUI .sbk → .db 変換コマンド
- [#95](https://github.com/Rioh1118/obs-shogi/issues/95) FE entities/book + widgets/book-viewer + ModalType 登録
- [#96](https://github.com/Rioh1118/obs-shogi/issues/96) 棋譜/解析への定跡 hit バッジ + Settings 研究用 book セクション

### Phase 3 — ユーザー定跡編集

- [#97](https://github.com/Rioh1118/obs-shogi/issues/97) db_text.rs write 側実装
- [#98](https://github.com/Rioh1118/obs-shogi/issues/98) merge_into_book + MergePolicy
- [#99](https://github.com/Rioh1118/obs-shogi/issues/99) Book Viewer 編集 UI + 現局面を定跡に追加
- [#100](https://github.com/Rioh1118/obs-shogi/issues/100) 現棋譜の全枝を定跡に出力

### Phase 4 — 仕上げと統合

- [#101](https://github.com/Rioh1118/obs-shogi/issues/101) Settings に「研究」タブ統合
- [#102](https://github.com/Rioh1118/obs-shogi/issues/102) 解析キャッシュ import / export
- [#103](https://github.com/Rioh1118/obs-shogi/issues/103) AI Library UI を新 book formats 対応
- [#104](https://github.com/Rioh1118/obs-shogi/issues/104) .sbk 直接対応の調査タスク

## 開発フロー

### ブランチ戦略

- **長期 feature ブランチ** (Phase 単位): `feature/phase-{N}-{slug}` — Phase の集合 PR 先。main から分岐し、Phase 完了時に main へ **squash merge**。
- **作業ブランチ** (sub issue 単位): `feat/p{N}-{i}-{slug}` — Phase ブランチから分岐し、Phase ブランチに PR を出す。
- **既存慣習**: 単発の bug fix は従来通り `fix/<issue>-<slug>` で main 直 PR (Phase に縛られない)。

### PR ルール

1. sub issue 1本 = 作業ブランチ 1本 = PR 1本 を基本単位。
2. PR タイトル: `<type>(<scope>): <description> (#issue)`
   - 例: `feat(engine): AnalysisPane に解析パラメータ inline コントロールを追加 (#82)`
   - type: `feat / fix / refactor / docs / test / chore / perf / ci`
3. PR 本文:
   - `Closes #<sub-issue-num>`
   - 要約 (1–3 行)
   - 動作確認手順
   - スクリーンショット/動画 (UI 変更時)
4. レビュー観点はサブ issue の「受入」チェック + `.claude/rules/ecc/common/code-review.md` の標準項目。
5. CI (`npm run lint && npm run build`、必要なら `cargo check`) 緑が必須。

### Phase ブランチ → main の取り込み

- Phase 内の全 sub issue が closed になったら Epic を close → Phase ブランチを main に squash merge → ロードマップ更新。
- Phase ブランチでの累積コミットが大量なら、Phase ブランチ自体は **merge commit** (`--no-ff`) で main に取り込んで履歴を保持する選択肢もあり (Phase の節目を main 上で識別しやすくするため)。最終形は Phase 0 終盤に再判断。

### 依存関係

依存のあるサブタスクは issue 本文に `depends on Phase X-Y` を明記。代表例:

- Phase 2 の各フォーマット parser (#91-94) は #90 (trait + commands skeleton) 完了後に並列着手可。
- Phase 3 (#97-100) は Phase 2 完了が前提。特に #100 は Phase 1 の解析キャッシュにも依存。
- Phase 4 (#101-103) は対応 Phase 完了が前提。

## Out of Scope (このロードマップでは対応しない)

- 対局機能 (人 vs エンジン、エンジン vs エンジン)。
- マルチエンジン同時稼働 (EngineManager → Pool 化は将来課題)。
- Second Brain と engine eval の自動連携。
- バイナリ book formats への直接書き込み (.db → .bin は `makebook sort` 外部呼び出し運用)。
- 評価グラフ (Phase 1 の解析キャッシュ完成後、需要次第で別 issue 化)。

## 参考リンク

- USI Protocol: http://hgm.nubati.net/usi.html
- YANEURAOU-DB2016 book format: https://github.com/Paalon/yaneuraou-book-format
- ShogiHome: https://github.com/sunfish-shogi/shogihome
- YaneBookTools: https://github.com/yaneurao/ShogiBookTools
