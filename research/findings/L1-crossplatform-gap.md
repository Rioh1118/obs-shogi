# L1: 保守されたクロスプラットフォーム棋譜ライブラリ層は存在するか

調査日: 2026-07-27 / 調査者: OSINT レーン L1 / 手法: 公開一次情報の受動閲覧のみ（GitHub REST API, 配布サイトの生 HTML, npm/crates.io/PyPI レジストリ API, iTunes Search/Lookup API）。能動的接触（issue 投稿・DM・アカウント作成・star・follow）は一切行っていない。

---

## 結論（1段落）

「棋譜を蓄積・横断検索・統計する層」という機能セット自体は**すでに存在し、しかも2005年から存在している**（柿木義一の KifuBase：条件検索・局面検索・並び換え・統計計算、製品版で30万局）。ただしそれは Windows 専用でバイナリの日付は 2013/6/12 である。一方で現在アクティブに保守されている実装として、(a) **きふみAI**（MARGINAL GAINS INC., 2026-07-14 更新, macOS 14.0+ Apple Silicon / iOS / visionOS 対応, 棋譜フォルダ管理・最大50,000件保存・戦型/囲い別勝率などの横断統計）と、(b) **playshogi**（AGPL-3.0, 2026-04-18 push, `ps_position` / `ps_kifupos` / `ps_gameset` / `ps_tag` を持つ局面インデックス付き対局コレクション DB）の2件を一次情報で確認した。さらに前提の根拠として挙げられていた「ShogiGUI は 2022 年で止まっている」は**明確に誤り**で、ShogiGUI は 2026/7/1 に ver 0.0.8.8 をリリースしている（2026年だけで4回リリース）。また「将棋所は Windows 専用」も不正確で、将棋所Mac が公式に公開され Ubuntu 向けの注意事項ページも存在する。したがって P-002 は現在の文言のままでは支持できない。ただし「**ローカルの棋譜ファイル群を対象に、デスクトップ（Win/Mac/Linux）で動作し、オープンソースで保守されている棋譜ライブラリ層**」に限定すれば、一次情報で該当するものは1件も発見できなかった。空白は存在するが、前提が主張しているより**ずっと狭い**。

## 判定: P-002 は **部分的に反証**

現行の文言（「保守されたクロスプラットフォームの棋譜ライブラリ層は存在しない」）は、以下3点で反証される。

1. **機能は既存**: KifuBase が条件検索・局面検索・統計計算を1000局（フリー）/30万局（製品版）規模で提供している。「そういうものが無い」のではなく「Windows でしか無い／古い」が正しい。[確定]
2. **保守されたライブラリ層は存在する**: きふみAI（2026-07-14, macOS/iOS/visionOS）と playshogi（2026-04-18, AGPL, ブラウザ）。前者は棋譜管理＋横断統計、後者は局面インデックス＋コレクション＋タグ。[確定]
3. **前提の根拠3件のうち1件は事実誤認**: ShogiGUI は 2022 年で停滞していない（2026/7/1 ver 0.0.8.8）。将棋所も Windows 専用ではない（将棋所Mac 公開・Ubuntu 手順あり）。[確定]

反証されなかった部分（＝真の空白）は「## 空白の正確な形」に記す。

---

## 既知ツールの実測表

| ツール               | 最終リリース(実日付)                                                                                                   | 対応OS(配布物実体)                                                                                                                                                            | ソース公開                                                                                       | 蓄積/横断検索の有無                                                                                                                                                                                                                                                          | 等級                                                                                                           | 出典URL                                                                                                                                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 棋譜エクスプローラー | **2022/9/16 ver 0.2.2.0**（配布ページの最上段）                                                                        | Windows のみ。「必要環境: Windows10以降 / .NET framework 4.6.2」。配布物はインストーラーと ZIP のみ                                                                           | 無（サイトにリポジトリ・ライセンス表記なし。第三者ライブラリの謝辞のみ）                         | **有**。「棋譜DBを作成閲覧したり、フォルダやZIPファイル内の棋譜を閲覧することができます」                                                                                                                                                                                    | [確定]（ソース公開の有無のみ [推定]：リポジトリ表記が無いことによる）                                          | https://kifu.siganus.com/ ／ Wayback: http://web.archive.org/web/20260518095458/https://kifu.siganus.com/                                                                                                                                                                                          |
| KifuBase (フリー版)  | **バイナリ 2013/6/12**（配布一覧表の日付列）／**紹介ページ末尾 2019/1/6**（V6.20）                                     | Windows のみ。「日本語 WindowsXP, Windows Vista, Windows 7, Windows 8, Windows 10」                                                                                           | 無（フリー・ソフトウェア表記のみ、ソース配布なし）                                               | **有**。「条件検索：対局者、対局日、棋戦、戦型、手合割の条件での棋譜の検索／局面検索／並び換え／統計計算等」。フリー版は最大1000局、製品版は30万局（柿木将棋IX 同梱、Vector 販売）                                                                                           | [確定]                                                                                                         | http://kakinoki.o.oo7.jp/KifuBase.html ／ 一覧表: http://kakinoki.o.oo7.jp/ ／ Wayback: http://web.archive.org/web/20251003230637/http://kakinoki.o.oo7.jp/KifuBase.html                                                                                                                           |
| ShogiGUI             | **2026/7/1 ver 0.0.8.8**（0.0.8.7=2026/5/23, 0.0.8.6=2026/5/5, 0.0.8.5=2026/4/14, 0.0.8.4=2026/3/1, 0.0.8.3=2024/2/5） | Windows のみ。「ShogiGUIはWindowsで動作する将棋のグラフィカルユーザーインターフェース（GUI)ソフトウェアです」。配布物はインストーラ版と zip 版のみ、.NET framework 4.8.1 必須 | 無                                                                                               | **無（GUI 単体では）**。マニュアル目次は「はじめに／ウインドウ／情報ウインドウ／将棋エンジン設定／棋譜ファイルを再生、編集／棋譜コメントウインドウ／その他の機能」のみ。棋譜DB は姉妹ソフト棋譜エクスプローラーに分離                                                        | [確定]（リリース日・OS）／[推定]（ソース非公開・DB機能なし：サイトとマニュアル目次に該当記載が無いことによる） | https://shogigui.siganus.com/download.html ／ https://shogigui.siganus.com/ ／ マニュアル: https://sites.google.com/site/shogigui/マニュアル ／ Wayback: http://web.archive.org/web/20260514221858/https://shogigui.siganus.com/download.html                                                      |
| 将棋所 (Windows)     | **将棋所5.7.0 / 2025/06/14リリース**（更新履歴に明記）。サイト最終更新日 2026/02/07                                    | **Windows 専用ではない**。macOS 版「将棋所Mac」を公式公開、Linux は Mono 実行の注意事項ページあり（更新履歴に「LinuxのMonoで実行時」の記述が複数回）                          | 無（「市販DVDへの収録など、商用目的での再配布を禁止」。同梱エンジン Lesserkai のソースのみ公開） | **無**。機能ページの列挙は 対局／思考内容表示／検討／棋譜解析／詰将棋解答／棋譜入力／局面編集／棋譜の読み書き／棋譜解析の読み書き／コピー＆ペースト／**対局結果一覧表示**（＝将棋所で行った対局の一覧のみ）。DB・横断検索・タグ・統計は無し                                  | [確定]                                                                                                         | https://shogidokoro2.stars.ne.jp/download.html ／ 機能: https://shogidokoro2.stars.ne.jp/function.html ／ Mac: https://shogidokoro2.stars.ne.jp/mac/index.html ／ Ubuntu: https://shogidokoro2.stars.ne.jp/ubuntu.html                                                                             |
| ShogiHome            | **v1.28.0 / 2026-06-27**（安定版）。v1.29.0-alpha.1 / 2026-07-19（プレリリース）                                       | **真にクロスプラットフォーム**。v1.28.0 のリリースアセット実体: `release-v1.28.0-linux-appimage.zip` / `-linux-deb.zip` / `-mac.zip` / `-portable.zip` / `-win.zip`           | **有・MIT**                                                                                      | **無（ライブラリ層としては）**。同一局面検索は実装済みだが**単一棋譜内**の重複局面検出（RecordManager が SFEN ごとの出現数を保持）。他に 履歴（最近開いたファイル）／定跡機能／連続解析(BatchAnalysis)／棋譜形式一括変換。ファイル群を横断するインデックス・タグ・統計は無し | [確定]                                                                                                         | https://github.com/sunfish-shogi/shogihome/releases/tag/v1.28.0 ／ 同一局面検索 PR: https://github.com/sunfish-shogi/shogihome/pull/1298 ／ i18n 実体: https://github.com/sunfish-shogi/shogihome/blob/main/src/common/i18n/locales/ja.ts#L232-L233 (`searchDuplicatePositions: "同一局面を検索"`) |

