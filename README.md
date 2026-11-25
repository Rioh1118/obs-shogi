<div align="center">

<img src="./docs/images/icon_512x512.png" width="96" alt="ObsShogi のアイコン">

# ObsShogi

**棋譜のフォルダを、そのまま研究の場所にする将棋 GUI**

Windows / macOS / Linux

**[公式サイト](https://obs-shogi.com/)** ・ **[使い方のガイド](https://obs-shogi.com/guide/)** ・ [ダウンロード](https://obs-shogi.com/download/) ・ [よくある質問](https://obs-shogi.com/faq/)

[![最新版をダウンロード](https://img.shields.io/github/v/release/Rioh1118/obs-shogi?label=%E3%83%80%E3%82%A6%E3%83%B3%E3%83%AD%E3%83%BC%E3%83%89)](https://github.com/Rioh1118/obs-shogi/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE.md)

</div>

フォルダを1つ選ぶと、その下の棋譜がすべてツリーに並びます。
戦型ごと・大会ごとに分けたフォルダをそのまま行き来して、開いて、検討して、書き足す。
棋譜は普通のファイルのままなので、エディタや Git や同期サービスとも一緒に使えます。

入れ方と使い方の詳しい説明は、公式サイトの[ガイド](https://obs-shogi.com/guide/)にあります。

> [!NOTE]
> Beta 版です。棋譜ファイルは直接書き換えるので、大事な棋譜はバックアップを取ってから使ってください。

## できること

### フォルダ単位で棋譜を管理する

ツリーから棋譜とフォルダを作る・名前を変える・移動する・消す。
アプリの外でファイルを足したり動かしたりしても、ツリーと検索の索引はそれに追いつきます。

読み書きできる形式は KIF / KI2 / CSA / JKF。SFEN か盤の上で組んだ局面から、新しい棋譜を始めることもできます。

ガイド: [棋譜のフォルダを選ぶ](https://obs-shogi.com/guide/start/folder/) ／ [棋譜を開く・作る・取り込む](https://obs-shogi.com/guide/start/kifu-files/) ／ [局面を組んで、その局面から始まる棋譜を作る](https://obs-shogi.com/guide/kifu/position-edit/)

### フォルダ全体から局面を探す

いま盤に出ている局面が、フォルダ下のどの棋譜の何手目に現れるかを一度に引きます。
分岐の中の局面も対象です。

約600局・8.7万局面のフォルダで、索引を作るのに 0.4 秒、検索1回は 0.1 ミリ秒を切ります
（Apple M1 Pro / 10 コアで計測）。

ガイド: [局面検索で、同じ局面の棋譜を探す](https://obs-shogi.com/guide/kifu/position-search/)

### 変化を残して、キーボードでたどる

盤で手を指すと、途中の局面からなら変化として棋譜に残ります。手にはコメントも書けます。
分岐の多い研究棋譜を、`h` `j` `k` `l` で辿れる画面があります。

ガイド: [手を指して、変化とコメントを残す](https://obs-shogi.com/guide/kifu/moves/)

### エンジンで検討する

USI エンジンを登録して、いまの局面を検討できます。候補手は複数本（MultiPV）並べられます。
詰将棋エンジンを登録すれば、いまの局面に詰みがあるかも調べられます。
やねうら王形式（`.db` / `.ybb`）の定跡を開き、局面ごとの登録手を見ることもできます。

ガイド: [将棋エンジンと評価関数を登録する](https://obs-shogi.com/guide/engine/register/)

### 課題局面を溜める

「あとで調べたい局面」を登録して、状態とタグで整理できます。
棋譜ではなく局面に紐づくので、別の棋譜で同じ局面に着いても1つとして扱います。

ガイド: [課題局面に、あとで調べる局面を残す](https://obs-shogi.com/guide/kifu/study-positions/)

## インストール

[Releases](https://github.com/Rioh1118/obs-shogi/releases/latest) から OS に合うものを取ってください。
新しい版が出るとアプリの中で知らせ、そのまま更新できます。
OS ごとの入れ方は、公式サイトの[ダウンロード](https://obs-shogi.com/download/)のページにあります。

| OS      | ファイル                                                               |
| ------- | ---------------------------------------------------------------------- |
| Windows | `…-windows-x64-setup.exe` または `.msi`                                |
| macOS   | `…-darwin-aarch64.dmg`（Apple シリコン）／ `…-darwin-x64.dmg`（Intel） |
| Linux   | `.AppImage` / `.deb` / `.rpm`                                          |

macOS 版は Apple の公証を受けていません。
「壊れているため開けません」と出たら、アプリケーションフォルダに入れたあと次を一度だけ実行してください。

```bash
xattr -dr com.apple.quarantine /Applications/ObsShogi.app
```

## エンジンの設定

USI（[将棋所の説明](https://shogidokoro2.stars.ne.jp/usi.html)）に対応したエンジンなら使えます。
エンジンの実行ファイルと評価関数を1つのフォルダ（AI ライブラリ）に置き、設定画面でそのフォルダを選んでから、検討に使うプリセットを作ります。
置き方と登録の手順は、公式サイトの[将棋エンジンと評価関数を登録する](https://obs-shogi.com/guide/engine/register/)にあります。

## これから

棋譜の情報（対局者名など）を作った後に直すこと、特殊な手（投了など）の挿入、定跡の書き込み、対局を予定しています。
いま画面に何があって何が無いかは [`docs/spec/`](./docs/spec/README.md) にまとめてあります。

## 開発に参加する

Issue も Pull Request も歓迎します。研究で困ったこと、欲しい機能、USI エンジンまわりの使いにくさの報告は特に助かります。
開発環境の作り方と進め方は [`CONTRIBUTING.md`](./CONTRIBUTING.md) にあります。
公式サイトにも[開発に参加する](https://obs-shogi.com/contribute/)のページがあります。

## ライセンス

[MIT License](./LICENSE.md)。

配布しているバイナリには、同梱している書体（OFL-1.1）をはじめ第三者のソフトウェアが含まれます。
その著作権表示とライセンス本文は [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) にまとめてあり、
アプリと同じ場所に同梱して配布しています。
