# 02 対局

出典: `src/common/settings/game.ts` / `src/common/settings/player.ts` /
`src/common/game/time.ts` / `src/common/game/result.ts` /
`src/renderer/players/{player,human,builder}.ts` / `src/renderer/game/clock.ts`
版: `de27f0c1c352`

## 1. 相手を「人かエンジンか」で分岐させていない

**対局の中核。** `src/renderer/players/player.ts` に1つのインターフェースがある。

```ts
export interface Player {
  isEngine(): boolean;
  readyNewGame(): Promise<void>;
  startSearch(position, usi, timeStates, handler: SearchHandler): Promise<void>;
  startPonder(position, usi, timeStates): Promise<void>;
  startMateSearch(position, usi, maxSeconds, handler: MateHandler): Promise<void>;
  stop(): Promise<void>;
  gameover(result: GameResult): Promise<void>;
  close(): Promise<void>;
}
```

実装は3つ（`src/renderer/players/`）。

| 実装          | ファイル   | 中身                                                                      |
| ------------- | ---------- | ------------------------------------------------------------------------- |
| `HumanPlayer` | `human.ts` | ほぼ空。`startSearch` は handler を**保持するだけ**、`close` は捨てるだけ |
| `USIPlayer`   | `usi.ts`   | USI プロセスを持つ                                                        |
| `BasicPlayer` | `basic.ts` | 内蔵の簡易エンジン（16.5KB）                                              |

`HumanPlayer` の核はここ。

```ts
doMove(move: Move) {
  const searchHandler = this.searchHandler;
  this.searchHandler = undefined;
  searchHandler?.onMove(move);
}
resign()  { ... searchHandler?.onResign(); }
win()     { ... searchHandler?.onWin(); }
```

**盤のクリックが `doMove` を呼ぶと、エンジンが `bestmove` を返したのと
同じ経路で対局が進む。** `humanPlayer` はモジュールレベルの
シングルトン（`export const humanPlayer = new HumanPlayer()`）。

生成は `src/renderer/players/builder.ts`。

```ts
if (playerSettings.uri === uri.ES_HUMAN)          return humanPlayer;
else if (uri.isBasicEngine(playerSettings.uri))   return new BasicPlayer(...);
else if (uri.isUSIEngine(...) && playerSettings.usi) { const p = new USIPlayer(...); await p.launch(); return p; }
```

**これが「人対人・人対エンジン・エンジン対エンジン・同じエンジン同士」を
全部同じコードで回せる理由。** 対局の進行側は相手が何かを知らない。

**空でないのは3つだけ**（`isEngine()` が `false` を返す、`startSearch` が handler を持つ、`close` が捨てる）。

`readyNewGame` / `gameover` / `close` が `Player` に入っているので、
USI の `usinewgame` / `gameover` / `quit` は人間相手のときは空実装で素通りする。

## 2. 設定の型は3層に重ねてある

`src/common/settings/game.ts`。

```ts
type SingleGameSettings = {
  black;
  white;
  timeLimit;
  whiteTimeLimit?;
  startPosition;
  startPositionSFEN;
  enableEngineTimeout;
  humanIsFront;
  enableComment;
  enableAutoSave;
  autoSaveDirectory;
  maxMoves;
  jishogiRule;
  searchCommentFormat;
};

type LinearGameSettings = Omit<SingleGameSettings, "startPosition"> & {
  startPosition: GameStartPositionType;
  startPositionListFile;
  startPositionListOrder: "sequential" | "shuffle";
  startPositionListPly?;
  repeat;
  swapPlayers;
  sprtEnabled;
  sprt;
};

type GameSettings = LinearGameSettings & { parallelism: number };
```

**1局 → 連続対局 → 並列対局**の順に足している。1局しかやらない機能は
`SingleGameSettings` だけ受け取れる。

`PlayerSettings`（`settings/player.ts`）は先後で共通。

```ts
export type PlayerSettings = { name: string; uri: string; usi?: USIEngine };
```

`uri` が `ES_HUMAN` か USI エンジンか内蔵エンジンかを表す。**先手と後手が同じ型。**
既定は `{ name: t.human, uri: uri.ES_HUMAN }`。

## 3. 持ち時間

```ts
export type TimeLimitSettings = { timeSeconds: number; byoyomi: number; increment: number };
// 既定: { timeSeconds: 0, byoyomi: 30, increment: 0 }
```

- **秒読みとフィッシャーは排他。** `validateGameSettings` が
  `byoyomi !== 0 && increment !== 0` を弾く（`t.canNotUseByoyomiWithFischer`）。
- **持ち時間と秒読みが両方 0 も弾く**（`t.bothTimeLimitAndByoyomiAreNotSet`）。
- `whiteTimeLimit?` が別にある。**先後で持ち時間を変えられる**（省略時は同じ）。
- 実行時の状態は `src/common/game/time.ts` で
  `TimeState = { timeMs, byoyomi, increment }` を先後2つ持つだけ。

### 時計の実装（`src/renderer/game/clock.ts`）

