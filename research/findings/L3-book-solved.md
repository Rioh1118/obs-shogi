# L3: 定跡(book)の read/write の他実装（ShogiHome）

調査日: 2026-07-27 / 調査レーン L3 (OSINT) / 閲覧のみ（能動的接触なし）
一次資料の取得方法: `gh api`, `git clone --depth 1`, `curl raw.githubusercontent.com`。
ShogiHome の clone HEAD = `f07e934a270622ff7219f9dd94d490ba3098dd68` (2026-07-26 22:49:03 +0900)。
以下「ShogiHome:」で始まるファイル:行はすべてこの HEAD に対するもの。

---

## 要約

ShogiHome の定跡機能は、4形式（やねうら王テキスト `.db` / Apery `.bin` / ShogiGUI `.sbk` / やねうら王バイナリ `.ybb`）を
**読み・書き・相互変換**でき、in-memory と on-the-fly の2モードを持ち、on-the-fly でも編集できる
（差分をメモリに置き保存時にストリーミング merge する方式）。指し手の追加/削除/並べ替え/評価値・深さ・出現回数・
コメント編集、局面コメント編集、棋譜ファイル・ディレクトリ・現在開いている棋譜の全分岐からの一括取り込み
（対局者名フィルタ・手数範囲・コメントからの評価値取り込み付き）まで実装されていて、57 個のテストが付いている。
Windows / macOS / Linux 版が配布されている。[確定]

複数の定跡を同時に開いて重ね合わせる機能は、ShogiHome の issue #1456 として open のまま
（2026-01-10 起票、2026-07-27 時点で未実装）。[確定]

**`.db.bin` という形式は存在しない。** やねうら王のバイナリ定跡は `.ybb`、`book.bin` は Apery のもの（下の「定跡フォーマットの一次仕様」）。[確定]

---

## ShogiHome の定跡機能 実装確認表

