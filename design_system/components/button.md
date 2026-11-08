# Button

状態：見本（仕組みの確認用。値は仮）
トークン：`button.*`（design_system/tokens/component/button.tokens.json）

## 用途

画面上で操作を実行する。送信、保存、ダイアログを開く、など。

## 使わない場面

- 別のページへ移動するだけ → リンクを使う（見た目をボタンに寄せない）
- 選択肢から1つを選ぶ → ラジオボタンなどの選択部品を使う
- 1つの画面に主要な操作が2つ以上ある → primary は1つにし、残りは secondary にする

## バリアント

| バリアント | いつ使う | トークン |
| --- | --- | --- |
| primary | 画面で最も重要な操作。1画面に1つまで | `button.color.background.primary`、`button.color.text.primary` |
| secondary | それ以外の操作 | `button.color.background.secondary`、`button.color.text.secondary`、`button.color.border.secondary` |

## 状態

| 状態 | 表し方 |
| --- | --- |
| 通常 | 上の表のとおり |
| ホバー | 文字に下線（色は変えない。値が決まるまでの仮の表現） |
| フォーカス | 固定のフォーカスリング（`focus.ring.*`）。変更不可 |
| 無効 | 操作できないことを明示する。無効にする理由を近くに文章で示す |

## アクセシビリティ

- 文字と背景は 4.5:1 以上、境界線と背景は 3:1 以上（design_system/tokens/contrast-pairs.json で検査）。
- 文字の大きさは `font.size.body`（16px 以上）。
- ボタンの文言だけで何が起きるか分かるようにする（「こちら」「OK」だけにしない）。
- 種類は送信なら submit、それ以外は button を明示する。

## 良い例・悪い例

- 良い例：`examples/good/button-usage.*`
- 悪い例：`examples/bad/`（各ファイルの先頭に、どの規則に違反したかを書いてある）

## 文言

ボタン文言の形（「保存する」か「保存」か）は未定。`design_system/content/voice-and-tone.md` で決める。