### ShogiHome の「スコープ外宣言」について — **原文は発見できなかった**

タスクで指定された「大量の棋譜から検索・統計する機能はありません」という文言は、**一次情報で確認できなかった**。等級: **[未確認]**。

探した範囲（すべて実施済み）:

- `README.md`（raw 取得、全文）— 該当なし
- `CONTRIBUTING.md`（raw 取得、全文）— 該当なし
- GitHub Wiki 全33ページ（`shogihome.wiki.git` を clone して `grep -rn` で「大量」「統計」「データベース」「検索」を全検索）— 「大量」0件、「データベース」0件、「統計」はトラブルシューティングのログ種別表のみ
- Issue/PR 全文検索: `repo:sunfish-shogi/shogihome` × 「棋譜 検索」「統計」「データベース」「予定はありません」「スコープ」「対象外」「棋譜管理」「一括」「フォルダ」「タグ」

代わりに一次情報で確認できた、方向性を示す記述は以下2点。

1. `CONTRIBUTING.md` の「控えて欲しいもの」節（[確定]、出典 https://github.com/sunfish-shogi/shogihome/blob/main/CONTRIBUTING.md ）:

   > ### 機能要望
   >
   > 個人的に欲しい機能やサポートを要求することは歓迎しません。
   > せっかく作ったものなので活用されたら嬉しいとは思いますが、要求されたものを作ることは望んでいません。

2. Issue #236「一般のグラフ構造を意識し、定跡ファイルやデータベースをベースとした操作体系」（2022-10-16 起票 / 2023-05-07 クローズ）でのメンテナ発言（[確定]、出典 https://github.com/sunfish-shogi/shogihome/issues/236 ）:

   > 将棋 GUI は多岐にわたり機能が充実しています。様々な機能があるなかで定跡機能が決定的な優位点だと判断する根拠は私の知る限りありません。

   > 誤解しないでいただきたいのですが、私は Electron 将棋のための自分の開発リソースについて優先度を考えて取り組む必要があり、 Paalon さんの提案そのものを否定したいわけではありません。

**注意**: これらは「棋譜ライブラリ層を作らない」というスコープ外宣言そのものではなく、機能要望一般に対する姿勢と、定跡グラフ機能の優先度に関する発言である。P-002 の根拠として「ShogiHome 作者がスコープ外宣言をした」と書くのは、現時点では**出典で裏付けられない**。note.com / X（旧Twitter）/ 送信フォーム経由など GitHub 外に原文がある可能性は否定できないが、L1 では確認できなかった。

---

## 新規に発見したツール・プロジェクト

### 1. きふみAI - 将棋AI解析と棋譜管理 — **P-002 に最も強く抵触する**

- **何をするものか**: 棋譜のインポート（KIF/CSA/KI2、将棋ウォーズ/将棋クエスト/ぴよ将棋/棋桜(KIOU)/百鍛将棋/飛角の出力に対応）、**フォルダ分けによる棋譜管理**、**棋譜保存 無料200件 / Pro 最大50,000件**、**対局履歴解析・棋風レポート（自分と相手の戦型・囲い別の勝率、1か月/3ヶ月/1年ごとの勝敗推移）**、悪手自動検出、任意局面の最善手探索、詰み検索、お気に入り登録・メモ。
- **最終更新**: バージョン 11.2 / **2026-07-14**（初回リリース 2025-11-14）
- **OS（配布物実体）**: App Store 単一配信。互換性欄の原文 — 「iPhone iOS 17.0以降が必要です」「iPad iPadOS 17.0以降が必要です」「**Mac macOS 14.0以降とApple M1以降のチップを搭載したMacが必要です**」「Apple Vision visionOS 1.0以降が必要です」。**Windows / Linux は非対応。**
- **ライセンス**: クローズド。無料＋Pro買い切り ¥3,500。
- **obs-shogi と競合するか**: **する（機能面で最も近い）**。「棋譜を貯めてフォルダで管理し、コレクション横断で統計を出す」という中核が既に実装され、Mac でも動く。ただし (a) モバイルファーストで Windows/Linux 不在、(b) クローズドソース、(c) 局面による横断検索（コレクション全体を局面キーで引く）が説明文に明記されていない点が obs-shogi の残る差分。
- **出典**: https://apps.apple.com/jp/app/id6754811804 ／ 一次データ取得: `https://itunes.apple.com/lookup?id=6754811804&country=jp`（version=11.2, currentVersionReleaseDate=2026-07-14, releaseDate=2025-11-14, minimumOsVersion=17.0）
- **等級**: [確定]（バージョン・日付・対応OS・機能記述）／[推定]（「局面による横断検索は無い」— 説明文に記載が無いことによる消極的推定。実機未検証）

