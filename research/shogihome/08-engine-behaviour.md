# 08 エンジンの見せ方と振る舞い

**版: `sunfish-shogi/shogihome` の `6304cdaf01de3cd7d8248e0cf40377b8151f8893`。**
ここだけ `README.md` 冒頭の `de27f0c1c352` と版が違う。再取得は `REF` を差し替える。
調査日: 2026-10-31。パスの行番号はこの版のもの。

- 全てソースを読んで確かめた。**アプリは動かしていない。** 実行時の見え方は読解からの導出で、
  そう書いた箇所がある。
- `[確定]` は読解で裏が取れたもの。「無い」の検出力は §11 にまとめた。
- `検討` は ShogiHome の `ResearchState`（`research/README.md` の規律8）。
- 比較の相手は [USI の原典](../usi-spec/01-usi-original.md)。方針はここに書かない。
- WebAssembly エンジンの経路（`src/background/usi/wasm/`、`src/renderer/wasm-engine/`）は対象外。

## 0. [05-usi-engine.md](05-usi-engine.md) から直すこと

| 05 の記述 | 判定 | 根拠 |
| --- | --- | --- |
| 「GUI がスライダ・チェックボックス・ドロップダウンを出し分けられる」 | **[反証]（スライダの部分）** | `spin` の部品は `<input type="number">` だけ（`src/renderer/view/dialog/USIEngineOptionsDialog.vue:61-71`）。検索語は §11。`de27f0c1c352` の同じファイルも `type="number"` のみで `type="range"` `slider` は0件 |
| 「`check` はチェックボックス」と読める | **[反証]** | `HorizontalSelector`（横並びの択一）。§1 |
| 「『既定から変えたものだけ `setoption` する』もできる」 | 補足 | 型としては可能だが、動作は違う。起動のたびに、値か既定を持つ全オプションを送っている。§3 |
| `USIEngineMergeDialog` は「エンジンを更新して再登録したとき、前の設定を引き継ぐためのもの」 | **[反証]** | 登録済みの2エンジンを比べて項目ごとに写す画面（題は「エンジン設定の比較」）。引き継ぎは別の口。§9 |
| `USIEngine` 型の一覧 | 追加あり | `badge` `banners` `description` `links` が増えた（`src/common/settings/usi.ts`）。いずれも保存値を使わず読み込みのたびに作り直す |

## 1. オプションの見せ方

出典はすべて `src/renderer/view/dialog/USIEngineOptionsDialog.vue`。

### 型ごとの部品

| USI の型 | 部品 | 行 | 細部 |
| --- | --- | --- | --- |
| `spin` | `<input type="number" step="1" :min :max>` | 61-71 | 値の丸めは無い。`v-model.number` |
| `string` | `<input type="text">` | 72-79 | |
| `filename` | テキスト欄＋「選択」ボタン | 80-97 | ボタンは `api.showSelectFileDialog`。主プロセス側は `["openFile"]` で**ファイルのみ**（`src/background/window/ipc.ts:372-380`） |
| `check` | `HorizontalSelector`（`type="radio"` の横並び） | 99-115 | **`default` があれば ON/OFF の2択、無ければ 既定値/ON/OFF の3択** |
| `combo` | `ComboBox`（`src/renderer/view/primitive/ComboBox.vue`） | 116-123 | 先頭に「既定値」、続けて `vars` |
| `button` | 「実行」ボタン | 124-130 | 下記 |

**`spin` のスライダは無い。** [確定] 条件によって出す箇所も無い。`USI_Hash` と `Threads` にだけ、
入力欄の下に使用率の棒グラフと注意文が付く（148-223 行。§2）。

**`check` の3択。** [確定] `default` が無い `check` にだけ第3の状態がある。
`value` は未定義になり、`getUSIEngineOptionCurrentValue` は `undefined` を返すので `setoption` を送らない。

**`button`。** [確定] 押すと `sendUSIOptionButtonSignal` が呼ばれ、
**新しいプロセスを別に起動して** `usi` → `usiok` → `setoption name X` → `quit` を実行する
（`sendOptionButtonSignal`、`src/background/usi/index.ts:93` 以降）。動いている検討のエンジンには届かない。

### 並びと絞り込み