| 能力                                       | 実装状況                                                                                                                                                             | 出典（ファイル:行 / リリースタグ）                                                                      | 等級   |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| 形式判定（拡張子）                         | `.db`→yane2016 / `.sbk`→sbk / `.ybb`→ybb / それ以外→apery                                                                                                            | ShogiHome:`src/background/book/index.ts:222-233`                                                        | [確定] |
| やねうら王 `.db` read                      | ヘッダ `#YANEURAOU-DB2016 1.00` 検証、BOM/CRLF 対応、`sfen`行+指し手行パース、`none`/空文字の score/depth 許容                                                       | `src/background/book/yaneuraou.ts:9,60-100,106-165`, `:118`                                             | [確定] |
| やねうら王 `.db` write                     | `storeYaneuraOuBook`。SFEN キーで sort して出力、コメント行も復元                                                                                                    | `src/background/book/yaneuraou.ts:210-225`                                                              | [確定] |
| やねうら王 `.db` on-the-fly read           | ファイル上の**二分探索**（1KB バッファ、`sfen ` マーカー走査）。開く前に SFEN 順ソート済みかを先頭1万件で検証し、未ソートなら拒否                                    | `yaneuraou.ts:337-384`, `:274-296`; 呼び出しは `index.ts:266-271`                                       | [確定] |
| Apery `.bin` read/write                    | 固定長レコード + Zobrist ハッシュ（テーブル 2701 行）                                                                                                                | `src/background/book/apery.ts` (204行), `apery_zobrist.ts` (2701行)                                     | [確定] |
| ShogiGUI `.sbk` read/write                 | protobuf ベース。on-the-fly 用 LUT (`SbkOnTheFlyLUT`) を構築                                                                                                         | `src/background/book/sbk.ts` (1122行), `proto/sbk.ts` (737行), `types.ts:35-40`                         | [確定] |
| やねうら王バイナリ `.ybb` read/write       | magic `YANE-BINBOOK-V1`、index(32B header + 44B/record) + moves 領域。little-endian 前提                                                                             | `src/background/book/ybb.ts:7-17`                                                                       | [確定] |
| **on-the-fly でも編集可**                  | 差分を `BookEntry.type="patch"` としてメモリに保持し、保存時に元ファイルと**ストリーミング merge**                                                                   | `index.ts:72-83, 741-777`; `yaneuraou.ts:227-272` (2-way merge)                                         | [確定] |
| 指し手の追加/更新                          | `updateBookMove`                                                                                                                                                     | `index.ts:660-696`                                                                                      | [確定] |
| 指し手の削除                               | `removeBookMove`                                                                                                                                                     | `index.ts:698-706`                                                                                      | [確定] |
| 指し手の並べ替え                           | `updateBookMoveOrder`（UI は `<select>` で順位指定）                                                                                                                 | `index.ts:708-726`; UI `src/renderer/view/primitive/BookView.vue:35-38`                                 | [確定] |
| 評価値 / 深さ / 出現回数 / コメント編集    | BookMoveDialog で編集可（形式ごとの対応は仕様表参照）                                                                                                                | `specs/book-data-fields.md:13-16`; `src/renderer/view/dialog/BookMoveDialog.vue`                        | [確定] |
| SBK 指し手評価（絶対手/好手/疑問手/悪手）  | 表示・編集とも可                                                                                                                                                     | `specs/book-data-fields.md:17`; `BookView.vue:136-139`                                                  | [確定] |
| 局面コメント編集                           | yane2016 / sbk のみ。apery / ybb は例外送出                                                                                                                          | `index.ts:636-648`; `specs/book-data-fields.md:32,41`                                                   | [確定] |
| 形式変換（export）                         | `exportBook`。yane2016 / sbk / ybb → 任意形式。**Apery を入力とする変換のみ非対応**（ハッシュから局面を復元できないため）                                            | `index.ts:483-588`, 特に `:508-512`                                                                     | [確定] |
| 棋譜ファイル/ディレクトリからの取り込み    | KIF/KI2/CSA/SFEN、ディレクトリ再帰、対局者名フィルタ、手数範囲、コメントからの評価値取り込み                                                                         | `index.ts:805-1037`; 設定型 `src/common/settings/book.ts:16-25`                                         | [確定] |
| **現在開いている棋譜の全分岐を定跡に出力** | AddBookMovesDialog の「現在の棋譜から」タブ。`record.forEach` で**分岐も含め全ノード**を列挙し、`registerAllMoves` で一括登録。分岐点は `isFirstBranch` で区切り表示 | `src/renderer/view/dialog/AddBookMovesDialog.vue:189-229, 251-267`; i18n key `fromCurrentRecord` (`:8`) | [確定] |
| 反転局面の検索 (FlippedBook)               | 既定 ON                                                                                                                                                              | `src/common/settings/app.ts:238`, `:406`(`flippedBook: true`); リリース v1.22.0                         | [確定] |
| 千日手ラベル                               | 定跡手を選ぶとループする場合に表示                                                                                                                                   | v1.21.0 リリースノート; `src/renderer/store/book.ts:66-76`                                              | [確定] |
| 空の定跡を新規作成                         | 4形式から選択して新規作成                                                                                                                                            | `src/renderer/view/dialog/ResetBookDialog.vue:6-16`; `index.ts:154-185`                                 | [確定] |
| 定跡ファイル情報ダイアログ                 | format / mode / path / 局面数 / 未保存 / SBK 作者・説明                                                                                                              | `src/common/book.ts:69-77`; `BookPropertiesDialog.vue`; v1.29.0-alpha.1 (#1666)                         | [確定] |
| エンジンの代わりに定跡で着手               | v1.27.0 (#1457)。v1.29.0-alpha.1 で重み付き選択 (#1667)                                                                                                              | リリース v1.27.0 / v1.29.0-alpha.1                                                                      | [確定] |
| OS                                         | Windows / macOS / Linux(AppImage, deb) の release asset を確認                                                                                                       | v1.28.0 assets: `release-v1.28.0-{win,portable,mac,linux-appimage,linux-deb}.zip`                       | [確定] |
| **Web(PWA)版では定跡編集不可**             | `updateBookMove` 等が `thisFeatureNotAvailableOnWebApp` を throw                                                                                                     | `src/renderer/ipc/web.ts:357-372`                                                                       | [確定] |
| 性能制約: しきい値                         | `.db`/`.bin`/`.ybb` = 64MB, `.sbk` = 16MB を超えると自動 on-the-fly。UI から変更可                                                                                   | `src/common/settings/app.ts:401-405`; `AppSettingsDialog.vue:554-590`; 判定は `index.ts:341-366`        | [確定] |
| 性能制約: Electron ヒープ 4GB              | ポインタ圧縮によりヒープ 4GB 上限。1GB の定跡を連想配列に展開すると 4GB 超が必要 → 編集モードで開けなかった。**on-the-fly 編集導入で解消**（2025-08-25 close）       | issue #1311 本文 https://github.com/sunfish-shogi/shogihome/issues/1311 ; 解消は v1.25.0 (#1314)        | [確定] |
| 性能制約: 形式変換は全読み                 | 「形式ごとにソートキーが異なるためストリーミングは実装コストが高い。メモリを多量に消費するがどうしても必要になるまでストリーミングには対応しない」（原文コメント）   | `index.ts:514-516`                                                                                      | [確定] |
| テスト                                     | 定跡モジュールに 57 テスト（index 44 / yaneuraou 4 / store 6 / sbk 2 / ybb 1）+ 24 個のテストデータ定跡ファイル + apery ベンチ                                       | `src/tests/background/book/*.spec.ts`, `src/tests/testdata/book/`                                       | [確定] |

### 定跡関連リリースの全件（バージョン + 日付 + 原文）

`gh api --paginate repos/sunfish-shogi/shogihome/releases` の body を全件取得し `定跡|book` で抽出（stable リリースのみ抜粋、alpha/beta の重複行は省略）。

| バージョン      | 公開日 (UTC)   | 原文                                                                                                                                                                                                                                                                                                                                                                                    | タグURL                                                         |
| --------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| v1.20.0         | 2024-12-28     | `* 定跡機能 by @sunfish-shogi in .../pull/1023 .../pull/1029`                                                                                                                                                                                                                                                                                                                           | https://github.com/sunfish-shogi/shogihome/releases/tag/v1.20.0 |
| v1.20.1         | 2025-01-03     | `* 定跡パネルの表示改善 ... #1042 #1043` / `* やねうら王定跡フォーマットに関する実装の改善 ... #1049`                                                                                                                                                                                                                                                                                   | .../tag/v1.20.1                                                 |
| v1.20.3         | 2025-01-10     | `- やねうら王定跡フォーマット2016の読み込みの問題を修正 ... #1065`                                                                                                                                                                                                                                                                                                                      | .../tag/v1.20.3                                                 |
| v1.20.7         | 2025-03-23     | `* 定跡手追加時に対局者名でフィルターすると記名無しの指し手が入る問題を修正 #1145`                                                                                                                                                                                                                                                                                                      | .../tag/v1.20.7                                                 |
| v1.21.0         | 2025-02-08     | `* Apery 定跡ファイルのサポート ... #1040` / `* 定跡手を選ぶと棋譜がループする場合に「千日手」ラベルを表示する機能 ... #1055`                                                                                                                                                                                                                                                           | .../tag/v1.21.0                                                 |
| v1.21.3         | 2025-03-23     | `* Apery 定跡フォーマットへ指し手を新規登録できない問題の修正 #1144`                                                                                                                                                                                                                                                                                                                    | .../tag/v1.21.3                                                 |
| v1.22.0         | 2025-04-11     | `* 反転した局面を定跡から検索する機能 ... #1134`                                                                                                                                                                                                                                                                                                                                        | .../tag/v1.22.0                                                 |
| v1.22.1-pv2book | 2025-04-26     | `これは v1.22.1 をベースに、読み筋を定跡登録する機能を試作したものです。`                                                                                                                                                                                                                                                                                                               | .../tag/v1.22.1-pv2book                                         |
| v1.24.0         | 2025-07-06     | `* .sfenファイルからの定跡手取り込みに対応 ... #1254` / `* 定跡手追加ダイアログの多言語対応 ... #1247`                                                                                                                                                                                                                                                                                  | .../tag/v1.24.0                                                 |
| v1.25.0         | 2025-09-06     | `* 定跡の編集をOn-the-flyモードでも可能にする機能改善 ... #1314` / `* .sfen から定跡手をインポートする際に1行ごとに進捗率を更新 ... #1328`                                                                                                                                                                                                                                              | .../tag/v1.25.0                                                 |
| v1.26.0         | 2025-12-25     | `* On-the-fly モードでの定跡手登録の高速化 ... #1327`                                                                                                                                                                                                                                                                                                                                   | .../tag/v1.26.0                                                 |
| v1.26.2         | 2026-03-15     | `- 定跡を On-tye-fly で開いた時の未保存判定の問題を修正`                                                                                                                                                                                                                                                                                                                                | .../tag/v1.26.2                                                 |
| v1.27.0         | 2026-03-15     | `* エンジンの代わりに定跡を検索して着手する機能 ... #1457`                                                                                                                                                                                                                                                                                                                              | .../tag/v1.27.0                                                 |
| **v1.28.0**     | **2026-06-27** | `* ShogiGUI 定跡フォーマット (.sbk) 対応 ... #1525 #1527 #1528 #1530 #1534 #1535 #1538 #1539 #1542 #1543 #1602`<br>`* 定跡フォーマット変換機能 ... #1531`<br>`* 現在の定跡フォーマットを示すラベルを設置 ... #1546`<br>`* 棋譜ファイルから定跡手と一緒に評価値を取り込む機能 ... #1630`<br>`* 定跡手追加ダイアログの改善 ... #1636`<br>`* 定跡で着手する際のエラー処理を改善 ... #1529` | .../tag/v1.28.0                                                 |
| v1.29.0-alpha.0 | 2026-06-27     | `* やねうら王バイナリ定跡DB (.ybb) サポート #1648`                                                                                                                                                                                                                                                                                                                                      | .../tag/v1.29.0-alpha.0                                         |
| v1.29.0-alpha.1 | 2026-07-19     | `* 定跡着手機能に重み付き選択オプションを実装 ... #1667`<br>`* 定跡のファイルや局面に関する情報を表示する UI を追加 ... #1666`                                                                                                                                                                                                                                                          | .../tag/v1.29.0-alpha.1                                         |

**v1.20.0 の記述の原文**（依頼どおり全文引用）:

```
## What's Changed

### 新機能

* 定跡機能 by @sunfish-shogi in https://github.com/sunfish-shogi/shogihome/pull/1023 https://github.com/sunfish-shogi/shogihome/pull/1029
* 監視機能を別ウィンドウで表示可能にする改善 by @sunfish-shogi in https://github.com/sunfish-shogi/shogihome/pull/1030
* エンジンのファイルを差し替える機能 by @sunfish-shogi in https://github.com/sunfish-shogi/shogihome/pull/1032
```

→ v1.20.0 (2024-12-28) の記述は「定跡機能」の一語のみ。**「v1.20.0 でやねうら王 .db を read/edit/save 対応済み」という調査前提は、v1.20.0 の時点では `.db` のみが対象**であり、`.bin` は v1.21.0、`.sbk` は v1.28.0、`.ybb` は v1.29.0-alpha.0 と段階的である。[確定]

### ShogiHome 公式ドキュメントの記述（および**その陳腐化**）

- リポジトリ内仕様書 `specs/book-data-fields.md`（73行）が、**定跡データ項目ごとの「UI 表示」「UI 編集」対応状況**を表で持っている。
  これは調査対象として理想的な一次資料。全文は上記表の出典に反映済み。[確定]
- Wiki `ファイル形式の種類.md:36-46` の「定跡のフォーマット」表は、clone HEAD 時点で
  `| .sbk | ShogiGUI | 対応予定なし |` と書かれている。**これは v1.28.0 (2026-06-27) の .sbk 対応と矛盾しており、Wiki が古い。**
  出典: https://github.com/sunfish-shogi/shogihome/wiki (`ファイル形式の種類`)。[確定]
  → **教訓: ドキュメント層は当てにならない。ソースが唯一の権威。**
- `docs/how-to-use.html` に「定跡」の記述は **0 件**（grep 該当なし）。[確定]

---

## 定跡フォーマットの一次仕様（やねうら王）

やねうら王 `docs/` 配下の `.txt` は**中身が Wiki への転送スタブに置換済み**（原文: 「ここにあったテキストは、やねうら王Wikiに移動しました。」）。
出典: https://raw.githubusercontent.com/yaneurao/YaneuraOu/master/docs/USI拡張コマンド.txt , 同 `docs/やねうら大定跡.txt` [確定]
→ **仕様の一次資料は Wiki `定跡の作成.md`（444行）とソース `source/book/book.h`。**

| 項目                                       | 内容                                                                                                                                                                                   | 出典                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| ヘッダ定数                                 | `static const char* BookDBHeader2016_100 = "#YANEURAOU-DB2016 1.00";`                                                                                                                  | `source/book/book.h:24`                                   |
| 元仕様記事へのポインタ（ソース内コメント） | `// 将棋ソフト用の標準定跡ファイルフォーマットの提案 : http://yaneuraou.yaneu.com/2016/02/05/standard-shogi-book-format/`                                                              | `source/book/book.h:47`                                   |
| BookMove 構造体                            | `Move16 move; Move16 ponder; int value; int depth; uint64_t move_count;`（value/depth/move_count は「定跡DBに書かれているとは限らない optional な項目」とコメント）                    | `source/book/book.h:51-68`                                |
| ソート規約                                 | 出現回数の降順、同数なら評価値の降順                                                                                                                                                   | `source/book/book.h:84-86`                                |
| 書式（`.db`）                              | `sfen <sfen文字列>` 行 + `<指し手> <相手の応手> <評価値> <探索深さ> <選択回数>` 行の並び。応手が無いときは `none`                                                                      | Wiki `定跡の作成.md:72-96`                                |
| `# NOE:N`                                  | Num Of Entries。局面数。事前に書かれていると固定サイズ確保で高速化                                                                                                                     | Wiki `定跡の作成.md:64-70`                                |
| 候補手の並び順の保証                       | 評価値なし定跡は出現頻度降順、評価値付き定跡は手番側から見た評価値降順。「通常は1つ目に書かれている指し手がその局面の best move」                                                      | Wiki `定跡の作成.md:110-114`                              |
| BookOnTheFly の前提                        | 「定跡DBは SFEN 文字列順に sort されている必要があります。sort されていないと二分探索できないため、定跡に hit しないことがあります。」                                                 | Wiki `定跡の作成.md:116-120`                              |
| 文字コード                                 | 「基本的には ASCII」「UTF-8 BOM付きでも読み込めることがありますが、互換性を考えると ASCII 範囲の文字だけで書くのが無難」                                                               | Wiki `定跡の作成.md:122-126`                              |
| `.ybb`（バイナリ定跡DB）                   | 「巨大定跡を高速に on-the-fly probe するためのバイナリ形式」「人間がテキストエディタで直接編集するための形式ではありません」。ファイル構成 / index 領域 / moves 領域 / endian の節あり | Wiki `定跡の作成.md:128-245`                              |
| Apery `book.bin` の扱い                    | 「Aperyの定跡ファイルは"book/book.bin"だと仮定。(これはon the fly読み込みに非対応なので丸読みする)」                                                                                   | `source/book/book.h:184`; 定数 `source/book/book.cpp:203` |
| makebook コマンド                          | 本体に残るのは `makebook peta_shock` のみ。他は Python スクリプトへ移行                                                                                                                | Wiki `定跡の作成.md:328-340`                              |

Wiki URL: https://github.com/yaneurao/YaneuraOu/wiki/定跡の作成
元仕様記事: https://yaneuraou.yaneu.com/2016/02/05/standard-shogi-book-format/
Wayback: http://web.archive.org/web/20260520102621/http://yaneuraou.yaneu.com/2016/02/05/standard-shogi-book-format/ [確定：スナップショット存在を availability API で確認]

> **重要: `.db.bin` というフォーマットは存在しない。** [確定]
> `yane/book.cpp` / `book.h` を `.bin` で grep して出るのは Apery の `book.bin` のみ（`book.cpp:203` `kAperyBookName = "book.bin"`、`book.cpp:1334` の候補リスト `"user_book1.db", ..., "book.bin"`）。
> やねうら王のバイナリ定跡は **`.ybb`**（2026年に追加、`book.h:246-278`）。
> **`.db.bin` という拡張子の形式は存在しない。**

---

## 周辺ツール（BookConv ほか）の実測

### BookConv — `ai5/BookConv`

| 項目                    | 実測値                                                                                              | 出典                                                     | 等級   |
| ----------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------ |
| URL                     | https://github.com/ai5/BookConv                                                                     | `gh api repos/ai5/BookConv`                              | [確定] |
| 言語 / 種別             | C# / `<OutputType>WinExe</OutputType>` = **GUI (WinForms)**。CLI ではない                           | `BookConv/BookConv.csproj:8`; `BookConv/Form1.cs` の存在 | [確定] |
| ターゲット              | `<TargetFrameworkVersion>v4.5.2</TargetFrameworkVersion>` = **.NET Framework 4.5.2 → Windows 専用** | `BookConv/BookConv.csproj:12`                            | [確定] |
| ライセンス              | **なし**（`license: null`）                                                                         | `gh api repos/ai5/BookConv`                              | [確定] |
| 最終リリース            | **r8 / 2017-04-26**（asset: `BookConv.zip`）。以降 9年間リリースなし                                | `gh api repos/ai5/BookConv/releases`                     | [確定] |
| 最終 push               | 2026-03-09                                                                                          | 同上                                                     | [確定] |
| star                    | 11                                                                                                  | 同上                                                     | [確定] |
| 入力形式（README 原文） | `* ShogiGUIの定跡（.sbk)` / `* 技巧定跡(book.bin)` / `* やねうら王定跡(.db)`                        | `readme.md`（Shift-JIS。`iconv -f CP932` でデコード）    | [確定] |
| 出力形式（README 原文） | `* Apery定跡` / `* 技巧定跡` / `* やねうら王定跡` / `* ShogiGUI定跡`                                | 同上                                                     | [確定] |
| 内部 enum               | `enum BookFormat { Apery, YaneuraOu2016, Gikou, SBK }`                                              | `BookConv/BookFormat.cs`                                 | [確定] |
| 注意書き（原文）        | 「※技巧定跡からShogiGUIの定跡に変換した場合、評価値など失われますのでご注意ください。」             | `readme.md`                                              | [確定] |

> **調査前提の訂正**: 「BookConv が `.sbk` ↔ `book.bin` ↔ `.db` を処理」の `book.bin` は **技巧(Gikou)の book.bin であって Apery の book.bin ではない**。
> Apery は**出力専用**（入力に Apery は無い）。[確定]
> BookConv は Windows 専用の GUI で、ライセンスの表示が無く、9年間リリースが無い。[確定]

### YaneuraOu-ScriptCollection / makebook — 実質的な現行標準ツール

| 項目                         | 実測値                                                                                                                                                                                                                                         | 出典                                               | 等級   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------ |
| URL / ライセンス             | https://github.com/yaneurao/YaneuraOu-ScriptCollection / **MIT**                                                                                                                                                                               | `gh api repos/yaneurao/YaneuraOu-ScriptCollection` | [確定] |
| 最終 push                    | **2026-07-26**（現役）                                                                                                                                                                                                                         | 同上                                               | [確定] |
| 実体                         | `makebook/` に Python スクリプト 13本（+ README 480行）                                                                                                                                                                                        | `gh api .../contents/makebook`                     | [確定] |
| merge                        | `merge.py`（オンメモリ）/ `merge_largebook.py`（一時ファイルで 2-way merge、入力のソート済みを前提にしない）。`.db`/`.ybb` 入出力                                                                                                              | `makebook/README.md:15-32, 154-200`                | [確定] |
| **merge のポリシー（原文）** | 「1. 候補手が空でない側を採用する。2. 先頭候補手の `depth` が深い側を採用する。3. `depth` が同じなら候補手数が多い側を採用する。4. それも同じなら第1引数側を採用する。」 さらに `bw`/`wb` で先手番局面・後手番局面を別 DB から採る先後別マージ | `makebook/README.md:164-180`                       | [確定] |
| sort                         | `sort.py` / `sort_largebook.py`                                                                                                                                                                                                                | `makebook/README.md:15-32`                         | [確定] |
| 形式変換                     | `convert_db_to_ybb.py` / `convert_ybb_to_db.py` / `convert_ybb_db-gui.py` / `convert_to_apery.py` / `convert_from_apery.py` / `peta_shock-gui.py`                                                                                              | 同上                                               | [確定] |
| 棋譜→定跡                    | `from_sfen.py`（SFEN棋譜列から `.db`/`.ybb` 生成）                                                                                                                                                                                             | 同上                                               | [確定] |
| 検証                         | 「テスト用の定跡DBで旧やねうら王 `makebook` 実装と byte 単位の一致を確認しています」（`from_sfen.py` / `merge.py` / `sort.py` / `convert_to_apery.py`）                                                                                        | `makebook/README.md:471-480`                       | [確定] |

→ 定跡のマージは MIT ライセンスの Python 実装（`makebook/merge.py`）として公開されていて、旧 makebook との byte 一致まで検証されている。[確定]

### その他

| ツール                                | 実測                                                                                                                                                                           | 出典                                                                                                                                                                               | 等級                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `yaneurao/ShogiBookTools`             | Python、「10億局面の超巨大定跡でも処理できるように」。sort/merge/部分抽出/戦型判定。**最終 push 2024-02-15、ライセンス null**。YaneuraOu-ScriptCollection に事実上置き換わった | `gh api repos/yaneurao/ShogiBookTools`; README                                                                                                                                     | [確定]                                                                                                                                   |
| BookMiner                             | YaneuraOu-ScriptCollection 内。大規模定跡採掘。**現在 1,500万局面、16台 PC・512並列**。128GB RAM で 1億局面まで想定                                                            | https://yaneuraou.yaneu.com/2026/06/18/shogi-bookminer/ (2026-06-18)<br>Wayback: http://web.archive.org/web/20260629054103/https://yaneuraou.yaneu.com/2026/06/18/shogi-bookminer/ | [推定]（WebFetch 経由の引用。数値は原文引用として提示されたもの。Wiki `定跡の作成.md:26-30` が BookMiner の存在と役割を裏付ける [確定]） |
| `ak110/Blunder.BookEditor`            | 「Blunder(C#版、C++版)の定跡編集ツール」。最終更新 **2016-07-10**、star 0。事実上死んでいる                                                                                    | `gh search repos "定跡 編集"`                                                                                                                                                      | [確定]                                                                                                                                   |
| GitHub topic `shogi` 全 40 件スイープ | 定跡編集を主目的とするリポジトリは **ShogiHome 以外に存在しない**（`shogidb2/joseki` は記事データ、`akicho8/shogi-extend` は汎用ツール集）                                     | `gh search repos --topic shogi --limit 40`                                                                                                                                         | [確定]                                                                                                                                   |
| ShogiGUI                              | 定跡機能あり（`.sbk`）。ただし**クローズドソース・Windows 専用**。公式マニュアルに定跡ページあり                                                                               | https://sites.google.com/site/shogigui/マニュアル/定跡 ; https://shogigui.siganus.com/download.html                                                                                | [推定]（検索結果由来。ソース非公開のため実装レベル確認は不可能 → **[未確認]**）                                                          |

### 定跡の入手経路（公開配布元・サイズ・更新頻度）

`gh api --paginate repos/yaneurao/YaneuraOu/releases` の asset を `book|定跡` で抽出。[確定]

| tag               | 公開日     | ファイル                    | サイズ   | DL数 |
| ----------------- | ---------- | --------------------------- | -------- | ---- |
| `new_petabook233` | 2025-06-21 | `new_petabook_20250505c.7z` | 72.56 MB | 2313 |
| `BOOK-700T-Shock` | 2019-05-12 | `700T-shock-book.zip`       | 5.59 MB  | 4402 |
| `BOOK-100T-Shock` | 2019-04-16 | `100T-shock-book.zip`       | 0.78 MB  | 7621 |
| `v4.73_book`      | 2017-07-10 | `standard_book.zip`         | 1.72 MB  | 4454 |
| `v4.73_book`      | 2017-07-10 | `yaneura_book1_V101.zip`    | 17.02 MB | 3675 |
| `v4.73_book`      | 2017-07-10 | `yaneura_book3.zip`         | 1.16 MB  | 3538 |

- 有償配布（BOOTH 等）: 「電竜戦TSEC7「Nnuenagon」・使用定跡」3,000JPY (2026-07-12) ほか。
  出典: ShogiHome Wiki `Links.md:90` https://dainagon-shogi.booth.pm/items/8607978 [確定]
- 「やねうら王プロジェクトの支援者は、不定期で水匠や大規模定跡データの新バージョンを受け取ることができます。」
  出典: ShogiHome Wiki `Links.md:50` [確定]
- **含意**: 公開の無償定跡は圧縮後 0.78–72.6MB。展開後でも ShogiHome の既定しきい値（`.db` 64MB）近辺〜超程度で、
  **on-the-fly が既に効く範囲**。真に巨大なもの（BookMiner の 1,500万局面級）は `.ybb` 前提で、
  ShogiHome も v1.29.0-alpha.0 で追随済み。[推定：しきい値と公開サイズの突き合わせによる]

---

## 開発者の公開の発言

ShogiHome の開発者（Kubo Ryosuke = sunfish-shogi）は、定跡機能の位置づけを次のように書いている。

> 将棋 AI 大会用の定跡ファイルを編集する。

> 定跡の勉強は書籍やブログ、動画をメインにして、将棋 AI や定跡データベースは補助的に利用することをお勧めします。

出典: Kubo Ryosuke「ShogiHome の定跡機能を使いこなす」 https://note.com/ryosuke_kubo/n/nb50932229b9f (2025-12-31)。
Wayback のスナップショットは無い（availability API で確認）。[推定：WebFetch 経由の引用]

---

## 試した検索語の全リスト（失敗も含む）

### `gh api`（一次・成功）

- `repos/sunfish-shogi/shogihome`（メタ）
- `repos/sunfish-shogi/shogihome/releases`（`--paginate`、165行 = 全リリース）
- `repos/sunfish-shogi/shogihome/releases/tags/{v1.20.0,v1.29.0-alpha.0,v1.29.0-alpha.1}`
- `repos/sunfish-shogi/shogihome/releases/latest`（asset で OS 確認）
- `search/issues?q=repo:sunfish-shogi/shogihome+定跡+is:issue`（32件ヒット）
- `repos/sunfish-shogi/shogihome/issues/{1456,1311,1650}`
- GraphQL `repository.discussions`（totalCount = 1、定跡関連 0件）
- `repos/yaneurao/YaneuraOu`, `repos/yaneurao/YaneuraOu/releases --paginate`（定跡 asset 抽出）
- `repos/yaneurao/YaneuraOu/git/trees/master?recursive=1`
- `repos/yaneurao/YaneuraOu-ScriptCollection`, `.../contents/makebook`
- `repos/yaneurao/ShogiBookTools`
- `repos/ai5/BookConv`, `repos/ai5/BookConv/releases`

### `git clone --depth 1`（一次・成功）

- `sunfish-shogi/shogihome`（HEAD f07e934）
- `sunfish-shogi/shogihome.wiki`
- `yaneurao/YaneuraOu.wiki`
- `ai5/BookConv`

### `curl raw.githubusercontent.com`（一次・成功）

- `yaneurao/YaneuraOu/master/source/book/{book.h,book.cpp,apery_book.h}`
- `yaneurao/YaneuraOu/master/docs/{USI拡張コマンド.txt,やねうら大定跡.txt}` ← **中身が Wiki 転送スタブだった（失敗扱い）**
- `yaneurao/YaneuraOu-ScriptCollection/main/makebook/README.md`

### `gh search repos`（発見スイープ）

- `bookconv` → `ai5/BookConv` を特定（他は電子書籍変換ツールでノイズ）
- `--topic shogi --limit 40` → 定跡編集専用リポジトリは ShogiHome 以外**ゼロ**
- `"定跡 編集"` → `ak110/Blunder.BookEditor` のみ（2016年、star 0）
- `"定跡 エディタ"` → **0件**
- `"shogi opening book editor"` → **0件**
- `"YANEURAOU-DB2016"` → **0件**

### WebSearch（補助・要約は事実として扱っていない）

- `ShogiHome 定跡 編集 使いにくい 不満` → 具体的な不満投稿は**発見できず**
- `将棋 定跡ファイル 編集 ツール ShogiGUI やねうら王 .db 自作 2026` → `ShogiBookTools`, BookMiner 記事を発見（→ 一次で裏取り）
- `ShogiHome 定跡 巨大 開けない メモリ 重い` → note 記事群を発見（→ WebFetch で確認）

### WebFetch（一次ページに対して。ただし要約器経由なので [推定] 扱い）

- https://note.com/ryosuke_kubo/n/nb50932229b9f （2回。制限事項と対象読者）
- https://yaneuraou.yaneu.com/2026/06/18/shogi-bookminer/

### Wayback availability API

- `standard-shogi-book-format` → スナップショット **有**（20260520102621）
- `note.com/ryosuke_kubo/n/nb50932229b9f` → **無**
- `shogi-bookminer` → スナップショット **有**（20260629054103）

### ローカル

- `gh issue list`（obs-shogi）、`gh issue view 84,90..100`

---

## 未確認のこと

1. **ShogiGUI の定跡機能の実装レベル。**
   クローズドソースのため、ソースを読む規律では検証できない。
   `.sbk` の実装は ShogiHome の `sbk.ts` / BookConv の `SBook.cs` から逆算できるが、
   ShogiGUI 本体の編集 UI の範囲は **[未確認]** のまま。

2. **最も再利用価値の高い一次資料**は ShogiHome の `specs/book-data-fields.md`
   （73行、形式×項目×表示可否×編集可否のマトリクス）。
   https://github.com/sunfish-shogi/shogihome/blob/main/specs/book-data-fields.md
