# 06 タブペインとカスタムレイアウト

出典: `src/renderer/view/main/{TabPane,StandardLayout,CustomLayout,BoardPane,RecordPane,BookPanel,ControlPane}.vue`、
`src/common/settings/layout.ts`、`src/common/settings/app.ts`、
`src/renderer/view/layout/{LayoutManager,DragEditor}.vue`
版: `de27f0c1c352`

## 1. タブは7つ。**「対局」タブは無い**

`src/common/settings/app.ts`:

```ts
export enum Tab {
  RECORD_INFO = "recordInfo",
  COMMENT = "comment",
  SEARCH = "search",
  PV = "pv",
  CHART = "chart",
  PERCENTAGE_CHART = "percentageChart",
  MONITOR = "monitor",
  INVISIBLE = "invisible", // Deprecated
}
```

`TabPane.vue` の対応表:

| タブ               | 表示名   | 中身                                                  |
| ------------------ | -------- | ----------------------------------------------------- |
| `RECORD_INFO`      | 棋譜情報 | `RecordInfo.vue`                                      |
| `COMMENT`          | コメント | `RecordComment.vue`                                   |
| `SEARCH`           | 検討ログ | `EngineAnalytics` を **`historyMode: true`** で       |
| `PV`               | 読み筋   | 同じ `EngineAnalytics` を **`historyMode: false`** で |
| `CHART`            | 評価値   | `EvaluationChart` を `EvaluationChartType.RAW` で     |
| `PERCENTAGE_CHART` | 推定勝率 | 同じ `EvaluationChart` を `WIN_RATE` で               |
| `MONITOR`          | モニター | `MonitorView.vue`（USI の生ログ）                     |

**同じコンポーネントを prop 違いで2タブに出す**手が2か所で使われている。

- **時計は無い**（盤のレイアウトが持つ → [03](03-board-layout.md)）。
- **定跡も無い**。`BookPanel.vue` は `view/main/` にあり、タブではなく別のペイン。
- **評価値バーはタブの1つ**（`CHART`）。常設ではない。

`visibleTabs` は props で外から渡される（`TabPane.vue` は自分で決めない）。
`displayMinimizeToggle` が真なら「タブを隠す」ボタンが右端に出る。

### タブペインの構成は3種類選べる

```ts
export enum TabPaneType {
  SINGLE = "single",
  DOUBLE = "double",
  DOUBLE_V2 = "doubleV2",
}
```

**タブ帯を1本にするか2本にするかが設定。** 2本にすると
同時に2つのタブの内容が見られる。

`export const headerHeight = 30;` — タブ帯の高さは 30px 固定。

## 2. レイアウトは「標準」と「カスタム」の2系統

`view/main/` に `StandardLayout.vue`（11KB）と `CustomLayout.vue` がある。
標準はコードで組んだ固定の配置、カスタムは利用者がドラッグで作る配置。

### カスタムレイアウトは絶対座標

`src/common/settings/layout.ts`:

```ts
type UIComponentCommon = { left: number; top: number; width: number; height: number };

export type UIComponent = UIComponentCommon &
  (
    | Board
    | Record
    | Book
    | Chart
    | Analytics
    | Comment
    | RecordInfo
    | ControlGroup1
    | ControlGroup2
    | SimpleBoard
    | ElapsedTimeChart
  );

export type LayoutProfile = {
  uri: string;
  name: string;
  stretch?: boolean;
  backgroundColor?: string;
  dialogPosition?: DialogPosition; // left | center | right
  dialogBackdrop?: boolean;
  components: UIComponent[];
};
```

**11 種類の部品を、left/top/width/height で好きな位置に置ける。**
プロファイルは複数持てて、複製・削除・シリアライズ（共有）ができる。

### 画面サイズへの追従は「全体を1つの倍率で縮める」

```ts
export function calculateLayoutScale(components, width, height): number {
  const x0 = max(min(...left), 0);
  const y0 = max(min(...top), 0);
  const maxX = max(...(left + width));
  const maxY = max(...(top + height));
  const horizontalScale = width / (maxX + x0);
  const verticalScale = height / (maxY + y0);
  return max(min(horizontalScale, verticalScale), 0);
}
```

**[03](03-board-layout.md) の盤と同じ考え方が、レイアウト全体にも適用されている。**
リフローしない。配置は固定で、まるごと拡大縮小する。

### 部品ごとに細かい表示切替を持つ