### 2. playshogi (Tellmarch) — **局面インデックス付き対局コレクション DB**

- **何をするものか**: シェアウェブサービス。README の Features 原文 — 「Learn / Puzzles / Practice / **Collections: Public and Private game collections**」。DB スキーマに `ps_kifu`, `ps_game`, `ps_player`, `ps_position`, **`ps_kifupos`**（棋譜↔局面インデックス）, `ps_gameset`, **`ps_gamesetpos`**, **`ps_gamesetmove`**（コレクション単位の局面／指し手集計）, `ps_tag`, `ps_gamesetgame` を持つ。`PositionRepository.java` に `getOrSavePosition(sfen)` / `getPositionIdBySfen(sfen)` が実装済み。
- **最終更新**: リポジトリ push 2026-04-18。DB スキーマの生成コメントは「Fri 26 Dec 2025」。GitHub Releases は無し（サービス直接デプロイ）。
- **OS**: ブラウザ（GWT クライアント + Java サーバ + MySQL）。ローカルアプリではない。
- **ライセンス**: **AGPL-3.0**（ソース公開）
- **obs-shogi と競合するか**: **概念的には最も近い先行実装**。「コレクション × 局面インデックス × タグ」という設計が既に存在する。ただしホスト型サービスであり、ユーザのローカル棋譜ファイル群を管理する層ではない。star 8 の個人プロジェクト。
- **出典**: https://github.com/Tellmarch/playshogi ／ スキーマ: https://github.com/Tellmarch/playshogi/blob/master/mysql/schema.sql ／ https://github.com/Tellmarch/playshogi/blob/master/playshogi-library-database/src/main/java/com/playshogi/library/database/PositionRepository.java ／ サービス: http://playshogi.com/ ／ Wayback: http://web.archive.org/web/20260214110604/https://playshogi.com:443/
- **等級**: [確定]

### 3. shogimaru（将棋丸） — アクティブなクロスプラットフォーム OSS GUI

- **何をするものか**: USI 対応の将棋 GUI。README 原文 — 「クロスプラットフォーム - Windows, Mac, Linux, WebAssembly」「棋譜の解析モード、評価グラフ」「複数の読み筋を表示（MultiPV対応）」「CSA形式棋譜の読込・保存」「多言語対応」。
- **最終更新**: **v1.5.7 / 2026-06-21**。リリースアセット実体: `shogimaru-1.5.7_mac.dmg`, `shogimaru-1.5.7_windows.zip`（Linux/WASM はソースからビルド）。
- **OS**: Mac・Windows はバイナリ配布、Linux/WASM は Qt6 + qmake でビルド。
- **ライセンス**: **MIT**
- **競合するか**: **しない（ライブラリ層としては）**。棋譜の蓄積・横断検索・タグ・統計に該当する記述は README に無い。ただし「アクティブに保守されたクロスプラットフォーム OSS 将棋 GUI」という土俵では ShogiHome と並ぶ既存プレイヤー。
- **出典**: https://github.com/shogimaru/shogimaru/releases/tag/v1.5.7 ／ README: https://github.com/shogimaru/shogimaru/blob/master/README.md
- **等級**: [確定]

### 4. ShogiBoardQ (hnakada123) — 2025年創設のクロスプラットフォーム OSS GUI

- **何をするものか**: Qt6 / C++17 の将棋対局・解析ソフト。README の主な機能に「**棋譜管理** - KIF / KI2 / CSA / USI / SFEN / JKF など主要な棋譜フォーマットの読み込み・書き出しに対応」「局面集ビューア」「定跡機能」「**クロスプラットフォーム** - Linux・macOS・Windowsに対応」。
- **最終更新**: リリース `2026.02.23` / 2026-02-23。アセット実体: `ShogiBoardQ-linux.zip`, `ShogiBoardQ-macos.zip`, `ShogiBoardQ-windows.zip`。リポジトリ push 2026-07-08。リポジトリ作成 2025-07-27（新しい）。
- **ライセンス**: **GPL-3.0**
- **競合するか**: **しない（ライブラリ層としては）**。README の「棋譜管理」はフォーマット I/O の意味であり、蓄積・横断検索・タグ・統計ではない。ただし obs-shogi と**同じ土俵（クロスプラットフォーム OSS 将棋 GUI）で 2025 年に新規参入した**という点で、競争環境の変化として重要。
- **出典**: https://github.com/hnakada123/ShogiBoardQ/releases/tag/2026.02.23 ／ README: https://github.com/hnakada123/ShogiBoardQ/blob/main/README.md ／ サイト: https://hnakada123.github.io/ShogiBoardQ/
- **等級**: [確定]

### 5. Shogi Explorer (schadfield) — クロスプラットフォームだが**アーカイブ済み**

- **何をするものか**: README 原文 — 「Shogi Explorer is an application which allows Shogi players to analyse game records using a Shogi game engine. **It works on macOS, Windows and Linux.**」。KIF 読込（UTF-8/Shift JIS）、USI エンジン解析、`.kaf` 解析結果の保存、Fast Save（`<prefix>-<dateTime>-<sente>-<gote>-<index>.kif` テンプレート保存）、shogi.or.jp のライブ棋譜モニタ、カスタム URI スキーム。
- **最終更新**: 最終リリース **4.24.0 / 2024-02-15**。アセット実体: `ShogiExplorer-4.24.0-windows.zip`, `ShogiExplorer.AppImage`, `ShogiExplorer.app_4.24.tar.gz`, `ShogiExplorer_4.24.0.deb`, `ShogiExplorer_4.24.0.rpm`（5形態の実バイナリ）。リポジトリ push 2025-10-18。**`archived: true`**（GitHub API で確認）。
- **ライセンス**: GPL-3.0。Java 17 ランタイム必須。
- **競合するか**: **しない（現在は死んでいる）**。ただし「クロスプラットフォームで全 OS ネイティブパッケージを配る OSS 将棋 GUI が 2024 年まで存在し、その後アーカイブされた」という事実は、この領域の**持続性リスク**の実測データとして重要。
- **出典**: https://github.com/schadfield/shogi-explorer ／ https://github.com/schadfield/shogi-explorer/releases/tag/4.24.0 ／ README: https://github.com/schadfield/shogi-explorer/blob/main/README.md
- **等級**: [確定]