- [確定] **申告順を保つ。** `order = 100 + 既に受けた数`（`src/background/usi/engine.ts:689-698`）。
- [確定] **例外が2つ先頭に来る。** `Threads` / `NumberOfThreads` は `-100`、`USI_Hash` は `-99`（`optionOrder`、417-427 行）。
- [確定] エンジンが宣言しなかった `USI_Hash` は `order: 1`、`USI_Ponder` は `order: 2` で補う（`engine.ts:727-746`）。§3
- [確定] 表示は2段。`detailed`（「詳細設定」トグル、既定 false、`showEngineOptionDetails` で保存）が false のとき、次の7つだけを出す（392-412 行）。
  ```ts
        option.name === Threads ||
        option.name === NumberOfThreads ||
        option.name === USIHash ||
        option.name === USIPonder ||
        option.name === FVScale ||
        option.name === NodesLimit ||
        option.name === ConsiderationMode
  ```
  加えて「表示名」も出る。これを超える量は「全てのオプションを表示」で開く。
- [確定] 絞り込みは `detailed` のときだけ。入力欄「オプション名で検索」で、表示名と原名の両方を対象にする（`optionVisibility`、`filterString`）。

### 日本語名

- [確定] `usiOptionNameMap` が表を持つ（`src/common/i18n/usi.ts`）。**語は完全一致**で、英語など他の言語の表は空。
- [確定] `translateEngineOptionName`（既定 true）が有効なら訳語を出し、原名を隣に添える（53-58 行）。
- [確定] 表に無いオプションは原名のまま。

### 既定値と戻す口

- [確定] 既定を持つ行に「既定値: X」を添え、現在値と違うと強調する（133-147 行）。
- [確定] **戻す口は全体に1つだけ。**「エンジンの既定値に戻す」（`reset`、528-538 行）。項目ごとの口は無い。
  表示名・早期 Ponder・定跡（GUI 拡張）も同時に戻す。
- [確定] `string` / `filename` / `combo` を空にして保存すると `value` は `undefined` になる（`buildEngineOptions`、540-562 行）。
  **既定を持つ `string` に「空」を指定することはできない**（現在値は既定に戻る）。
- [確定] `spin` だけは常に `value` を持って保存される。`default` の無い `spin` は画面で 0 になり、0 が保存される（`?? (option.type === "spin" ? 0 : "")`）。

### `<empty>` の扱い

- [確定] `getUSIEngineOptionCurrentValue`（`src/common/settings/usi.ts:65-76`）。
  ```ts
  if ((option.type === "string" || option.type === "filename") && option.default === "<empty>") {
    return "";
  }
  ```
- [確定] `string` と `filename` だけを見る。`combo` の `<empty>` は素通しになる。
- [確定] 空文字のときの送信は `setoption name X value `（`value !== undefined` の分岐。`engine.ts:389-395`）。
- [確定] `reset` は `option.default` をそのまま入れるので、`<empty>` が既定の項目を「既定に戻す」と**文字列 `<empty>` が `value` として保存される**
  （528-538 行と 540-562 行の組み合わせ）。動かしての確認はしていない。

### オプションの構文解析

`onOption`（`engine.ts:689-725`）。

- [確定] `command.split(" ")` で、4番目以降を2語ずつ組にして読む。**値に空白を含む `default` は最初の語だけになる。**
  空白が2つ続く行は解析がずれる（原案は `Arbitrary white space between tokens is allowed.`）。
- [確定] 解釈できない行はログに `invalid option command` を残して読み飛ばす。
- [確定] 型の値は検証しない（`args[3] as USIEngineOptionType`）。`validateUSIEngine` が見るが、呼び元は `src/common/settings/player.ts:29` のみ。

### その他

- [確定] `spin` の範囲は `isValidOptionValue` が見る。**`value === default` なら範囲外でも通す**（`usi.ts:325-357`）。入力欄の `min` `max` はブラウザの制約のみ。
- [確定] 設定のコピーと貼り付けがある。gzip＋base64 の文字列をクリップボードに置く（`compressUSIEngineOptionsClipboardData`）。
- [確定] 実行ファイルを差し替える「エンジン再選択」（`replaceEnginePath`）がある。§9

### エンジンの一覧

- [確定] 並びは `engineList` の名前順（`usi.ts:502-511`）。申告順や追加順ではない。
- [確定] エンジン管理は名前の絞り込み（`engine.name` / `defaultName`）とタグの絞り込みを持つ（`USIEngineManagementDialog.vue`）。
- [確定] タグの既定は `game` `research` `mate` の3つ（`emptyUSIEngine`）。検討のダイアログは `research` を既定のタグにして `PlayerSelector` を開く。

