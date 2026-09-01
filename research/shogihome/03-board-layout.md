# 03 盤と駒台のレイアウト

出典: `src/renderer/view/primitive/board/{params,layout,config,standard,compact,portrait,hand}.ts`、
`src/common/settings/layout.ts`
版: `de27f0c1c352`

**obs-shogi の「盤の比率は絶対に変えない」「駒台は盤と同じ長さの長方形にして、
狭くなったら駒を縦に並べる」という要求に、そのまま対応する実装がある。**

## 1. 比率の保ち方 —— 全部を1つのスカラで割る

`params.ts` に**設計上の固定座標**が px で書いてある。実行時にやるのはこれだけ。

```ts
get ratio(): number {
  let ratio = this.config.upperSizeLimit.width / standardViewParams.frame.width;
  if (standardViewParams.frame.height * ratio > this.config.upperSizeLimit.height) {
    ratio = this.config.upperSizeLimit.height / standardViewParams.frame.height;
  }
  return ratio;
}
```

`ratio = min(限界幅/設計幅, 限界高/設計高)` を出し、
**盤・駒台・手番表示・対局者名・時計・操作ボタンの全座標に同じ `ratio` を掛ける**
（`standard.ts` / `compact.ts` / `portrait.ts` の `build()` が
`params.x * ratio + "px"` を組み立てて style に流す）。

**比率が崩れる余地が構造的に無い。** CSS の `aspect-ratio` も
コンテナクエリも使っていない。**設計座標 × スカラ、それだけ。**

`config.upperSizeLimit` は `RectSize`。呼び出し側が使える矩形を渡す。

## 2. レイアウトは3種類。駒台の形が全く違う

`src/common/settings/layout.ts`:

```ts
export enum BoardLayoutType {
  STANDARD = "standard",
  COMPACT = "compact",
  PORTRAIT = "portrait",
}
```

`params.ts` の実数値（設計 px）。**ここが要点。**

|              | フレーム     | 盤        | 駒台          | 駒台の形                             |
| ------------ | ------------ | --------- | ------------- | ------------------------------------ |
| **STANDARD** | 1471 × 959 ※ | 878 × 960 | **288 × 360** | 横 2 列 × 縦 4 段の矩形。盤の左右    |
| **COMPACT**  | 1088 × 1015  | 878 × 960 | **95 × 728**  | **縦 1 列 × 7 段の細い帯。**盤の左右 |
| **PORTRAIT** | 878 × 1168   | 878 × 960 | **664 × 104** | **横 7 列 × 1 段の帯。**盤の上下     |

※ **フレームの高さ 959 が盤の高さ 960 より 1px 小さい。これは写し間違いではなく
`params.ts` の実装がそうなっている**（`standardViewParams.frame.height = 959` /
`boardParams.height = 960`）。左帯の `control.left` が `547 + 412 = 959` に着地するので、
フレームは操作ボタン側に合わせてある。**移植するときにこの 1px を再現する必要は無い。**

駒1枚は `commonParams.piece = { width: 88, height: 93 }`、
盤のマスは `squareWidth: 94.85, squareHeight: 104`。

- `compactHandParams`: `squareWidth: 95, squareHeight: 104` → **1列。** 95 ≒ マス1個分の幅。
  高さ 728 = 104 × 7 → **7段。7種類の駒がちょうど縦に1列に並ぶ。**
- `portraitHandParams`: `squareWidth: 94.85, squareHeight: 104`、幅 664 ≒ 94.85 × 7 →
  **7列 × 1段。横一列。**
- `standardViewParams.hand`: 288 × 360。288 ≒ 94.85 × 3、360 = 104 × 3.5 弱で、
  `handParams` の `row`/`column` 表を見ると **2列 × 4段**（歩だけ `width: 2` で2列ぶん）。

### 駒の並び順は表で持っている

`handParams.black` / `.white` が駒種ごとに `{ row, column, width }` を持つ。

```
black: 飛(0,0) 角(0,1) / 金(1,0) 銀(1,1) / 桂(2,0) 香(2,1) / 歩(3,0,width:2)
white: 歩(0,0,width:2) / 香(1,0) 桂(1,1) / 銀(2,0) 金(2,1) / 角(3,0) 飛(3,1)
```

**先手と後手で表が別。** 後手は上下が逆になるので、行番号を反転した表を
そのまま持っている（計算で出していない）。

コメント:

> 飛角・金銀・桂香のペアは `HandPieceOrder.STRONGER_TO_LEFT` の配置で定義し、
> `STRONGER_TO_RIGHT` の場合は `HandLayoutBuilder` 側で列を反転する。

**強い駒を左に置くか右に置くかがアプリ設定になっている**
（`HandPieceOrder`、`src/common/settings/app.ts`）。

## 3. 時計と対局者名は「盤のレイアウト」の一部

`src/renderer/view/primitive/board/layout.ts` の `Layout` 型:

```ts
export type Layout = {
  ratio: number;
  frame: Frame;
  boardStyle;
  blackHandStyle;
  whiteHandStyle;
  turn?: Turn;
  blackPlayerName: PlayerName;
  whitePlayerName: PlayerName;
  blackClock?: Clock;
  whiteClock?: Clock;
  control?: Control;
};
```

**時計・対局者名・手番表示・操作ボタンが盤と同じ矩形の中に居る。**
ヘッダにもドックにも出ていない。