### 6. Kifu for Mac (柿木義一) — macOS 用棋譜管理、DB 機能なし

- **何をするものか**: 「Mac版の将棋の棋譜管理プログラム」。ページ原文の機能列挙 — 「対局の棋譜・局面・詰将棋の保存・再現」「Webやメール・掲示板等での棋譜・局面の交換や再現」「局面図の印刷。図面の倍率を指定可能。PDFファイルも作成可能」。**検索・DB・統計の記述なし。**
- **最終更新**: **V0.53 / 2025/10/23**（配布一覧表の日付。詳細ページは「試作版 V0.53」と表記、改良点の記載は V0.54 まである）
- **OS**: macOS 10.11 以降。配布物: `KifuMac053.dmg`
- **ライセンス**: フリー・ソフトウェア（ソース非公開）。ページ原文「このバージョンは、フリーソフトウェアです。**将来、有料にする可能性があります。**」
- **競合するか**: **しない**。DB 層は KifuBase 側にあり、KifuBase は Windows 専用。つまり**柿木エコシステムでは Mac 側に DB が存在しない**。
- **出典**: http://kakinoki.o.oo7.jp/kifu_mac.html ／ 一覧: http://kakinoki.o.oo7.jp/
- **等級**: [確定]

### 7. 将棋ログ - 棋譜管理・詰将棋管理アプリ (Vida Apps Incorporated)

- **何をするものか**: iOS の棋譜管理アプリ。説明文の機能列挙 — 棋譜の新規作成／KIF 読み書き／棋譜データの保存・管理／**棋譜のフォルダ管理（プレミアムプラン限定機能）**／閲覧／分岐対応／局面ごとコメント／駒落ち対応／盤反転／iPad 対応。**検索・統計の記述なし。**
- **最終更新**: v2.0.0 / **2026-04-15**（初回 2024-10-28）
- **OS**: iOS 15.6 以降（互換性に Mac の記載なし）。クローズド。
- **競合するか**: 部分的（フォルダ管理まで）。横断検索・統計は無い。
- **出典**: https://apps.apple.com/jp/app/id6737223881 ／ `https://itunes.apple.com/lookup?id=6737223881&country=jp`
- **等級**: [確定]

### 8. 棋譜管理ツール「棋譜の管理」(saltedeggplant)

- **何をするものか**: 「２ちゃんねる用棋譜切り出し・**重複管理**ソフト」。掲示板スレッドから棋譜を切り出し、重複を管理する。
- **最終更新**: **2023/10/16版**（`kfep231016.zip`）。**プログラムソース公開あり**（`ksource231016.zip`）。サイト表記「since Sep.04 2004」。
- **OS**: [推定] Windows（zip 配布 + 2ch 用途 + インストール方法ページの存在から。明示的な動作環境記述はトップページに無い）
- **競合するか**: しない（スコープが極めて狭い）。ただし「重複管理」という、大量棋譜蓄積で実際に発生する問題に対する既存解が存在する点は記録に値する。
- **出典**: https://saltedeggplant.hide-yoshi.net/
- **等級**: [確定]（日付・ソース公開）／[推定]（OS）

### 9. 将棋DB2 — 公開棋譜のウェブ検索サービス

- **何をするものか**: 「無料の棋譜サービス」。`/search` に「棋譜検索」ページが存在し、ナビゲーションは Latest Games / Comments / Games / Popular Games / floodgate / Tournaments / Players / Strategies / Books / Submit Kifu。
- **OS**: ブラウザ。クローズド。
- **競合するか**: **しない**。プロ・floodgate 等の公開棋譜を対象とするサービスであり、ユーザ自身の棋譜ファイル群を管理する層ではない。
- **出典**: https://shogidb2.com/ ／ https://shogidb2.com/search ／ Wayback: http://web.archive.org/web/20260511093945/https://shogidb2.com/
- **等級**: [確定]（ページ存在・ナビ項目）／[未確認]（局面検索の有無 — `/search` は JS レンダリングで、生 HTML からは検索フォームの項目を確定できなかった）

### 10. lishogi — **オープニングエクスプローラは存在しない**

- `WandererXII/lishogi` の `modules/` ディレクトリ実体（全モジュール名）: activity, analyse, api, appeal, article, bookmark, bot, challenge, chat, chatroom, clas, coach, common, coordinate, db, evalCache, evaluation, event, forum, forumSearch, game, **gameSearch**, history, hub, i18n, importer, learn, lobby, memo, mod, msg, notify, oauth, perfStat, plan, playban, pref, push, puzzle, rating, relation, report, room, round, search, security, setup, shoginet, shutup, simul, socket, storm, streamer, **study**, **studySearch**, team, teamSearch, timeline, tournament, tree, tv, user
- 本家 lichess に存在する `explorer` モジュールが **無い**。`gh api search/code -q 'repo:WandererXII/lishogi explorer'` → **total_count = 0**。
- **Study 機能の範囲**: `study` / `studySearch` モジュールは存在し、ユーザが作成した研究ノートを共有・検索できる。ただし「棋譜コレクションを局面キーで横断検索する」層ではない。
- **競合するか**: しない（ライブラリ層は未実装）。
- **出典**: https://github.com/WandererXII/lishogi/tree/master/modules ／ ライセンス AGPL-3.0, push 2026-07-12, 349 stars
- **等級**: [確定]（モジュール一覧・explorer 不在）／[推定]（Study の機能範囲 — モジュール名からの推定であり、実サービスの UI は未検証）

### 11. その他（競合しないが記録として）

