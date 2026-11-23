# 札

状態：確定（v0.3、decisions/0005）。製品に入れた（2026-11-23）
トークン：`color.feedback.*`、`color.accent.bright`、`font.size.hint`

## 用途

行や見出しに、いまの状態を1語で添える。

## 使わない場面

- 分類や件数 → ふつうの字で添える
- うまくいった段階 → 出さない
- 押すもの → Button

## 組み立て

- **枠も背景も付けない。** 語だけ。記号は、直さないと動かないとき（⚠）と、適用中（銅の点）だけ
- 文字は `font.size.hint`。色は、適用中が `color.text.default`、直す必要があるものが `color.feedback.warning.default`、動かないものが `color.feedback.danger.text`
- 丸い札（枠つきの丸い形）を使わない。件数の丸いバッジも使わない

## アクセシビリティ

色だけで区別しない。語が状態を言う。

## 文言

`適用中` `要設定` のような体言。