## 2. 評価関数・定跡と、名前への依存

**評価関数のパスと定跡のファイルに第一級の欄は無い。**
[確定] エンジン定義のオプション（`EvalDir` `BookFile` など）のまま `options` に入り、他のオプションと同じ部品で出る。

| 名前 | 使う場所 | 使い方 |
| --- | --- | --- |
| `USI_Hash` | `engine.ts`、`USIEngineOptionsDialog.vue`、`ResearchDialog.vue` | 宣言が無ければ補う。先頭に出す。メモリの使用率を警告（95% / 90% / 20%）。合計を検討で警告 |
| `USI_Ponder` | `engine.ts`、`players/usi.ts` | 宣言が無ければ補う。`startPonder` の可否。早期 Ponder のトグルをこの行に添える |
| `Threads` / `NumberOfThreads` | `common/settings/usi.ts:85-90` | `getUSIEngineThreads` が前者→後者の順に読む。先頭に出す。コア数との比を警告 |
| `USI_MultiPV` / `MultiPV` | `usi.ts:92-97`、`players/usi.ts:443-457`、`store/research.ts:85-91` | 前者→後者の順に読む。**書くときも同じ順で、`spin` のときだけ** |
| `Stochastic_Ponder` | `usi.ts`、`players/usi.ts` | 読むだけ。Ponder の局面の扱いが変わる |
| `FV_SCALE` `NodesLimit` `ConsiderationMode` | `USIEngineOptionsDialog.vue:406-408` | **簡易表示に出すだけ。** 値を読み書きする箇所は無い |
| `EvalDir` `BookDir` | `src/background/usi/display.ts:27` | **バナー画像を探すディレクトリとしてだけ。** 起動にも設定にも使わない |
| `BookFile` `DepthLimit` `USI_OwnBook` など | `src/common/i18n/usi.ts` | 日本語名の表にあるだけ |
| `USI_AnalyseMode` `USI_LimitStrength` `USI_Strength` `USI_ShowCurrLine` `USI_ShowRefutations` | なし | ソースに0件。[確定] |

**名前の違いの呼び分け方式。**

- [確定] 別名の表は持たない。`||` で2つの名前を順に試す関数が2つあるだけ（`getUSIEngineThreads`、`getUSIEngineMultiPV`）。
- [確定] エンジン名や作者名での分岐は無い（検索語は §11）。
- [確定] 比較は大文字小文字を区別する完全一致（`option.name === Threads`）。原案は `setoption` の名前を大文字小文字の区別なしと書いている。
- [確定] 検討の `USI_OwnBook` や `USI_AnalyseMode` を自動で送る処理は無い。`ConsiderationMode` も同じ。

**定跡。** [確定] 2系統ある。

1. エンジンのオプション（`BookFile` など）。GUI は中身を知らない。
2. `extraBook`（「定跡 (GUI拡張)」）。GUI が定跡を引く。ファイル・On-the-fly・選択規則・温度を持つ（`USIEngineOptionsDialog.vue:236` 以降、`usi.ts` `USIEngineExtraBookConfig`）。

[確定] `extraBook` は検討にも効く。`startResearch` は先に `searchBook` を呼び、ヒットすれば `go` を送らず定跡の手を読み筋として表示する（`src/renderer/players/usi.ts:173-183`）。

## 3. 起動と終了の状態機械

`src/background/usi/engine.ts`。

```text
WaitingForUSIOK --usiok--> NotReady --ready()/isready--> WaitingForReadyOK
  --readyok/usinewgame--> Ready --go--> WaitingForBestMove --bestmove--> Ready
                          Ready --go ponder--> Ponder --stop--> WaitingForPonderBestMove
                          Ready --go mate--> WaitingForCheckmate
任意 --quit()--> WillQuit --プロセス終了--> QuitCompleted
```

