# 区切りボタン

状態：確定（v0.3、decisions/0005）。製品に入れた（2026-11-23）
トークン：`color.background.selected`、`color.border.strong`、`radius.control`

## 用途

2〜4の択一を、全部見せて1回で変える。研究状態、候補手の数、詰み探索の上限時間。

## 使わない場面

- 5つ以上、または増える択一 → 選択
- 見ているものを切り替える → タブ（`patterns/selection.md`）
- 入り切り → チェック

## 組み立て

- 1つの枠（`color.border.strong`、`radius.control`）に並べ、境は `color.border.default` の線1本
- 1つずつは文字の幅。**行いっぱいに伸ばさない**
- 文字は `font.size.body`。高さは並ぶ押すもの（md）に揃える
- もう一度押すと外れる択一は、外れたときの値を欄の説明に書く

## 状態

| 状態 | 見た目 |
| --- | --- |
| 選ばれた側 | `color.background.selected` と太字 |
| ポインタを載せた側 | `color.background.hover` |
| フォーカス | 固定の輪。隣の境の線より手前 |
| 無効 | 不透明度 0.45 |

## アクセシビリティ

必ず1つを選ぶなら択一の役、外せるなら押した状態を名乗る。選択を色だけで示さない。

## 文言

短い体言。
