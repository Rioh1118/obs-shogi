# other-guis — ShogiHome 以外の GUI のエンジン周りの事実

エンジン設定・挙動を標準に揃える仕様の前段として、**ShogiHome と USI 原典以外**の GUI が
実際にどうしているかを記録する。**方針は書かない。** 規律と証拠の等級は `research/README.md` に従う。

取得日はすべて **2026-10-31**。

## 対象

| 対象                           | 立場                                                 | 取り方 | 版                                                                                  |
| ------------------------------ | ---------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `en-croissant.md`（En Croissant） | Tauri + React + Rust のチェス GUI。UCI。解析が主     | ソース | `franciscoBSalgueiro/en-croissant` `8c4a1e45893061cb50a5d3bd656818870dc3332b`（package.json 0.15.1。2026-10-30 コミット） |
| `nibbler.md`（Nibbler）        | Electron の Leela 向け解析 GUI。UCI                  | ソース | `rooklift/nibbler` `67f9c93399da4acf164b032c2b259812c1f9b6fc`（package.json 2.5.9。2026-10-26 コミット） |
| `cutechess.md`（cutechess）    | Qt のエンジン対局管理。UCI / xboard                  | ソース | `cutechess/cutechess` `5e84232be4546aaedc9d87a96c91867a1da06ada`（2026-07-14 コミット） |
| `shogidokoro.md`（将棋所）     | 閉じた GUI。USI の事実上の標準を作った               | 公式マニュアル | 配布ページ記載の最新は 5.7.0（2025/06/14）。サイト最終更新 2026/02/07            |
| `shogigui.md`（ShogiGUI）      | 閉じた GUI。検討機能の代表                           | 公式マニュアル | 配布ページ記載の最新は 0.0.8.8（2026/7/1）。**マニュアルはそれより古い**（必要環境の記述が .NET 4.5 のまま。トップは 4.8.1） |

## ライセンスと引用の扱い

| 対象         | ライセンス / 権利                                   | 出典                       | この調査での扱い                                                                  |
| ------------ | --------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------- |
| En Croissant | GPL-3.0（`LICENSE`）                                | GitHub license API         | **コードは逐語で載せない。** パスと事実の要約のみ。画面の短い文言は識別のために引く |
| Nibbler      | GPL-3.0（`LICENSE.md`）                             | GitHub license API         | 同上                                                                              |
| cutechess    | GPL-3.0（`COPYING`。各ファイルの頭にも GPLv3+ の表示） | GitHub license API         | 同上                                                                              |
| 将棋所       | 閉じた実装。著作権は作者（サイトは商用目的の再配布を禁止と記載） | 公式トップ                 | 公式の文面は識別に要る範囲で短く引用する                                          |
| ShogiGUI     | 閉じた実装。著作権は作者                            | 公式サイト                 | 同上                                                                              |

**3つの OSS はいずれも MIT ではない。** obs-shogi にコードを持ち込む判断はこの調査の範囲外。

## 等級の使い方

- ソースの3件で `[確定]` と書いたものは**そのコミットのソースを読んで確かめた**という意味で、
  **実行して確かめたものではない。** 実行が要る主張には「実行はしていない」と書いた。
- 閉じた2件は、**公式の文面そのものは `[確定]`、そこから読み取れることは `[推定]`（根拠を併記）。**
  公式の文面に無いことは「公式の文面に無い」と書き、**推測で埋めていない。**

## 出典 URL

**将棋所**（`http://shogidokoro2.stars.ne.jp/` 配下。`http://shogidokoro.starfree.jp/` は応答なし）

- `usage.html`（使い方）/ `usi.html`（USI の解説。**ここでは「将棋所は〜する」と書かれた箇所だけ**を見た。USI 原典の調査は別担当）
- `enginecaution.html`（エンジン作成時の注意点）/ `translate.html`（日本語表示）/ `function.html` / `download.html`
- 画面写真 `images/Analyze.png` `AnalyzingNow.png` `AnalyzingPause.png` `EngineRegister.png` `MultiPV.png` `Debug.png`

**ShogiGUI**

- `https://shogigui.siganus.com/`（トップ）/ `manuals/consider_multi.html`（複数エンジンでの検討）/ `support.html`
- `https://sites.google.com/site/shogigui/マニュアル/…`（配下の 将棋エンジン設定 / リファレンス/ツールメニューエンジン設定 / リファレンス/ツールメニュー-検討設定 / 検討 / 棋譜解析 / 定跡 / その他の機能/アシスタント / その他の機能/ヒント詰み探索 / ユーザーインターフェース / 情報ウインドウ/思考ウインドウ）
- よくある質問: `https://sites.google.com/site/shogixyz/home/shogigui/shogigui-faq` は 404。
  **Internet Archive の 2020-10-21 の写し**（`web.archive.org/web/20201021002009/…`）で読んだ。公式の文面の過去の写しとして扱う

## 調べ切れなかったこと

- **ShogiGUI のマニュアルの画面写真の大半が取得できなかった。** Google Sites の画像配信が HTML を返し、
  読めたのは5枚だけ。**再取得のために取得の仕方を変える試みは権限判定で拒否されたので、それ以上は試していない。**
  エンジン設定ダイアログ・検討ダイアログ・検討設定（本文なし、画像のみ）の中身は読めていない。
  ブラウザで開いて確認する人が要る
- 閉じた2件の時間切れ・異常終了の挙動はマニュアルに記載がなく、**実機の外形観測が要る。**
  ここでは行っていない（Windows 専用。将棋所は Mac 版が別にある）
- 3つの OSS も実行はしていない

## 再取得

```bash
REF=8c4a1e45893061cb50a5d3bd656818870dc3332b
gh api "repos/franciscoBSalgueiro/en-croissant/contents/<path>?ref=$REF" --jq .content | base64 -d
```