- [確定] 送る順: `usi` → （`usiok` を受けて）`setoption` 群 → `isready` → `readyok` を受けて `usinewgame` → 予約済みの `position` / `go`（`onUSIOk` 727-759 行、`onReadyOk` 761-771 行）。将棋所の例と同じ順。
- [確定] **`setoption` は値か既定を持つ全オプションを送る。** `getUSIEngineOptionCurrentValue` が `undefined` でないもの全て（`engine.ts:748-753`）。`Object.values` の順で、`order` で並べていない。
- [確定] `USI_Hash`（既定 32）と `USI_Ponder`（既定 `"true"`）は宣言が無くても補うので、常に送る（`onUSIOk`）。原典の将棋所の振る舞いと同じ。
- [確定] **保存値は実機の申告と突き合わせない。** `onUSIOk` は保存された `engineOptions` をそのまま送る。突き合わせはダイアログを開いたときだけ（`mergeUSIEngine`）。
- [確定] 探索中（`WaitingForBestMove` など）の `setOption` は予約し、`onBestMove` の先頭で送る（377-385 行、773-774 行）。`Ponder` 状態は予約の対象に入っていない。
- [確定] `gameover` は `win` `lose` `draw`。`gameover` なしの `ready()` では `draw` を補う（404-415 行）。検討の終了に `gameover` は送らない（`USIPlayer.close` は `usiQuit` のみ）。

### タイムアウト

| 区間 | 値 | 既定 | 変えられるか | 超えたとき |
| --- | --- | --- | --- | --- |
| `usi` → `usiok` | `option.timeout` | **10 秒** | 利用者が変更可。アプリ設定「最大起動待ち時間」`engineTimeoutSeconds`。**1〜300 秒** | `timeout` を通知して `quit()` |
| `isready` → `readyok` | **無し** | | | **待ち続ける** |
| `stop` → `bestmove` | **無し** | | | **待ち続ける** |
| `quit` → プロセス終了 | `DefaultQuitTimeout` | **5 秒** | 不可（定数） | `process.kill()` |
| `go` → `bestmove`（対局） | エンジン向けには無し | | | 時計が切れると `game.ts:470-482` |

- [確定] 定数は `engine.ts:186-187`。`DefaultTimeout = 10 * 1e3`、`DefaultQuitTimeout = 5 * 1e3`。設定の検証は `src/common/settings/app.ts:593-595`、既定は 439 行、部品は `AppSettingsDialog.vue:624-631`。
- [確定] **タイマーは `launch()` で張り、`onUSIOk` で外す**（339 行、756 行）。`isready` の区間には張らない。
  `readyok` の待ちを切る処理は `src/background/usi/` にも `src/renderer/` の呼び元（`readyNewGame`）にも無い。
- [確定] 検討の起動中は `useBusyState` を保持しており、`readyok` が来ないと `finally` に着かない（`src/renderer/store/index.ts:987-1019`）。
  `BusyMessage.vue` に取り消しの口は無い（検索語: `cancel` `button`、0件）。利用者から見ると待機表示のままになる、と読める（[推定]。動かしていない）。
- [確定] kill は `process.kill()` → `this.handle.kill()`（`process.ts`）。引数なしなので Node の既定のシグナルになる。**強制終了への昇格は無い。**
- [確定] アプリ終了時は 200ms ごとに `quitAll` を再試行し、5 秒で諦めて `dialog.showMessageBoxSync` を出す（`src/background/index.ts:112-132`）。

### 利用者に見せる文言

| 事象 | 文言 | 出どころ |
| --- | --- | --- |
| `usiok` のタイムアウト | `${seconds}秒以内にエンジンから応答がありませんでした。エンジンの起動が重い場合はアプリ設定の「USIプロトコル」タブで待ち時間を延長してください。` | `src/common/i18n/locales/ja.ts:946-948` |
| `usiok` までに異常終了 | `closed unexpectedly: 最終受信=[…]` | `engine.ts:595` と `index.ts` `newUnexpectedError` |
| 起動の失敗 | `<Node のエラー文>: 最終受信=[…]` | `process.on("error")` → `onError` |
| 検討の起動の失敗 | 上の文に接頭辞 `検討の初期化中にエラーが出ました: ` | `src/renderer/store/index.ts:1014` |
| 前回が終わっていない | `ResearchManager#launch: 前回のエンジンが終了していません。数秒待ってからもう一度試してください。` | `src/renderer/store/research.ts:76` |

- [確定] 文言の型は `<本文>: 最終受信=[<最後に受けた行>]`（`newUnexpectedError`、`index.ts:46-51`）。
  最後の行が無ければ本文だけ。
- [確定] 翻訳された `engineProcessWasClosedUnexpectedly` は `getUSIEngineInfo` の `close` にあるが、
  `onClose` が先に `errorCallback(new Error("closed unexpectedly"))` を呼び Promise が決まるので、読む限り到達しない。**結果として英語の文が出る。**

### 異常終了

**起動の後のエンジンの死は、利用者に通知されない。** [確定]（読解。動かしていない）

