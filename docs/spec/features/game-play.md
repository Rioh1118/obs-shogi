# 機能要件: 対局

追跡: #374 #532 #536 #358 #361 #364 #365 #366 #367 #368 #371 #381 #382 ほか
main にあるか: **1局を通して指せる。棋譜に結果が残らない**

## 語彙

**唯一の出典は [ADR-0011](../../decisions/0011-game-vocabulary-and-placement.md) 決定1。
ここに写さない。**

## どこに何があるか

**始める面も進行を見る面もある。** 始めるのは `modal=game-start`
（起点はツリーの行の操作とようこそ画面）、進行を見るのはドックの「対局」タブ。
どちらも → [screens/play-view.md](../screens/play-view.md)。
**残っているのは復帰の導線だけ**（`over` を取りこぼした対局に「同期し直す」が無い。#374）。

| 層             | 状態                                                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust           | 実装済み（`src-tauri/src/engine/game/` の6ファイル＋ `commands/game.rs`）                                                                                                        |
| Tauri コマンド | **9本**登録済み                                                                                                                                                                  |
| フロント API   | `src/entities/game-session/`（`tauri.ts` / `events.ts` / `rust-types.ts`）                                                                                                       |
| 終局判定       | `src/entities/game/lib/`（`gameOutcome.ts` / `jishogiDeclaration.ts` / `gameRules.ts`）                                                                                          |
| フロント UI    | `widgets/play-view/` `features/start-game/` `features/game-move/` `features/game-ruling/` ＋ `entities/game-session/model/`（→ [screens/play-view.md](../screens/play-view.md)） |
| 状態遷移表     | [game-session.md](../../state-transitions/game-session.md)                                                                                                                       |

登録済みのコマンド9本:

`start_game` / `submit_game_move` / `continue_game` / `end_game_by_rule` /
`resign_game` / `abort_game` / `close_game` / `get_game_state` / `list_games`

## 設計の骨格（Rust 側が決めていること）

### USI の語彙を出さない

`readyok` / `usiok` / `position` 文字列 / `go` のパラメータは Rust の内側で完結する。
境界に出るのは「いま誰の手番か」「どの手が決まったか」「時計がどうなっているか」だけ。

### 裁定はフロントが返す

**Rust は将棋のルールで終局を判定しない。** 合法手判定を2実装にしないため。

```
Rust: 手が決まる → moveDecided → Phase::AwaitingRuling で止まる
フロント: 合法性と終局（詰み・千日手・トライルール・最大手数）を判定
       → continue_game か end_game_by_rule のどちらかを必ず呼ぶ
Rust: 次の手番へ進む
```

**どちらも呼ばないと対局は進まない。** 30秒（`RULING_TIMEOUT`）で Rust が畳み、
理由は `RulingTimeout`（画面では「アプリの異常」）になる。
**利用者の中断（`Aborted`）とは別の値。**

### 人とエンジンを1つの型にまとめてある

`PlayerSpec` は `Human` と `Engine` の enum。分岐させないので、
人対人・人対エンジン・エンジン対エンジンが同じ経路を通る。

### 時計は「尽きる時刻」を渡す

`RunningClock` は残り時間ではなく `main_zero_at` / `byoyomi_zero_at` を渡す。
減る値を渡すと「持ち時間を使い切ってから秒読みが減り始める」という規則が
境界の両側に生える。

持ち時間の形（`TimeLimit`）は4通りを通す。

| 形                 | 条件                                  |
| ------------------ | ------------------------------------- |
| 切れ負け           | `main > 0`、秒読みも加算も 0          |
| 秒読み             | `byoyomi > 0`。`main` は 0 でもよい   |
| フィッシャー       | `increment > 0`。`main` は 0 でもよい |
| 秒読み付き持ち時間 | `main > 0 && byoyomi > 0`             |

**秒読みと加算を両方送るのは断る**（どちらを優先するかがエンジンごとに割れる）。
1つの欄の上限は24時間（`MAX_TIME_MS`）。

### イベントは1本にまとめる

`game-event` の1チャンネル。種類ごとに名前を分けないのは**順序を保つため**。

## いま埋まっていない穴

### 宣言の可否を呼ぶ側が居ない（**issue は未起票**）

裁定を返す側は入った —— `GameSessionProvider`（`entities/game-session/model/`）が
`game-event` を購読し、`GameSessionBridge` が組んだ裁定器を通して
`continue_game` / `end_game_by_rule` を返す（→ [screens/play-view.md](../screens/play-view.md)）。

**`judgeDeclaration` だけが呼ばれていない。** 入玉宣言は利用者の操作から呼ぶものなので、
その操作を持つ画面が要る。**置き場は決まった —— 対局ビューの操作列**（将棋所が
ツールバーの1操作「入」にしているのと同じ向き。ADR-0011 着手順7）。
`get_game_state` も呼び手が居ない（#374）。

`judgeGameOutcome`（`gameOutcome.ts`）が返す終局:

