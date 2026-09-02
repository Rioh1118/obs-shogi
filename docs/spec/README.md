# 仕様書（spec）

**画面と機能について「いま何がそうなっているか」と「これから何を満たすべきか」を、
1つの読み物として並べる場所。**

`docs/state-transitions/` は状態とイベントの網羅表であって、画面の説明ではない。
issue は「直すこと」の集合であって、直っている部分を書かない。
その2つの隙間 —— **画面を開いたとき何ができて、何ができないのか** —— を埋めるのがここ。

## 章の分け方

| 章                                     | 何を置くか                                                   |
| -------------------------------------- | ------------------------------------------------------------ |
| [navigation-map.md](navigation-map.md) | 画面の全体像。ルート・モーダル・URL パラメータ・遷移の骨格   |
| `screens/`                             | **いま画面にあるもの**の仕様。実装が先にあり、後から書いた   |
| `features/`                            | **まだ画面に無いもの**の要件。要件が先にあり、実装はこれから |

`screens/` と `features/` の境目は「main に実装があるか」だけで引く。
未マージのブランチにあるものは `features/` に置き、**どのブランチに何があるか**を書く。

## 画面の一覧

すべての画面に仕様書がある状態を保つ。**新しい画面を足したらここに行を足す。**

### 常設の画面

| 画面                     | 仕様                                                 | 実体                                            |
| ------------------------ | ---------------------------------------------------- | ----------------------------------------------- |
| 起動・ワークスペース選択 | [screens/boot.md](screens/boot.md)                   | `pages/AppLoading.tsx` `pages/FolderSelect.tsx` |
| アプリのシェル           | [screens/app-layout.md](screens/app-layout.md)       | `pages/AppLayout.tsx`                           |
| ファイルツリー           | [screens/file-tree.md](screens/file-tree.md)         | `widgets/file-tree/`                            |
| 盤・駒台・操作列         | [screens/board.md](screens/board.md)                 | `widgets/game-board/`                           |
| 棋譜ストリーム           | [screens/kifu-stream.md](screens/kifu-stream.md)     | `widgets/kifu-stream/`                          |
| 解析ペイン               | [screens/analysis-pane.md](screens/analysis-pane.md) | `widgets/analysis-pane/`                        |

### モーダル

| 画面                     | 仕様                                                               | `modal=` の値                             |
| ------------------------ | ------------------------------------------------------------------ | ----------------------------------------- |
| 局面ナビゲーション       | [screens/position-navigation.md](screens/position-navigation.md)   | `navigation`                              |
| 局面検索                 | [screens/position-search.md](screens/position-search.md)           | `position-search`                         |
| 課題局面（一覧・登録）   | [screens/study-positions.md](screens/study-positions.md)           | `study-positions` / `study-position-save` |
| ファイル作成             | [screens/create-file.md](screens/create-file.md)                   | `create-file` / `sfen-kifu-create`        |
| 設定                     | [screens/settings.md](screens/settings.md)                         | `settings`                                |
| プリセット編集           | [screens/engine-preset-dialog.md](screens/engine-preset-dialog.md) | （URL を持たない）                        |
| 衝突・読み込み失敗・更新 | [screens/system-dialogs.md](screens/system-dialogs.md)             | （URL を持たない）                        |

## これからの機能

| 機能                       | 仕様                                                     | 追跡          | main にあるか            |
| -------------------------- | -------------------------------------------------------- | ------------- | ------------------------ |
| 局面編集モード             | [features/position-edit.md](features/position-edit.md)   | #113 #289     | 無い                     |
| 棋譜メタデータの編集       | [features/kifu-metadata.md](features/kifu-metadata.md)   | #114 #289     | 無い（作成時のみ入力可） |
| 特殊な手の挿入             | [features/special-moves.md](features/special-moves.md)   | #115 #289     | 読むだけ。書けない       |
| 定跡（book）               | [features/book.md](features/book.md)                     | #283 ほか     | 無い（`feature/book`）   |
| 対局                       | [features/game-play.md](features/game-play.md)           | #354 ほか     | 無い（作業ブランチ）     |
| USI オプション・解析モード | [features/engine-options.md](features/engine-options.md) | #83 #107 #110 | 無い                     |

## 書き方

各仕様書は次の順で書く。**節を勝手に増やさない。** 増やしたくなったら、それは
別の仕様書に属している合図。

1. **目的** — 誰が何のために開くか。1〜2文
2. **出入口** — どこから来て、どこへ抜けるか
3. **画面構成** — 何がどこにあるか
4. **状態** — 画面が取りうる状態。表で書く
5. **操作と結果** — 押したら何が起きるか。表で書く
6. **失敗の見せ方** — 落ちたとき何が出るか。**出ないなら「出ない」と書く**
7. **いま満たしていないこと** — issue 番号つき
8. **これからの要件** — 決まっているものだけ

### 守ること

- **誇張しない。** 「テストがある」「検証済み」は、実際にそのファイルを開いて確かめてから書く
- **件数を断言するときは数えた値を書く。** 「多い」「ほとんど」で濁さない
- **無いものを「無い」と書く。** 復帰導線が無い、失敗が出ない、テストが無い、は仕様である
- **状態遷移表を二重に持たない。** `docs/state-transitions/` にある表はリンクする。
  そこに無い画面だけ、この中に小さい表を置く
- **画面の説明に実装の経緯を書かない。** どう変わってきたかは git log と PR にある

## 関係する文書

- `docs/state-transitions/` — 状態 × イベントの網羅表。**この spec の裏取り**
- `docs/decisions/` — ADR。とくに ADR-0004（通知の段）と ADR-0005（ボタンと対話の面）は
  ほぼ全画面に効く
- `docs/PREMISES.md` — 機能を作る／作らない判断が乗っている前提
- `docs/OPEN-QUESTIONS.md` — まだ決めていないこと。`features/` の空欄はここに紐づく
- `docs/IDEAS.md` — 6週間以内に着手しないもの。**`features/` には置かない**