1. `onClose` は `WillQuit` 以外で `errorCallback` を呼ぶ（`engine.ts:595`）。
2. `error` の受け手は `setupPlayer` と `ready` の Promise の `reject` だけ（`index.ts:336`、382 行）。**どちらも解決済みなので何も起きない。**
3. `close` の受け手は統計の更新とセッションの削除の予約だけ（`index.ts` の `setupPlayer` 内）。
4. レンダラへの IPC は `USI_BEST_MOVE` `USI_CHECKMATE` `USI_CHECKMATE_NOT_IMPLEMENTED` `USI_CHECKMATE_TIMEOUT` `USI_NO_MATE` `USI_INFO` の6つで（`src/common/ipc/channel.ts:126-131`）、終了を伝えるものは無い。
5. `ResearchManager` の状態は変わらず `ResearchState.RUNNING` のまま。

このとき見えるもの。

| 場所 | 見えるもの |
| --- | --- |
| モニタ（`MonitorView.vue:17-19`） | 「セッションが終了したため、まもなく一覧から削除されます。」のラベル。20 秒後に一覧から消える（`sessionRemoveDelay = 20e3`、`index.ts:149`） |
| プロンプト | `closed: close=<code> signal=<signal>`（`engine.ts` `onClose` の `CommandType.SYSTEM`） |
| USI ログ | `engine process closed: …`（有効時のみ） |
| 次の `go` | 20 秒以内: `go()` は `reservedGoCommand` を置くだけで何も起きない。**20 秒以降**: `getSession` が `No engine session: SessionID=N` を投げ、`startResearch(...).catch` からエラーストアに入る（`index.ts:168-173`、`research.ts:133`）。IPC を経た後の文言の全体は未確認 |

- [確定] 再起動の口は無い。検討を止めて開始し直すしかない（検索語は §11）。
- [確定] CSA の `restartPlayerEveryGame` は1局ごとの再起動のオプションで、異常時の復帰ではない（`src/renderer/game/csa.ts:197`）。
- [確定] 一括解析（`batch_analysis.ts`）のコメントは、`startResearch` の非同期エラーを受けると全体を中断すると書く（195-200 行）。
- [未確認] 対局中にエンジンが死んだときの画面。`game.ts` の時計切れ以外の経路は追っていない。

## 4. 検討（`ResearchState`）

`src/renderer/store/research.ts`（`ResearchManager`）、`src/renderer/players/usi.ts`（`USIPlayer`）。

- [確定] 状態は `IDLE` / `STARTUP_DIALOG` / `RUNNING` の3つ（`src/common/control/state.ts:32-36`）。

| 問い | 実装 |
| --- | --- |
| 開始 | ダイアログ → 設定を保存 → 全エンジンを `launch` → 全エンジンを `readyNewGame` → `RUNNING` → `updatePosition`（`store/index.ts:987-1019`、`research.ts:62-117`） |
| 停止 | `close()`。タイマーを外し、全エンジンに `usiQuit`。**`stop` を送らず `quit` を送る**（`engine.ts:349-376`） |
| 局面変更 | `recordManager` の `changePosition` → `updatePosition`。**100ms で間引く**（`Lazy`、119-145 行） |
| 再 go | `engine.usi.startResearch` → `api.usiGoInfinite` → `process.go(usi)`。`timeState` が無いので `go infinite` |
| `stop` | **明示の操作ではない。** `go()` が探索中なら `reservedGoCommand` を置いて `stop()` を呼ぶ（430-446 行）。`bestmove` を受けて `sendReservedGoCommands` |
| 連打 | 予約は上書きなので最後の局面だけが送られる。`stop` は `lastSent` が `stop` なら二重に送らない（509-512 行） |
| 遅れた `bestmove` | 主プロセス: `currentPosition`（古い局面）のまま通知される。レンダラ: `startResearch` が `clearHandlers` 済みなので `onBestMove` は何もしない（`players/usi.ts:298-303`、`usi !== this.usi`） |
| 遅れた `info` | `onUSIInfo` が `usi !== this.usi` を捨てる（395-398 行）。`ResearchManager` は `synced` が false の間 `onUpdateSearchInfo` を呼ばない（99 行） |
| 複数エンジン | 主1＋`secondaries`。追加の個数の上限は無い（モバイルは主のみ）。`getSenderTypeByIndex` は4本目までに `SearchInfoSenderType` を割り当て、5本目以降は `onUpdateSearchInfo` が呼ばれない |
| 複数の起動 | `Promise.all`。1本でも失敗すれば全部 `close` |
| 時間制限 | `ResearchSettings.enableMaxSeconds` / `maxSeconds`（既定 false / 10 秒）。**`go infinite` のまま、GUI のタイマーで `stop` を送る**（`setupTimer`、208-217 行）。局面が変わるたびに張り直す |
| エンジンごとの停止 | `EngineAnalyticsElement.vue` の一時停止ボタン（`pause` / `unpause`）。`stop` を送り、`paused` のエンジンは局面変更の対象外。再開で現在の棋譜から `go` |
| 候補手数の指定 | 起動時: `overrideMultiPV` なら `options` の `value` を上書き（85-91 行）。`USI_MultiPV` か `MultiPV` が `spin` のときのみ |
| 候補手数の変更 | **探索中にその場で変えられる。** `EngineAnalyticsElement.vue` の入力欄から `setMultiPV`（180-206 行）。次節 |
| 大きな候補手数 | `suggestionsCountLimit` を超えると確認を出す（`EngineAnalyticsElement.vue:336-367`） |
| エンジンの切替 | **その場では不可。** ダイアログは `IDLE` からしか開かない（`showResearchDialog`、975-979 行）。止めて開き直す |
| 消費の警告 | スレッド合計がコア数の 100% / 75%、`USI_Hash` 合計がメモリの 100% / 90% を超えると警告（`ResearchDialog.vue:29-40` 付近） |