| プロジェクト                  | 種別                                                                                 | 最終更新                                                                                                  | OS                                        | ライセンス      | 競合                                                                     | 出典                                                               | 等級                            |
| ----------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------- |
| Marken-Foo/tsumemi            | KIF ファイル**集合**をブラウズ・速解きする Python ツール                             | 最終リリース v0.3.2-alpha 2022-03-29 / push 2025-10-21                                                    | Python（クロスプラットフォーム、zip配布） | GPL-3.0         | 詰将棋限定。コレクション横断という発想はある                             | https://github.com/Marken-Foo/tsumemi                              | [確定]                          |
| orangain/kifu-notebook        | 棋譜にノートを取る Web アプリ。darwin/linux/windows × 386/amd64/arm のバイナリを配布 | 最終リリース 2020-04-30 / push 2023-01-07                                                                 | Win/Mac/Linux                             | MIT             | **死んでいる**                                                           | https://github.com/orangain/kifu-notebook/releases                 | [確定]                          |
| defuncart/kifu_viewer         | KIF ビューア                                                                         | 0.2.0 / 2025-01-01。アセット: `kifu_viewer_linux.zip`, `kifu_viewer_macos.dmg`, `kifu_viewer_windows.zip` | Win/Mac/Linux                             | MIT             | ビューアのみ                                                             | https://github.com/defuncart/kifu_viewer/releases/tag/0.2.0        | [確定]                          |
| akicho8/shogi-extend          | 「将棋関連のツール集」（shogi-extend.com）。62 stars                                 | push 2026-06-03                                                                                           | Web (Ruby)                                | AGPL-3.0        | [未確認]（個別ツールの機能は未検証）                                     | https://github.com/akicho8/shogi-extend                            | [確定]（メタ）/[未確認]（機能） |
| sutonomega/shogi-db           | 「将棋棋譜の保存・分析を行う**個人用**データベース」。KIF→SFEN 生成→対局DB/局面DB    | push 2026-06-23（作成 2026-06-19）                                                                        | Python                                    | ライセンス無    | 個人プロジェクト、0 stars、リリース無し。**着想は obs-shogi と同一**     | https://github.com/sutonomega/shogi-db                             | [確定]                          |
| irof/Kifuzo                   | 「ローカルにある将棋の棋譜をみるだけのツール。**配布は考えてないです**」             | push 2026-06-09、**archived: true**                                                                       | Kotlin                                    | ライセンス無    | しない                                                                   | https://github.com/irof/Kifuzo                                     | [確定]                          |
| kidrintaro-gif/joseki-manager | 「将棋の定跡管理Webアプリ」                                                          | push 2026-05-21（作成 2026-05-17）                                                                        | Web                                       | ライセンス無    | 0 stars, リリース無し                                                    | https://github.com/kidrintaro-gif/joseki-manager                   | [確定]                          |
| dkh634/NakabishaDb            | 「中飛車の棋譜を収集しまくる」                                                       | push 2026-02-07（＝作成日、単日）                                                                         | -                                         | -               | しない                                                                   | https://github.com/dkh634/NakabishaDb                              | [確定]                          |
| jruffet/docker-shogigui       | ShogiGUI + やねうら王を **Linux で動かす** Dockerfile。11 stars                      | push 2025-03-25                                                                                           | Linux                                     | -               | しない。ただし「Linux ユーザが Windows 専用 GUI を動かす需要」の実測証拠 | https://github.com/jruffet/docker-shogigui                         | [確定]                          |
| akicho8/homebrew-shogi        | 「Apple Silicon Mac に ShogiHome + 水匠を入れるための brew で tap するやつ」         | push 2026-07-05                                                                                           | macOS                                     | -               | しない。Mac ユーザの導入摩擦の証拠                                       | https://github.com/akicho8/homebrew-shogi                          | [確定]                          |
| Kifu for Windows              | 「将棋棋譜管理（Unicode対応最新版）」7.81。KifuBase と連動                           | **7.81 / 2025/5/24**（Unicode版）、6.70 / 2026/2/9（旧系列）                                              | Windows                                   | フリー、非公開  | DB は KifuBase 側                                                        | http://kakinoki.o.oo7.jp/ ／ http://kakinoki.o.oo7.jp/KifuwInt.htm | [確定]                          |
| Shogi Kifu (iOS, 柿木)        | 棋譜の記録・再現。Dropbox 連携                                                       | v4.73 / 2024-09-04                                                                                        | iOS 12.0+                                 | ¥600 クローズド | DB 機能なし                                                              | https://apps.apple.com/jp/app/id302532668                          | [確定]                          |
| 棋譜リーダー / 将棋ノート     | iOS 棋譜関連アプリ                                                                   | v3.0.0 / 2026-04-14、v1.3.5 / 2026-07-19                                                                  | iOS                                       | クローズド      | [未確認]（機能未検証）                                                   | iTunes Search API `term=将棋 棋譜&entity=software&country=jp`      | [未確認]                        |

### 12. ライブラリレジストリ軸の結果（npm / crates.io / PyPI）— **ライブラリ層のパッケージは存在しない**

実測したパッケージはすべて**パーサ／指し手生成／フォーマット変換／UI 部品**であり、「棋譜コレクションのインデックス・検索・管理」を提供するパッケージは1件も無かった。

- **npm**（`registry.npmjs.org/-/v1/search`）: `tsshogi` 2.3.4 (2026-06-07), `shogiops` 0.21.0 (2026-02-16), `shogi.js` 5.5.0 (2026-01-05), `json-kifu-format` 5.5.0 (2026-01-05), `kifu-for-js` 5.5.0 (2026-01-05), `shogiground` 0.10.3 (2025-06-08), `shogi-player` 1.1.33 (2025-11-19), `usi-csa-bridge` 1.28.1 (2026-07-25), `@multi-game-engines/domain-shogi` 0.1.4 (2026-07-21) ほか
- **crates.io**（`crates.io/api/v1/crates`）: `shogi` 0.12.2 (2021-12-26), `shogi_core` 0.1.5 (2022-08-05), `shogi-kifu-converter` 0.2.2 (2024-07-26), `csa` 1.0.2 (2022-06-06), `usi` 0.6.2 (2022-06-06), `haitaka` 0.3.2 (2025-05-13), `rshogi-core` 0.5.2 (2026-07-19), `shogi-img` 0.4.0 (2025-12-01) ほか
- **PyPI**: `python-shogi` 1.1.1 (2024-02-09), `cshogi` 1.0.4 (**2026-07-18**)
- 等級: [確定]