STANDARD の座標（`standardViewParams`）:

```
右の帯 x=1184（幅 288。盤の右外）
  control.right  y=0    (288×412)   操作ボタン
  turn.black     y=425  (288×45)    手番
  playerName.black y=480 (288×45)
  clock.black    y=535  (288×55, fontSize 40)   ← 時計
  hand.black     y=600                          ← 駒台
左の帯 x=0
  white 側が上下対称に並び、control.left が y=547 (288×412)
```

**駒台のすぐ上に時計、その上に対局者名、その上に手番。** 縦一列。

### 時計を隠せる

`Config.hideClock?: boolean`。立てると `turn` と `playerName` が
`y` でなく **`y2`** を使う座標へ繰り上がる。

```
turn.black:       y=425 → y2=490
playerName.black: y=480 → y2=545
```

**時計の 55px ぶんを詰めて下へ寄せる**。空白が残らない。
`PositionEditingDialog` は `:hide-clock="true"` で開いている。

COMPACT / PORTRAIT には `y2` が無く、`hideClock` を見ていない。

## 4. 局面編集は PORTRAIT で開く

`src/renderer/view/dialog/PositionEditingDialog.vue`:

```html
<BoardView
  :layout-type="BoardLayoutType.PORTRAIT"
  :allow-edit="true"
  :allow-move="false"
  :hide-clock="true"
  :drop-shadows="false"
  ...
/>
<HorizontalSelector
  v-model:value="boardSizeLevel"
  :items="[{label:'Small',value:'small'},{label:'Medium',...},{label:'Large',...}]"
/>
```

**編集中の盤は横帯の駒台（PORTRAIT）で、大きさは Small/Medium/Large の3段を
利用者が選ぶ**（自動リサイズではない）。→ 詳細は [04](04-position-editing.md)。

## 5. 見た目のカスタマイズ

`Config`（`config.ts`）が持つもの:

```
boardImageType / pieceStandImageType / customBoardImageURL / customPieceStandImageURL
boardImageOpacity / pieceStandImageOpacity / boardGridColor / boardTextureImage
pieceImages（駒画像の URL テンプレート） / kingPieceType / handPieceOrder
promotionSelectorStyle / boardLabelType / upperSizeLimit / flip / hideClock
```

- 駒画像は `template.replaceAll("${piece}", ...)` で URL を組む。**差し替え可能。**
- `kingPieceType: GYOKU_AND_GYOKU` なら両方を「玉」にする。
- 盤・駒台に**独立した不透明度**がある（背景透過モード用）。
- ハイライト色は `params.ts` に固定値。
  選択 `#0088ff` / 直前手の移動先 `#44cc44`（opacity .8）/ 移動元 同色 opacity .4。
  駒台の選択は `#ff4800`（opacity .7）で**盤と色が違う**。
- `flip` は座標側で先後を入れ替える（**要素を CSS で 180° 回転させていない**）。

## obs-shogi との対応

|                | ShogiHome                              | obs-shogi（`main`）                                                                           |
| -------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| 比率の保ち方   | 設計座標 × スカラ `ratio`              | `aspect-ratio` ＋ `100cqh` から逆算。**盤クラスタは正しい**                                   |
| 駒台の形       | **3種（矩形 / 縦1列 / 横1列）**        | `aspect-ratio: 20/22` の**1種のみ**                                                           |
| 駒台の中身     | 駒種ごとの `{row, column, width}` 表   | `useHandLayout.ts` が枚数で4段に分配。**`containerWidth = 18`(rem) が直値で実寸を見ていない** |
| 駒の並び順     | 先後で別の表。左右の向きは設定         | `pieceOrder` 配列1本。向きの設定なし                                                          |
| 時計・対局者名 | 盤レイアウトの中。`hideClock` で詰める | 対局が無い。対局者名はヘッダ                                                                  |
| 盤の向き       | 座標で入れ替え                         | `.game-board--rotated` が `transform: rotate(180deg)`                                         |
| 駒画像・盤画像 | 差し替え可能                           | 固定                                                                                          |

## 所感

- **`ratio` 1本方式は、obs-shogi の「比率は絶対に変えない」要求に対する
  一番強い答え。** CSS に任せると `min-height` のような
  スケールに載らないプロパティから崩れる（ADR-0003 が既に踏んでいる問題）。
  設計座標を1か所に集めて掛け算だけするなら、崩れる場所が存在しない。
- ただし**代償は CSS の資産を全部捨てること**。ShogiHome は
  `style` を文字列で組み立てて要素に流している。obs-shogi は SCSS トークンと
  ラチェットに投資済みなので、そのまま真似ると衝突する。
  **`ratio` を CSS 変数として1つ配り、寸法をその倍数で書く**折衷はありうる。
- 駒台の3形は obs-shogi の要求（「盤と同じ長さの長方形」「駒が縦に並ぶ」）と
  **ほぼ一致している**。COMPACT の 95 × 728 がまさにそれ。
  ただし ShogiHome は**利用者が選ぶ設定**であって、幅で自動的に切り替えてはいない。
  「あるwidthより低くなると縦長」を自動でやるなら、それは ShogiHome より一歩先になる。
- **時計を盤の枠内に置いている**のは、obs-shogi 側の
  「時計ってドックにいらなくね？」という直感を裏付ける。
  盤・駒台・時計・手番・対局者名は1つの視線の中に置くもの、という判断。
