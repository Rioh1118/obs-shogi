# 05 USI エンジンの持ち方

出典: `src/common/settings/usi.ts`、`src/common/settings/player.ts`
版: `de27f0c1c352`

**obs-shogi の `EnginePreset` の命名と型を見直すときの、いちばん近い比較対象。**

## 1. `USIEngine` 型

```ts
export type USIEngine = {
  uri: string; // 同一性のキー
  name: string; // 利用者が付けた名前（編集できる）
  defaultName: string; // エンジンが `id name` で返した名前
  author: string; // エンジンが `id author` で返した名前
  path: string; // 実行ファイル
  options: { [name: string]: USIEngineOption };
  labels?: USIEngineLabels; // deprecated: use tags instead
  tags?: string[];
  enableEarlyPonder: boolean;
  extraBook?: USIEngineExtraBookConfig;
};
```

要点。

- **`name` と `defaultName` を分けている。** 利用者が「弱い水匠」と名前を付けても、
  エンジン本体が名乗った名前が残る。`author` も保持。
- **評価関数のパスを第一級フィールドで持っていない。** 評価関数は
  USI オプション（`EvalDir` など）の1つとして `options` に入る。
- **`tags?: string[]`** がある。`labels` は deprecated で、タグへ移行済み。
  色の一覧（`blue #1565C0` / `green #2E7D32` / `orange #D84315` / `brown` /
  `purple` / `indigo` / `amber` / `gray` / `pink`）が同ファイルにあり、
  **タグに色が付く**。
- `extraBook` は**エンジンとは別に GUI 側が持つ定跡**。

```ts
export type USIEngineExtraBookConfig = {
  enabled: boolean;
  filePath: string;
  onTheFly: boolean;
  moveSelectionRule?: BookMoveSelectionRule; // 省略時 BEST
  scoreTemperature?: number; // 省略時 100
};
```

## 2. USI オプションを**型付きで**持っている

ここが obs-shogi との一番大きい差。

```ts
export type USIEngineOptionType = "check" | "spin" | "combo" | "button" | "string" | "filename";

// 判別可能ユニオン（抜粋）
{ type: "check";  default?: "true" | "false"; value?: "true" | "false" }
{ type: "spin";   default?: number; min?: number; max?: number; value?: number }
{ type: "combo";  default?: string; vars: string[]; value?: string }
{ type: "button" }
{ type: "string" | "filename"; default?: string; value?: string }

export type USIEngineOption  = { name: string; order: number } & (上のいずれか);
export type USIEngineOptions = { [name: string]: USIEngineOption };
```

- USI 仕様の6種をそのまま型にしている。
- `min` / `max` / `vars` を保持しているので、**GUI がスライダ・チェックボックス・
  ドロップダウンを出し分けられる**。
- `order` を持っているので、エンジンが `option` を送ってきた順を再現できる。
- `default` と `value` を**別に持つ**。既定値に戻せるし、
  「既定から変えたものだけ `setoption` する」もできる。

### よく使うオプション名は定数になっている

```ts
export const USIPonder = "USI_Ponder";
export const USIHash = "USI_Hash";
export const USIMultiPV = "USI_MultiPV";
export const Threads = "Threads";
export const NumberOfThreads = "NumberOfThreads";
export const MultiPV = "MultiPV";
export const StochasticPonder = "Stochastic_Ponder";
export const FVScale = "FV_SCALE";
export const NodesLimit = "NodesLimit";
export const ConsiderationMode = "ConsiderationMode";
```

`USI_MultiPV` と `MultiPV`、`Threads` と `NumberOfThreads` の**両方**があるのは、
エンジンによって名前が違うため。**GUI が「MultiPV を上げる」を実現するには
エンジンごとの名前差を吸収する必要がある**ことの証拠。

### エンジン設定のマージ機能がある

```ts
export type USIEngineOptionDiff = {
  name: string;
  leftValue?: string | number;
  rightValue?: string | number;
  mergeable: boolean;
};
```

