# USI プロトコルの原典

**ここは事実だけを置く。** 規律と証拠の等級は `research/README.md` に従う。
方針（obs-shogi をどうするか）はここに書かない。

## 何を、いつ取ったか

取得日はいずれも **2026-10-31**。本文は保管していない（下の「著作権の扱い」）。
同じものを開いたことは SHA-256 で確かめられる。

| 略称 | 資料 | URL | SHA-256（取得した HTML） |
| --- | --- | --- | --- |
| **将棋所版** | 将棋所「USIプロトコルとは」現行。応答の `last-modified: Fri, 28 Feb 2025 06:02:03 GMT` | <https://shogidokoro2.stars.ne.jp/usi.html> | `c1284996f0ba3d538bd5896399ab3322c9dacf2faaa4b137445046a66bcfe235` |
| **将棋所版（控え）** | 旧 URL の Wayback 控え（2025-02-08）。**タグを除いた本文は現行と完全に一致**（`diff` 0。改行コードだけが違う） | <http://web.archive.org/web/20250208203622id_/http://shogidokoro.starfree.jp/usi.html> | `ebbec3bd422fdd3a6ca9ed23e8e3a4c3108bf9e029944ead894213f1c45e0514` |
| **原案** | Tord Romstad "The Universal Shogi Interface, draft 1 (2007-01-24)" の Wayback 控え（2015-05-25）。将棋所版がリンクしている控えと同じ時点 | <http://web.archive.org/web/20150525174702id_/http://www.glaurungchess.com:80/shogi/usi.html> | `177e75d8cf43f4c44ba62b81317d5fd15f0fab8146cb29507d28bb8c35107a3b` |
| 参考 | H.G. Muller による再掲。原案に将棋所の拡張を書き足したもの。**本文の出典には使っていない** | <http://hgm.nubati.net/usi.html> | `66a98b45d89522ed8570bd790faa70f2dcf7a7086e07ccba2909d189fece68ad` |

### URL の経緯

- `http://shogidokoro.starfree.jp/usi.html` は取得日に接続できなかった
  （curl: port 80 / 443 とも接続失敗。WebFetch: `ECONNREFUSED 157.112.187.101:443`）。
  同じ環境から archive.org と hgm.nubati.net には届いているので、失敗は相手側と見ている（[推定]）
- `http://www.geocities.jp/shogidokoro/usi.html` は Yahoo! ジオシティーズの案内先へ転送され、
  その先の名前が引けなかった
- 現行の URL は上の2つの試行とは別に試して応答を得たもの。**将棋所の公式ページから辿って確かめてはいない**
  （[未確認]）。本文が旧 URL の控えと一致するので、同じ文書であること自体は [確定]

### 版の差

Wayback の CDX で見ると、旧 URL の本文のダイジェストは 2023-02-08 と 2023-03-25 の間で変わっている。
両者の本文の差分は1行だけで、末尾の「未対応のコマンド」一覧から `multipv` が消えた。

## 著作権の扱い

- **将棋所版**: 著作者は将棋所の作者（ページ内に著作権表示もライセンスの記載も無い。
  検索語: `copyright` `license` `著作` `all rights` `無断` `転載`）。
- **原案**: 著作者は Tord Romstad。原案にも著作権表示・ライセンスの記載は無い（同じ検索語）。
- **どちらも再配布を許す記載が無い**ので、本文の写しはこのリポジトリに置かない。
  置くのは、論じるのに必要な短い抜粋と、出典の URL・SHA-256 だけにする。
- 抜粋は `research/shogihome/README.md` と同じ規約にする。**印の無い引用は原文と機械的に突き合わせて
  一致を確認したもの**で、改変しない。省略は `…` で示す。
- 英語の原案の抜粋は訳さずそのまま置く。

## 再取得

```bash
curl -sS -o usi.html https://shogidokoro2.stars.ne.jp/usi.html
shasum -a 256 usi.html   # 上の表と比べる。違えば本文の差分を取り、01 を見直す

# 原案。id_ を付けると Wayback のツールバーが混ざらない
curl -sS -L -o draft.html \
  "http://web.archive.org/web/20150525174702id_/http://www.glaurungchess.com:80/shogi/usi.html"
```

## ファイル

| ファイル | 内容 |
| --- | --- |
| [01-usi-original.md](01-usi-original.md) | 規格が定める順序と義務、`go`、`option`、`info`、規格が定めていないこと |