### 13. チェス隣接軸の結果 — **チェス系 DB ソフトは将棋を扱わない**

- `franciscoBSalgueiro/en-croissant`（"The Ultimate Chess Toolkit", GPL-3.0, 1749 stars, push 2026-04-20）内のコード検索 `shogi` → **total_count = 0**
- `org:scid` 全体のコード検索 `shogi` → **total_count = 0**
- ChessBase については一次情報での確認をしていない → [未確認]
- 等級: [確定]（en-croissant, scid）／[未確認]（ChessBase, Chess Openings Wizard）

### 14. 需要側の証拠（フォーラム軸、閲覧のみ）

- Yahoo!知恵袋 2025/2/17 1:25 投稿、質問原文: 「将棋で棋譜を取りまとめて管理するツールのようなものはありませんか。将棋GUIの定石ツールのような機能のものです。将棋GUIでは、使い方がよく分からなくて使いにくかったです。 角換わりや45角などの棋譜を事前に並べたものをすぐ引き出せるようなツールです。」
  - 出典: https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q14311038729
  - **重要な注意**: この質問に付いている回答は AI 生成であり、「HISSHO」「Kibo」「Shogidokoro（オンラインの棋譜管理サービス）」という**実在しないツール名**を挙げている。回答内容は証拠として使えない。**質問が存在し、有効な人間の回答が付いていないこと自体**が需要側の弱い証拠。
  - 等級: [確定]（質問文・投稿日）／回答内容は**採用しない**

---

## 空白の正確な形

**「ローカルの棋譜ファイル群（数千〜数万件）を対象に、Windows/macOS/Linux のデスクトップで動作し、オープンソースで現在も保守されている、蓄積・局面横断検索・タグ付け・統計の層」は一次情報で1件も見つからなかった** — 機能は KifuBase（Windows専用・2013年バイナリ）に、保守は きふみAI（Apple 系のみ・クローズド）と playshogi（ホスト型 Web・AGPL）に分散しており、この3条件（ローカルファイル対象 × デスクトップ3OS × 保守されたOSS）を同時に満たすものが無い、という形の空白である。

---

## この前提の失効条件（何が起きたら P-002 は覆るか）

以下のいずれかが観測された時点で P-002 は失効し、obs-shogi の差別化根拠の再定義が必要になる。

1. **ShogiHome がライブラリ層を実装したとき**。監視すべき具体的シグナル: `src/common/i18n/locales/ja.ts` に単一棋譜内 `searchDuplicatePositions` を超える語彙（例: 棋譜一覧・棋譜フォルダ・棋譜検索・戦型別統計）が入る／`src/background/` に SQLite 等の永続インデックスが入る／`package.json` に全文検索・DB 系依存が入る。単一棋譜内の同一局面検索は 2025-08-14 に既に着地済みなので、次の一歩が近い可能性は無視できない。
2. **きふみAI が Windows / Linux に展開したとき**、または App Store 説明文に「コレクション全体を局面で検索」に相当する記述が追加されたとき。現在 Mac (Apple Silicon) では既に動く。
3. **柿木エコシステムが Kifu for Mac に KifuBase 相当の DB を載せたとき**。Kifu for Mac は 2025/10/23 に更新されており死んでいない。実現すれば「Win+Mac で棋譜管理＋DB」が揃う。
4. **playshogi がローカル/デスクトップ配布を始めたとき**、または誰かが AGPL のまま fork してデスクトップ化したとき。スキーマと Repository 層は既に揃っている。
5. **ShogiBoardQ または shogimaru が棋譜ライブラリ機能を追加したとき**。両者ともクロスプラットフォーム OSS で活動中であり、追加コストが obs-shogi より低い可能性がある。
6. **棋譜エクスプローラー（siganus）がクロスプラットフォーム化したとき**。同作者の ShogiGUI は 2026 年も活発（2026年に4リリース）で、開発者は停止していない。棋譜エクスプローラーだけが 2022/9/16 で止まっている理由は不明であり、再開の可能性を排除できない。
7. **AI 支援開発により個人プロジェクトが実用水準に到達したとき**。`sutonomega/shogi-db`（2026-06 作成、設計ドキュメント 6 本を先に書いている）のような、obs-shogi と同一着想の個人プロジェクトが 2026 年に複数生まれている。参入障壁が下がっている。

---

## 試した検索語の全リスト（失敗も含む。軸ごとに分類）

### 軸A: GitHub リポジトリ検索（`gh api search/repositories`）

ヒット件数は `total_count`。0 件＝完全な空振り。