### `MultiPV` の変更の手順

[確定] `ResearchManager.setMultiPV`（180-206 行）。

1. `usi.setMultiPV` → `usiSetOption`。範囲外なら投げる（`players/usi.ts:447-457`）。探索中なら主プロセスで予約される。
2. `usi.stop()`。
3. `paused` でなければ `startResearch` と `setupTimer`。

探索中の流れ: `stop` → `bestmove` → 予約の `setoption` → 予約の `go`。
**`setoption` は探索中に送らない。** 原案の「待機中にだけ」に沿う。

[確定] 変更はセッションの中だけで `customMultiPV` に残る。エンジンの保存値には書かない。

### 解析と詰み探索

- [確定] 棋譜解析は1局面ごとに `window.setTimeout` で打ち切り、**`stop` を明示せず次の `startResearch` を呼ぶ**（`src/renderer/store/analysis.ts:201-222`）。`go()` の暗黙の `stop` に任せる。`perMoveCriteria.maxSeconds` の既定は 5 秒（`src/common/settings/analysis.ts`）。
- [確定] 詰み探索は `enableMaxSeconds` なら `go mate <ミリ秒>`、無ければ `go mate infinite`（`engine.ts:472-484`、`src/renderer/store/mate.ts:64`）。

## 5. `go` に送る形

[確定] `buildTimeOptions`（`engine.ts:152-161`）と `sendReservedGoCommands`（607 行以降）で全部。

| 送る行 | いつ |
| --- | --- |
| `go infinite` | 検討・解析（`timeState` なし） |
| `go btime <b> wtime <w> byoyomi <y>` | 対局（加算が両方0） |
| `go btime <b> wtime <w> binc <b> winc <w>` | 対局（加算あり） |
| `go ponder btime …` | 相手番思考 |
| `go ponder` | 早期 Ponder（やねうら王の拡張）。コメントが標準外と明記 |
| `go mate <ms>` / `go mate infinite` | 詰み探索 |
| `ponderhit btime …` | 早期 Ponder 有効時。ダイアログに標準外の警告を出す |

- [確定] **`go movetime` `go depth` `go nodes` `go searchmoves` `go movestogo` は送らない。** 検索語は §11。プロンプトの補完候補（`src/renderer/view/prompt/CommandInput.vue:192-208`）にも無い。
- [確定] **ノード数・深さの制限に GUI の機能は無い。** `NodesLimit` は簡易表示に出るエンジンのオプションで、`setoption` でエンジンに渡るだけ。`DepthLimit` は日本語名の表にあるだけ（§2）。
- [確定] **時間の制限は GUI のタイマーで作る**（§4）。`movetime` は使わない。
- [確定] 対局設定の型（`src/common/settings/game.ts`）にノード数・深さの欄は無い（検索語は §11）。
- [確定] `buildTimeState` は `byoyomi` が 0 のときだけ `binc` `winc` を入れる（`buildTimeState`、`index.ts:399`）。
- [確定] `enableEngineTimeout` が false の対局では、時計が切れたエンジンに `stop` を送って続行する（`game.ts:470-480`）。`GameDialog.vue` の設定で、既定 false。