| 種別                             | 勝敗                       |
| -------------------------------- | -------------------------- |
| 詰み（合法手が空 かつ 王手）     | 指せなくなった側の負け     |
| 手詰まり（合法手が空、王手なし） | 同上                       |
| 千日手（同一局面4回）            | 引き分け                   |
| 連続王手の千日手                 | 王手を続けた側の反則負け   |
| トライルール                     | 相手玉の初期位置に着いた側 |
| 最大手数（既定 1000）            | 引き分け                   |

**持将棋の27点法と24点法はここに入らない。** どちらも宣言の規則で、条件を
満たしただけでは終局しない（満たしたまま指し続けて詰みを狙う選択が残る）。
宣言の可否は `judgeDeclaration`（`jishogiDeclaration.ts`）が別に持つ。
自動で終わる持将棋はトライルールだけ。

**その `judgeDeclaration` も、いまはどこからも呼ばれていない。**
エンジンの `bestmove win` は Rust が受けた時点で `DeclareWin` として終局させ、
こちら側に検算を求めない（→ #532）。

設定として持つ値の形は `research/shogihome/02-game.md`
（`jishogiRule` / `maxMoves` / `enableEngineTimeout`）を参照している。

ルールの持ち主が2つに割れている点は意図的。合法手の生成は shogi.js、
千日手・連続王手・持将棋の点数は tsshogi で、**どちらか一方では賄えない**
——tsshogi は合法手を生成せず、shogi.js は千日手も点数も持たない。
**tsshogi 一本に寄せられないのは、盤の表示が既に shogi.js を使っていて消せないため**
（[game-session.md](../../state-transitions/game-session.md) の「責任の切れ目」）。
その2つの合法手判定が割れたときに何が起きるかは #536。

**値段は手数に比例する。** `judgeGameOutcome` は呼ばれるたびに根から棋譜を
組み直すので、1回が実測で 100手 4.6ms / 400手 16ms / 2000手 60ms。毎手呼ぶと
合計は2乗で効き、400手の対局を通しで裁定すると 2.8 秒になる。
**画面を作るときは、対局セッションの間だけ判定器を持ち回る形にすること。**

**ただし「持ち回れば裁定がタダになる」ではない。** 同じ400手で消えるのは
棋譜の組み直しの分（約2ms）だけで、1手ごとの `hasLegalMove` と千日手の判定は
残る（実測で約7ms）。合法手が多い終盤ほどこちらが効く。

### 復帰導線が無い（#374）

`over` の emit が落ちると、**盤が止まったまま何も起きない画面**が残る。
`turnChanged` / `moveDecided` は30秒で `aborted` に畳まれるが、`over` だけが例外。

`get_game_state` は API として在り、呼び口も `tauri.ts` にある。**呼ぶ側が居ない。**

### 中断した対局を再開できない（#358）

`GameSettings` は `startSfen` と `initialMoves` で局面を再現できるが、
**時計は必ず満額から始まる。** 残り時間の持ち込み口が無い。

### 同時に走らせる対局の数に上限が無い（#382）

`start_game` は台帳に載る数を見ない。1局あたりエンジンのプロセスが最大2本立つので、
画面を作るときに**呼ぶ側で止めない限り**、押した回数だけプロセスが増える。
ログに載る対局の数（`MAX_TRACKED_GAMES`）は絞りの枠であって、対局数の上限ではない。

### 起動が `SPAWN_TIMEOUT` を超えた後の子プロセスが台帳に居ない（#381）

遅れて起き上がったプロセスを畳むのは `dispose_late_spawn` のタスクだけで、
終了時の掃除（`shutdown_all`）からは見えない。

## 作らないといけない画面

新規の面は1つ。**対局の設定・対局中の盤・時計・終局は入った**
（→ [screens/play-view.md](../screens/play-view.md)）。

| 画面 | 何を持つか             |
| ---- | ---------------------- |
| 復帰 | 「同期し直す」（#374） |

**入った面の置き場は作り替える。** 時計はヘッダへ、スタッツは終局後の対局タブへ、
開始の面はチップ＋ステッパーと記憶へ。順序ごと
[ADR-0011](../../decisions/0011-game-vocabulary-and-placement.md) の「着手順」が持つ。

置き場は決まった —— **進行はドックのタブ `play`**（ADR-0010 の語彙でいうビュー）、
**始める面はモーダル**（棋譜を1枚作る作業なので、起点はツリーとようこそ画面）、
**対局中の盤の門は `features/game-move`**（盤と対局を束ねるので、置ける最下層がそこ）。
→ [screens/play-view.md](../screens/play-view.md)

特殊手との対応は [special-moves.md](special-moves.md) に表がある
（`EngineFailure` に対応する `special` が無い）。

## 判断の軸

`docs/PREMISES.md` P-008（AI 開発者の需要）。
**方針転換 2026-06（#112）は「対局は不採用（永久ロック）」と書いていたが、
それは現在の方針ではない。** P-008 と `docs/OPEN-QUESTIONS.md` Q-003 が上書きしている。

## 着手前に片付けるもの

**`docs/OPEN-QUESTIONS.md` Q-006 の期限は切れている**（#357）。
「対局はコマンドを10本以上増やすので、命名を揃えるならその前」としていたが、
対局のコマンド9本は**旧語彙のまま入った**。書き換え対象は50本になっている。