- `setInterval` 100ms。`Date.now() - timerStart` で経過を測る（**加算でなく差分**）。
- 持ち時間が 0 を割ったら、その超過分を秒読みから引く。
  `_byoyomi = max(ceil(byoyomi + timeMs/1e3), 0)`。
- 両方 0 で `onTimeout()`。
- `stop()` が `incrementTime()` を呼び、フィッシャーの加算はここで入る。
  **`pause()` は加算しない。** 中断と着手を区別している。
- **音の鳴らし方が細かい**（`fireBeep`）。持ち時間があって秒読みも付いていれば鳴らさない。
  持ち時間が尽きた瞬間に短音。以降は残り 5 秒以下で長音、10 秒以下・20・30・60 秒で短音。

## 4. 対局のルールに関する設定

obs-shogi 側の要件整理に入っていなかったもの。

| 設定                  | 値                                         | 意味                                    |
| --------------------- | ------------------------------------------ | --------------------------------------- |
| `jishogiRule`         | `none` / `general24` / `general27` / `try` | **持将棋のルール。** 既定は `general27` |
| `maxMoves`            | 既定 1000                                  | 最大手数。超えたら引き分け              |
| `enableEngineTimeout` | 既定 false                                 | エンジン側の時間切れを有効にするか      |
| `humanIsFront`        | 既定 true                                  | 人間を手前に置く（盤の向きの自動決定）  |
| `enableComment`       | 既定 true                                  | 読み筋を棋譜のコメントに書く            |
| `searchCommentFormat` | `SearchCommentFormat.SHOGIHOME` ほか       | その書式                                |
| `enableAutoSave`      | `autoSaveDirectory` があれば true          | 自動保存                                |
| `autoSaveDirectory`   | 文字列（末尾スラッシュを落として持つ）     | **保存先は対局設定が持つ**              |

`DeclarableJishogiRules = [GENERAL24, GENERAL27]` — この2つのときだけ
入玉宣言（`bestmove win`）が有効になる。

## 5. 連続対局・並列対局・SPRT

```ts
type SPRTSettings = { elo0; elo1; alpha; beta; maxGames };
// 既定 { elo0: 0.5, elo1: 2.5, alpha: 0.05, beta: 0.05, maxGames: 100000 }
```

`repeat` / `swapPlayers` / `parallelism` / `sprtEnabled` / `sprt`。
実装は `src/renderer/game/parallel.ts` と `src/renderer/game/sprt.ts`。

**バリデーションで制約を型の外から掛けている**（`validateGameSettings`）。

- 人間が含まれるなら `repeat` は 1（`t.repeatsMustBeOneIfHumanPlayerIncluded`）
- 人間が含まれるなら `parallelism` は 1
- `startPosition === "current"` なら `parallelism` は 1
- SPRT は人間不可・`swapPlayers` 必須・`elo0 < elo1`・`0 < alpha,beta < 1`
- SPRT 無効なら `parallelism <= repeat`

**「人間が混ざったら並列できない」を型でなく検証で表している。**
型で表そうとすると `PlayerSettings` を分岐させることになり、1 の設計が壊れる。

## 6. 開始局面

```ts
type SingleGameStartPositionType = InitialPositionType | "current" | "sfen";
type GameStartPositionType = SingleGameStartPositionType | "list";
```

`InitialPositionType` は tsshogi 側（平手・駒落ち各種）。
`"list"` は**局面集ファイル**から順番／シャッフルで取る（連続対局用）。
`startPositionListPly` で「何手目から指させるか」を指定できる。

既定は `InitialPositionType.STANDARD`（平手）。
コメントに `v1.21.0 から平手初期配置をデフォルトに変更` とあり、
**それ以前は「現局面」が既定だった**（`normalizeGameSettings` が
古い設定の欠損を `"current"` で埋める後方互換を持っている）。

## obs-shogi との対応

|                 | ShogiHome                                      | obs-shogi                                                               |
| --------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| 相手の抽象      | `Player` インターフェース。人もエンジンも同じ  | 無い                                                                    |
| 先後の型        | `PlayerSettings` で共通                        | 無い                                                                    |
| 持ち時間        | `{ timeSeconds, byoyomi, increment }` ＋先後別 | 無い                                                                    |
| 保存先          | 対局設定が `autoSaveDirectory` を持つ          | `root_dir` 1つ                                                          |
| 持将棋          | 4ルール                                        | 概念が無い                                                              |
| 連続対局 / SPRT | あり                                           | 無い（別プロジェクトが持っている領域 → `docs/OPEN-QUESTIONS.md` Q-003） |

## 所感

- **`Player` 抽象を先に置いたかどうかで、後の全部が決まっている。**
  obs-shogi で対局をやるなら、最初に書くのはダイアログでも状態機械でもなく
  この interface だと思う。
- 型を3層に重ねる（`Single` → `Linear` → `Game`）のは、**連続対局を後から足しても
  1局用のコードを壊さない**ための形。obs-shogi が「まず人対エンジン、
  後でエンジン同士」と言うなら、この形を最初から採るのが安い。
- 制約をバリデーションに逃がしている点は賛否あるが、
  **「人間が混ざると並列できない」を型で書こうとすると設計が崩れる**という
  実例としては説得力がある。