| 検索語                                                       | total_count | 備考                                                                                                                |
| ------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `topic:shogi`（sort=updated / sort=stars で各50件・2ページ） | 196         | 主軸。ここから shogimaru / ShogiBoardQ / playshogi / tsumemi / shogi-extend を発見                                  |
| `kifu`（sort=updated, 50件）                                 | 453         | Kifuzo / shogi-kifu-rag / KifuAnalyzer / 棋譜分析ダッシュボード を発見。大半は無関係（Go/囲碁、人名、金融アプリ等） |
| `topic:kifu`                                                 | 10          | 大半が囲碁。将棋関連は ShogiBoardQ / shogi-player のみ                                                              |
| `topic:shogi-gui`                                            | **0**       | ← 空振り。このトピックは使われていない                                                                              |
| `topic:shogi-board`                                          | 17          | 新規発見なし                                                                                                        |
| `shogi tauri`                                                | **0**       | ← 空振り。Tauri 製の将棋アプリは obs-shogi 以外に無い                                                               |
| `shogi gui`                                                  | 44          | schadfield/shogi-explorer, firedemon/shogi-explorer を発見                                                          |
| `shogi viewer`                                               | 12          | ビューアのみ                                                                                                        |
| `shogi database`                                             | 5           | すべて 2020 年以前の死蔵リポジトリ（gsdb-2.7.4, ittedb 等）                                                         |
| `shogi kifu database`                                        | **0**       | ← 空振り                                                                                                            |
| `shogi position search`                                      | **0**       | ← 空振り                                                                                                            |
| `shogi game collection`                                      | 3           | 無関係（MCP サーバ、websocket ゲーム集）                                                                            |
| `shogi opening book`                                         | **0**       | ← 空振り                                                                                                            |
| `shogi library manager`                                      | **0**       | ← 空振り                                                                                                            |
| `kifu manager`                                               | 2           | 空リポジトリ + タイピング履歴管理（無関係）                                                                         |
| `shogi notes`                                                | 5           | orangain/kifu-notebook を発見                                                                                       |
| `shogi study`                                                | 12          | 無関係（LMS、ブログ等）                                                                                             |
| `kif viewer shogi`                                           | 4           | defuncart/kifu_viewer を発見                                                                                        |
| `sfen`                                                       | 230         | 大半が無関係（SFENet、人名）。新規発見なし                                                                          |
| `将棋 棋譜 管理`（スペース区切り）                           | **0**       | ← 空振り。GitHub の日本語トークナイズの限界                                                                         |
| `棋譜 データベース`                                          | 2           | **sutonomega/shogi-db を発見**                                                                                      |
| `棋譜 検索`                                                  | **0**       | ← 空振り                                                                                                            |
| `局面検索`                                                   | 2           | ottfoekst/ShogiBoardSearch（2016年、死蔵）                                                                          |
| `定跡 管理`                                                  | 1           | kidrintaro-gif/joseki-manager を発見                                                                                |
| `将棋 ソフト`                                                | 27          | ShogiBoardQ を再確認                                                                                                |
| `棋譜`                                                       | 95          | Kifuzo / seseraki / NakabishaDb / kifucho を発見                                                                    |
| `shogi created:>2023-01-01`（sort=stars, 40件）              | 1779        | **schadfield/shogi-explorer を発見**（最重要の新規発見の1つ）                                                       |
| `将棋 created:>2023-01-01`（sort=stars, 40件）               | 416         | 大半が中国語圏の「棋牌」（麻雀・斗地主）誤ヒット。中国語圏に将棋の棋譜管理プロジェクトは見当たらない                |
| `棋譜 created:>2023-01-01`（sort=stars, 30件）               | 33          | tkzwhr/kifucho（囲碁）、NakabishaDb を発見                                                                          |
| `scid chess database`                                        | -           | チェス側の確認用                                                                                                    |
| `chess database shogi variant`                               | **0**       | ← 空振り。チェス DB × 将棋の交差は無い                                                                              |

### 軸B: GitHub コード検索（`gh api search/code`）

| クエリ                                        | total_count                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `repo:WandererXII/lishogi explorer`           | **0** ← lishogi にオープニングエクスプローラは無い                             |
| `repo:franciscoBSalgueiro/en-croissant shogi` | **0**                                                                          |
| `org:scid shogi`                              | **0**                                                                          |
| `repo:Tellmarch/playshogi PositionRepository` | 4（PositionRepository / GameSetRepository / KifuRepository / KifuServiceImpl） |

### 軸C: GitHub Issue 検索（ShogiHome のスコープ外宣言の原文探索）

| クエリ                                          | total_count | 結果                                           |
| ----------------------------------------------- | ----------- | ---------------------------------------------- |
| `repo:sunfish-shogi/shogihome 棋譜 検索`        | 6           | 該当宣言なし                                   |
| `repo:sunfish-shogi/shogihome 統計`             | 8           | エンジン統計情報のみ                           |
| `repo:sunfish-shogi/shogihome データベース`     | 3           | #236（定跡グラフ）のみ                         |
| `repo:sunfish-shogi/shogihome 予定はありません` | 9           | 該当宣言なし                                   |
| `repo:sunfish-shogi/shogihome スコープ`         | **0**       |                                                |
| `repo:sunfish-shogi/shogihome 対象外`           | 7           | 該当宣言なし                                   |
| `repo:sunfish-shogi/shogihome 棋譜管理`         | 6           | 該当宣言なし                                   |
| `repo:sunfish-shogi/shogihome 一括`             | 13          | 一括変換・連続解析（実装済み機能）             |
| `repo:sunfish-shogi/shogihome フォルダ`         | 13          | 該当宣言なし                                   |
| `repo:sunfish-shogi/shogihome タグ`             | 8           | **エンジン**のタグ付け機能のみ（棋譜ではない） |

### 軸D: Wiki 全文 grep（`shogihome.wiki.git` を clone、全33ページ）

`大量` → 0件 ／ `データベース` → 0件 ／ `統計` → 1件（トラブルシューティングのログ種別表 `usi_engine_stats`）／ `検索` → 3件（すべて Windows の「ファイル名を指定して実行を検索」の操作説明）

### 軸E: 配布経路（レジストリ・ストア・ダウンロードサイト）

| 経路                   | クエリ                                              | 結果                                                                                                     |
| ---------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| npm                    | `shogi`, `kifu`, `jkf`                              | パーサ・UI 部品のみ。ライブラリ層なし                                                                    |
| npm                    | `shogi kifu`                                        | API がエラー（URL エンコード失敗）→ 個別語で代替済み                                                     |
| crates.io              | `shogi`, `kifu`, `csa-shogi`                        | パーサ・エンジンのみ。`csa-shogi` は **0件**                                                             |
| PyPI                   | `python-shogi`, `cshogi`                            | 両方存在（ライブラリ）                                                                                   |
| PyPI                   | `shogi`, `kifu`                                     | **両方 404**（パッケージ名として存在しない）                                                             |
| App Store (iTunes API) | `entity=macSoftware` × `shogi kifu`                 | 3件（Plain将棋盤 / 将棋鬼巧 / 忘忧围棋）— **専用 macOS 棋譜管理アプリは Mac App Store カテゴリに無い**   |
| App Store (iTunes API) | `entity=macSoftware` × `棋譜`                       | 23件だがほぼ囲碁・象棋・楽譜アプリ。将棋関連は Plain将棋盤 / 将棋鬼巧 のみ                               |
| App Store (iTunes API) | `entity=software` × `将棋 棋譜`                     | 23件。**きふみAI / 将棋ログ / 棋譜リーダー / 将棋ノート を発見**（最重要の新規発見）                     |
| App Store              | `lookup?id=6754811804` / `6737223881` / `302532668` | 各アプリの version / release date / minimumOsVersion / description を一次取得                            |
| Google Play            | 「将棋 棋譜管理 アプリ Android kifu database」      | Kifu for Android (無料版/Pro, 柿木), Shogi Cosmos を確認。**Google Play の一次 API は未叩き** → [未確認] |
| Vector                 | `vector.co.jp/vpack/filearea/win/game/table/shogi/` | ページ取得は成功したが、ソフト一覧が JS レンダリングで生 HTML から抽出できず → **[未確認]**              |
| 窓の杜                 | 未実施                                              | **[未確認]**                                                                                             |
| Microsoft Store        | 未実施                                              | **[未確認]**                                                                                             |
| itch.io                | 未実施                                              | **[未確認]**                                                                                             |