```ts
type Record = {
  type: "Record";
  showCommentColumn?;
  showElapsedTimeColumn?;
  topControlBox?;
  branches?;
  showBranchTree?;
};
type Analytics = {
  type: "Analytics";
  historyMode?;
  showHeader?;
  showTimeColumn?;
  showMultiPvColumn?;
  showDepthColumn?;
  showNodesColumn?;
  showScoreColumn?;
  showPlayButton?;
  showSuggestionsCount?;
};
type Chart = { type: "Chart"; chartType: EvaluationChartType; showLegend? };
type Board = { type: "Board"; rightControlBox?; leftControlBox?; layoutType?: BoardLayoutType };
type Comment = { type: "Comment"; showBookmark? };
type SimpleBoard = { type: "SimpleBoard"; fontWeight?; fontScale?; bookmark? };
type ElapsedTimeChart = { type: "ElapsedTimeChart"; showLegend? };
```

**棋譜の列（コメント / 消費時間）も、解析の列（時間 / MultiPV / 深さ /
ノード数 / 評価値）も、全部個別に出し入れできる。**
`Board` の `layoutType` で、部品単位で STANDARD / COMPACT / PORTRAIT を選べる。

### レイアウト編集は別ウィンドウ

`layout-manager.html` が独立したエントリポイントで、
`src/renderer/layout/index.ts` が `LayoutManager.vue` をマウントする。
`view/layout/DragEditor.vue` が実際のドラッグ編集。
**メインウィンドウとは別プロセス（別 BrowserWindow）で動く。**

同様に `monitor.html` / `prompt.html` も独立エントリ。

## 3. 集約したアウトプット（グラフ類）

obs-shogi 側で「評価値グラフと一致率は役に立たない」という論点があるので、
ShogiHome が持っているものを列挙しておく。

| 部品                         | 出典                                           | 何を出すか                                        |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| `EvaluationChart` (RAW)      | `Tab.CHART`                                    | 生の評価値の推移                                  |
| `EvaluationChart` (WIN_RATE) | `Tab.PERCENTAGE_CHART`                         | **推定勝率**の推移。`coefficientInSigmoid` で変換 |
| `ElapsedTimeChart`           | `ElapsedTimeChartDialog.vue` ＋ レイアウト部品 | **消費時間**の推移                                |
| `PercentageBarChart.vue`     | `view/primitive/`                              | 割合の棒グラフ                                    |
| `BatchAnalysisProgress.vue`  | `view/main/`                                   | 一括解析の進捗                                    |
| `src/background/stats/`      | `html.ts` / `persistence.ts` / `types.ts`      | **対局の統計を HTML で書き出す**                  |

`coefficientInSigmoid`（アプリ設定）で評価値→勝率の変換係数を
利用者が調整できる。**評価値をそのまま見せるのと勝率に直すのを、
別のタブとして両方置いている。**

`src/background/stats/` は連続対局の勝敗統計。SPRT（[02](02-game.md)）とセット。

## obs-shogi との対応

|                    | ShogiHome                                       | obs-shogi（`main`）                        |
| ------------------ | ----------------------------------------------- | ------------------------------------------ |
| ドック             | タブ7つ。1本 or 2本を選べる                     | `AnalysisPane` 固定。タブ無し              |
| 評価値バー         | タブの1つ（常設ではない）                       | `EvaluationBar` が `AnalysisPane` 内に常設 |
| 時計               | 盤レイアウトの中                                | 対局が無い                                 |
| 定跡               | `BookPanel`（タブ外の別ペイン）                 | 無い                                       |
| 画面サイズ追従     | **全体を1倍率で縮小。**リフローしない           | `clamp()` 3つ ＋ グリッド。リフローする    |
| レイアウトの自由度 | 11 部品を絶対座標で自由配置。別ウィンドウで編集 | 固定                                       |
| 列の出し入れ       | 部品ごとに 5〜9 個のトグル                      | 無い                                       |

## 所感

- **「対局タブが無い」は積極的な設計判断に見える。**
  対局中に見たいもの（時計・手番・対局者名）は盤の枠内にあり、
  ドックは「棋譜に対する情報」だけを持っている。
  obs-shogi 側の「時計ってそこにいらなくね？」という直感と一致する。
- **評価値バーを常設にしていない**のも同じ理屈。ShogiHome では評価値はタブ。
  obs-shogi の「評価値バーは要る／要らないを設定できて欲しい、
  要らない人は多そう」という読みは、ShogiHome の構成では既定で満たされている。
- カスタムレイアウトは**強力だが重い**。11 部品 × 座標 × 部品ごとのトグルは、
  設定の面積としては相当大きい。obs-shogi が「シンプルはそれだけで強み」を
  掲げるなら、ここは真似しない方の候補。
  ただし**「部品ごとに列を出し入れできる」だけは安くて効く**。
- 画面追従を「リフローせず1倍率で縮小」に倒しているのは、
  盤の比率保持と同じ思想の一貫した適用。obs-shogi は既に
  リフローする方（`clamp` ＋ グリッド）に投資しているので、
  **盤クラスタだけスカラ方式、外側はリフロー**という混成になる。
  境界をどこに置くかは決めておいた方がいい。