## 6. ログと `info string`

- [確定] **USI ログ。** `usi-<日時>.log`（`src/background/log.ts:18`）。`enableUSILog`（既定 false）。アプリ設定に切替とログレベルがある（`AppSettingsDialog.vue:779-800`）。反映には再起動が要る旨の表示がある（765 行）。
- [確定] **モニタ。** タブ `Tab.MONITOR` がセッションの一覧を出す。状態コード、最終送信、最終受信、時刻、`pid`（`src/renderer/view/monitor/MonitorView.vue`、`collectSessionStates`）。
- [確定] **プロンプト。** 別ウィンドウ。モニタの「プロンプトを開く」から開く（`MonitorView.vue:71`）。送受信の全行が流れる。**その場でコマンドを送れる**（`invokeCommand`）。主プロセスの履歴は 100 行で頭から 10 行ずつ捨てる（`engine.ts:840`）。
- [確定] 「USIエンジンを起動(管理モード)」（`LaunchUSIEngineDialog.vue`）は `setoption` までを自動で送り、以後をプロンプトで手で打つ画面。
- [確定] **`info string`。** `parseInfoCommand` が行の残りを `string` に入れ、`USIPlayerMonitor.update` が `info.text` に入れる（`src/renderer/store/usi.ts:154-156`）。読み筋の行に出る（`EngineAnalyticsElement.vue:140`）。`text` は `pv` の表示を上書きする。
- [確定] `info string` は `currentPosition` 付きで通知され、`usi !== this.usi` で捨てられる。**探索外（`isready` の間など）の `info string` は読み筋に出ない。** プロンプトとログには出る。`on("info")` の登録自体が `go` 系の関数の中にある（`index.ts:424-451`）。
- [確定] 標準エラー出力は読まない（`process.ts` は `stdout` の `readline` だけ）。

## 7. 初回のオプション取得と保存

- [確定] **起動してすぐ落とす。** `getUSIEngineInfoFromProcess`（`index.ts:59-94`）が `usi` を送り、`usiok` で結果を確定して `process.quit()`。原案の例のコメントが許す使い方。
- [確定] 画面からは3か所。追加（`USIEngineManagementDialog.vue:223`）、ダイアログを開いたとき（`USIEngineOptionsDialog.vue:441`）、エンジン再選択（同 487 行）。ほかに `src/background/usi/wasm/install.ts:497` と `src/background/headless/invoke.ts:29`。
- [確定] **ダイアログを開くたびにエンジンを起動し直す。** 組み込みの WebAssembly エンジンを除く。取れなければエラーを出してダイアログを閉じる（463-465 行）。
- [確定] 作業ディレクトリは実行ファイルのディレクトリ（`process.ts` `cwd: path.dirname(cmd)`）。Windows の `.bat` `.cmd` は `cmd.exe /c`。ポータブル版は相対パスを解決する（`src/background/usi/path.ts`）。
- [確定] **保存先は `<rootDir>/usi_engine.json`**（`src/background/settings.ts:173`）。`rootDir` はポータブル版なら実行ファイルの場所、それ以外はユーザーディレクトリ（70 行）。
- [確定] 形式は `USIEngines` の JSON（`{ engines: { [uri]: USIEngine }, tagColorMapping }`、2字下げ）。`writeFileAtomic` で書く。
- [確定] 検討の設定は `research_setting.json`（313 行）で、**`usi` に `USIEngine` の写しを丸ごと持つ**。開始時に `engines.getEngine(uri)` の最新で入れ替える（`ResearchDialog.vue` `onStart`）。

## 8. 複数の設定の持ち方

- [確定] 「設定」と「エンジン」を分けていない。**1つの `USIEngine` が1つの登録で、`uri` が同一性。** 同じ `path` を複数登録できる。
- [確定] 「複製」（`duplicateEngine`）は新しい `uri` を発行し、名前に `t.copyOf` を付ける。これが「同じエンジンの別設定」の作り方。
- [確定] 同じ `path` の再追加を止める処理は無い（`add` は常に `addEngine`）。

## 9. 更新・再登録のときの引き継ぎ

**手段は3つで、`USIEngineMergeDialog` はそのどれでもない。**