### 軸F: 配布サイト直接（生 HTML 取得）

- https://kifu.siganus.com/ ✅
- https://shogigui.siganus.com/ ✅ / https://shogigui.siganus.com/download.html ✅
- https://sites.google.com/site/shogigui/マニュアル ✅（目次のみ抽出）
- http://kakinoki.o.oo7.jp/ ✅（Shift_JIS→UTF-8 変換）/ KifuBase.html ✅ / kifu_mac.html ✅ / KifuwInt.htm ✅ / free/Kifu.htm ✅
- https://shogidokoro2.stars.ne.jp/ ✅ / download.html ✅ / function.html ✅ / mac/index.html ✅
- https://shogidb2.com/ ✅ / /search ✅
- http://playshogi.com/ ✅（GWT SPA のため中身は取れず、README + スキーマで代替）
- https://saltedeggplant.hide-yoshi.net/ ✅（EUC-JP）
- `https://shogidokoro2.stars.ne.jp/mac.html` → **404**（正しくは `/mac/index.html`）

### 軸G: Wayback（web.archive.org availability API）

| 対象                                   | 直近スナップショット                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| kifu.siganus.com                       | 2026-05-18 → http://web.archive.org/web/20260518095458/https://kifu.siganus.com/                  |
| kakinoki.o.oo7.jp/KifuBase.html        | 2025-10-03 → http://web.archive.org/web/20251003230637/http://kakinoki.o.oo7.jp/KifuBase.html     |
| shogigui.siganus.com/download.html     | 2026-05-14 → http://web.archive.org/web/20260514221858/https://shogigui.siganus.com/download.html |
| playshogi.com                          | 2026-02-14 → http://web.archive.org/web/20260214110604/https://playshogi.com:443/                 |
| shogidb2.com                           | 2026-05-11 → http://web.archive.org/web/20260511093945/https://shogidb2.com/                      |
| shogidokoro2.stars.ne.jp/download.html | **スナップショット無し**（`archived_snapshots: {}`）← 消失リスクが最も高いページ                  |

### 軸H: 検索エンジン経由（原典に到達するための入口としてのみ使用。要約は事実として採用していない）

- 「棋譜エクスプローラー ShogiGUI 作者 ダウンロード」→ kifu.siganus.com に到達
- 「KifuBase 将棋 棋譜管理 ソフト」→ kakinoki.o.oo7.jp に到達
- 「将棋所 shogidokoro ダウンロード 最新版 バージョン」→ shogidokoro2.stars.ne.jp に到達
- 「lishogi study opening explorer database games search」→ 有用な原典に到達せず、GitHub のモジュール一覧で代替
- 「将棋DB2 棋譜検索 局面検索 サービス」→ shogidb2.com に到達
- 「Mac App Store 将棋 棋譜 管理 アプリ macOS kifu manager」→ **きふみAI の存在を知る入口**（数値はすべて iTunes API で取り直し）
- 「Google Play 将棋 棋譜管理 アプリ Android kifu database」→ Kifu for Android の存在を確認（一次未取得）
- 「"棋譜管理" どうしてる 将棋 大量 棋譜 整理 ブログ 2024 2025」→ saltedeggplant と Yahoo!知恵袋の質問に到達

**要約器が値を落とした実例（記録）**: きふみAI のリリース日について、WebFetch の要約は「Released July 14, **2024**」と返した。iTunes Lookup API の生 JSON では `currentVersionReleaseDate` = **2026-07-14**。本レポートは API 値を採用している。要約を信じていれば「2年前で停滞」という逆の結論になっていた。

---

## 未解決・人間に見てほしいこと

1. **【最優先】ShogiHome の「スコープ外宣言」の原文が見つからない。** README / README.en / CONTRIBUTING / Wiki 全33ページ / Issue 全文検索のいずれにも無かった。この主張を P-002 の根拠として使い続けるなら、出典（note.com の記事か、X の投稿か、あるいは記憶違いか）を人間が特定する必要がある。**特定できないなら根拠リストから削除すべき。** 逆に ShogiHome は 2025-08 に「同一局面を検索」を単一棋譜内で実装済みであり、方向としては obs-shogi に**近づいている**。
2. **きふみAI の実機検証が必要。** App Store の説明文だけでは「コレクション全体を局面キーで横断検索できるか」が判定できない。Apple Silicon Mac で動くので、実際にインストールして (a) 50,000件規模での動作、(b) 局面検索の有無、(c) UX が研究家向けか初心者向けか、を人間が確かめる価値が高い。obs-shogi の macOS 差別化に直接効く。
3. **playshogi の実サービス確認。** GWT SPA のため生 HTML から機能が読めなかった。ブラウザで playshogi.com の Collections 機能を人間が触って、局面横断検索がユーザに露出しているか確認してほしい。AGPL なので、fork してデスクトップ化する第三者が現れるリスクも同時に評価できる。
4. **将棋所の配布ページに Wayback スナップショットが無い。** `shogidokoro2.stars.ne.jp/download.html` は消失時に復元できない。obs-shogi の根拠資料として引用するなら、人間がスナップショットを1回取っておくべき（`web.archive.org/save/` の利用は能動的行為に当たるため L1 では実行していない）。
5. **未実施の配布経路**: 窓の杜、Microsoft Store、itch.io、Google Play の一次 API、Vector のソフト一覧（JS レンダリングのため生 HTML で取れず）。中国語圏 GitHub は `将棋` で検索したが「棋牌」（麻雀・カードゲーム）に埋もれて有効なシグナルが取れなかった。中国語圏コミュニティ（知乎・Bilibili 等）は未着手。
6. **ChessBase の将棋対応可否が未確認。** 有償クローズドで一次情報が取りにくい。en-croissant と Scid は 0 件で確定しているので優先度は低い。
7. **schadfield/shogi-explorer がアーカイブされた理由。** 全 OS ネイティブパッケージを配る OSS 将棋 GUI が 2024 年に止まりアーカイブされた事実は、obs-shogi にとって**持続性の警告**である。理由（作者の離脱か、需要不足か）は公開情報から読み取れなかった。