`USIEngineMergeDialog.vue` が対応する画面。
**エンジンを更新して再登録したとき、前の設定を引き継ぐ**ためのもの。

## 3. プレイヤーとエンジンの結び付け

```ts
export type PlayerSettings = { name: string; uri: string; usi?: USIEngine };
```

`uri` で3種を判別する（`src/common/uri.ts`）。

- `uri.ES_HUMAN` — 人間
- `uri.isBasicEngine(uri)` / `uri.ES_BASIC_ENGINE_LIST` — 内蔵の簡易エンジン
- `uri.isUSIEngine(uri)` — USI エンジン。このとき `usi` が必須

`validatePlayerSettings` がこの3分岐をそのまま検証している。
**URI スキームを同一性と種別の両方に使っている**のがこの設計の芯。

## obs-shogi の `EnginePreset` との比較

```ts
// obs-shogi: src/entities/engine-presets/model/types.ts
export type EnginePreset = {
  id: PresetId; // = string
  label: string;
  aiName: string;
  enginePath: string;
  evalFilePath: string;
  bookEnabled: boolean;
  bookFilePath: string | null;
  options: UsiOptionMap; // = Record<string, string>
  analysis?: AnalysisDefaults;
};
```

| 論点         | ShogiHome                                     | obs-shogi                      | 差の意味                                                                                |
| ------------ | --------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| 同一性       | `uri`（種別も兼ねる）                         | `id: string`                   | 人間・内蔵エンジンを同じ器に入れられない                                                |
| 表示名       | `name` ＋ `defaultName` ＋ `author`           | `label` ＋ `aiName`            | **`aiName` は USI の `id name` ではなく AI フォルダ名。名前が実態とずれている**         |
| 実行ファイル | `path`                                        | `enginePath`                   | 同じ                                                                                    |
| 評価関数     | **USI オプションの一つ**                      | `evalFilePath` を第一級で保持  | **やねうら王に固定した設計。**他エンジンで意味を持たない                                |
| オプション   | `USIEngineOption`（型付きユニオン）           | **`Record<string, string>`**   | **型情報を捨てている。**GUI がコントロールを出し分けられない。`min`/`max`/`vars` が無い |
| 既定値       | `default` と `value` を別に保持               | 無い                           | 「既定に戻す」ができない                                                                |
| 定跡         | `extraBook`（選択規則・温度つき）             | `bookEnabled` + `bookFilePath` | 単純                                                                                    |
| タグ         | `tags?: string[]` ＋ 色                       | 無い                           | 「タグで管理」の実例がここにある                                                        |
| 解析の既定値 | 持たない（`settings/analysis.ts` が別に持つ） | `analysis?: AnalysisDefaults`  | 関心が混ざっている                                                                      |

## 所感

- **`options: Record<string, string>` は将来必ず詰まる。**
  USI の `option` 行は型・既定・範囲・選択肢を運んでくるのに、
  obs-shogi はそれを文字列へ潰して捨てている。
  「強さの調整を対局ダイアログに出すか」（D-04）が難しいのは、
  そもそも `NodesLimit` が spin なのか string なのかを型が知らないため。
  **ここを直すのは対局の前提工事に入ると思う。**
- **`aiName` は名前が嘘をついている**（USI のエンジン名ではなく
  AI ライブラリのフォルダ名）。ShogiHome が `name` / `defaultName` / `author` を
  分けているのに対応させるなら、obs-shogi 側は
  「AI ライブラリのディレクトリ名」と「エンジンが名乗る名前」を別の項目にする必要がある。
- `evalFilePath` を第一級に持つ判断は、**やねうら王専用ならむしろ正しい**。
  他のエンジンを受け入れる気があるかで是非が変わるので、
  「どのエンジンを相手にするか」を先に決めた方がいい。
- **タグはエンジンに付いている。** obs-shogi 側の「タグで管理」案は
  棋譜に付ける話だったが、エンジンに付ける需要も実在するという事実は使える。