| 手段 | 動き |
| --- | --- |
| エンジン再選択（`replaceEnginePath`） | 確認文 `incompatibleOptionsWillBeDiscardedDoYouReallyWantToReplaceTheEnginePath` の後、新しいパスの `getUSIEngineInfo` に `mergeUSIEngine` |
| ダイアログを開いたとき | 実機の申告に保存値を `mergeUSIEngine`。**エンジンを差し替えた後に開くと自動でこれが走る**（`path` は同じ） |
| WebAssembly エンジンの更新 | `mergeUpdatedEngine`（`src/renderer/helpers/enginePackage.ts`） |

[確定] `mergeUSIEngine`（`usi.ts:285-299`）。

- 土台は**新しい申告**。そこへ `uri`、`name`、タグ、`enableEarlyPonder`、`extraBook` を写す。
- オプションの値は**名前と型が同じものだけ**写す。`button` は写さない。
- 古い側にしか無いオプションは捨てる。
- 写す値は `localOption.value`。`default` は新しい申告のもの。

[確定] `USIEngineMergeDialog.vue`（題「エンジン設定の比較」、入口は「比較・マージ」）は、登録済みの2エンジンを選んで
`compareUSIEngineOptions` の差分を出し、項目ごとに左右へ写す画面。両方が値を持ち型が同じ項目だけ `mergeable`。

[確定] 「ファイルから追加」で同じエンジンの新しい版を選ぶと、新しい `uri` の別の登録になり、何も引き継がない（`add`）。

## 10. 調べていないこと

| 項目 | 理由 |
| --- | --- |
| 対局中のエンジンの異常終了の画面 | `game.ts` の経路を追っていない。IPC に通知が無いことまでは確定 |
| `searchBook` の詳細、定跡セッション | 定跡の読み取りは本書の範囲外 |
| WebAssembly エンジンの状態機械（`src/renderer/wasm-engine/session.ts`） | `engine.ts` とは別実装。タイムアウトの扱いは未確認 |
| 実行時の見え方 | アプリを動かしていない |
| `src/tests/` | ダウンロードしていない。振る舞いのテストがあるかは未確認 |

## 11. 「無い」の検出力

**範囲:** 版 `6304cdaf` の `src/renderer`（`assets` を除く）、`src/common`、`src/background` の `.ts` / `.vue`、計 312 ファイルを
`gh api contents` で取得し、`grep -rn` した。`src/tests` と `src/command` は含まない。

| 主張 | 検索語 | 結果 |
| --- | --- | --- |
| スライダが無い | `type="range"` `type=.range` `slider` `seekbar` `knob`（大文字小文字無視） | `slider` は `ToggleButton.vue` の CSS クラスのみ。他は0件 |
| `go` の拡張を送らない | `movetime` `go depth` `go nodes` `searchmoves` `movestogo` | 0件 |
| 予約オプションを送らない | `USI_OwnBook` `OwnBook` `AnalyseMode` `ShowCurrLine` `USI_Strength` `LimitStrength` `USI_Variant` | `USI_OwnBook` `OwnBook` は日本語名の表のみ。他は0件 |
| 異常終了の通知が無い | `closed unexpectedly` `engineProcessWasClosedUnexpectedly` `ProcessClosed` `onUSIClose` `USI_CLOSE`、`channel.ts` の `USI`・`PROMPT` の全行 | 文言は `engine.ts` と `index.ts` の2か所のみ。チャンネルに該当なし |
| 再起動の口が無い | `restart` `respawn` `relaunch` `再起動`（大文字小文字無視） | `restartPlayerEveryGame` と、アプリの再起動の文言のみ |
| 対局にノード・深さの設定が無い | `maxNodes` `nodeLimit` `nodesLimit` `depthLimit` `maxDepth`（`src/common/settings` `src/renderer/store` `src/renderer/game` `src/renderer/players`） | 0件 |
| エンジン名で分岐しない | `defaultName ===` `engine.name ===` `.author ===`、`yaneura` `やねうら`（大文字小文字無視。言語ファイルを除く） | 前の3語は0ファイル。後の2語は `engine.ts:166` のコメント、定跡形式の処理、ファイルダイアログの種類名、`runner.ts` のコメントのみ |

## 12. 失効条件

- 版を更新したら §0 と §3 のタイムアウト表を取り直す。
- §3 の「通知されない」は `src/common/ipc/channel.ts` に終了のチャンネルが足されると覆る。
- §1 のスライダは `USIEngineOptionsDialog.vue` の `spin` の部品が変わると覆る。

