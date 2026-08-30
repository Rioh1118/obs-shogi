# 状態遷移表: アプリ全体（L0）

対象: `src/app/` 以下の provider と gate の組み合わせ。

**この表はセルの中身を書かない。** 各セルは「どのスライスに委譲されるか」と
下の表への参照だけを持つ。中身をここに書き始めたら、それは L1 の表に属している。

## 状態

provider の入れ子（`BootstrapProviders` → `RuntimeProviders`）と gate の通過状況で決まる。

| 記号   | 状態                           | 判定                                                           |
| ------ | ------------------------------ | -------------------------------------------------------------- |
| **A0** | 設定の読み込み中               | `config === null && isLoading`。`BootSplash` だけが出る        |
| **A1** | ワークスペース未設定           | `config !== null && !config.root_dir`。`/` に留まる            |
| **A2** | ワークスペースあり・棋譜なし   | `config.root_dir !== null`、`fileTree.activeKifuPath === null` |
| **A3** | 棋譜を開いている・エンジンなし | `activeKifuPath !== null`、`engine.phase !== "ready"`          |
| **A4** | 棋譜 + エンジン ready          | 上に加え `engine.phase === "ready"` かつ `isReady`             |
| **A5** | 解析中                         | 上に加え `analysis.isAnalyzing === true`                       |

**A3 と A4 の間に「エンジン起動中／失敗」がある**が、アプリ全体としては A3 と区別されない。
区別は [engine.md](engine.md) が持つ。

## イベント

| 記号    | イベント                     | 発生源                                |
| ------- | ---------------------------- | ------------------------------------- |
| **E1**  | 設定の読み込みが終わる       | `AppConfigProvider` の起動時ロード    |
| **E2**  | 設定の読み込みが**失敗する** | 同上                                  |
| **E3**  | ワークスペースを選ぶ／変える | ようこそ画面・設定タブ                |
| **E4**  | 棋譜を開く                   | ツリーのクリック・検索結果からの遷移  |
| **E5**  | 棋譜を閉じる                 | タブを閉じる・ファイルが消える        |
| **E6**  | プリセットを選ぶ／変える     | 設定タブ                              |
| **E7**  | エンジンが ready になる      | `engineInitializer.initialize` の成功 |
| **E8**  | エンジンが ready でなくなる  | 失敗・停止・設定変更                  |
| **E9**  | 解析を開始する／止める       | 解析ペインのボタン                    |
| **E10** | ファイル操作が失敗する       | 作成・リネーム・削除・移動            |

## 表

`—` はそのイベントがその状態で起きないか、状態が変わらないもの。
セルの `→ 表名` は、そのイベントの扱いを下の表が持っていることを指す。

|        | E1 設定完了 | E2 設定失敗      | E3 WS 変更                               | E4 棋譜を開く                                | E5 棋譜を閉じる | E6 プリセット                    | E7 ready                       | E8 not ready          | E9 解析                            | E10 ファイル操作失敗        |
| ------ | ----------- | ---------------- | ---------------------------------------- | -------------------------------------------- | --------------- | -------------------------------- | ------------------------------ | --------------------- | ---------------------------------- | --------------------------- |
| **A0** | → A1/A2     | **`/` に戻す**※1 | —                                        | —                                            | —               | —                                | —                              | —                     | —                                  | —                           |
| **A1** | —           | —                | → A2                                     | —                                            | —               | 設定は保存される                 | —                              | —                     | —                                  | —                           |
| **A2** | —           | —                | ツリー再読込 → [file-tree](file-tree.md) | → A3 → [game](game.md)                       | —               | → [engine](engine.md)            | → A2（棋譜が無くても起動する） | → [engine](engine.md) | —                                  | → [file-tree](file-tree.md) |
| **A3** | —           | —                | → A2（棋譜を閉じる）※2                   | 別の棋譜へ                                   | → A2            | → [engine](engine.md)            | → **A4**                       | —                     | 開始できない※3                     | → [file-tree](file-tree.md) |
| **A4** | —           | —                | → A2                                     | 別の棋譜へ → [sync](engine-position-sync.md) | → A3            | 再起動 → [engine](engine.md)     | —                              | → **A3**              | → **A5** → [analysis](analysis.md) | → [file-tree](file-tree.md) |
| **A5** | —           | —                | → A2※4                                   | 局面が変わる → [analysis](analysis.md)       | → A3※4          | 再起動 → [analysis](analysis.md) | —                              | → A3※4                | → A4                               | → [file-tree](file-tree.md) |

### 注

※1 `RequireRootDir` が `error` を見て `<Navigate to="/" replace />`。
**エラーの内容は画面に出ない。** 設定が壊れていても「ようこそ画面」に戻るだけで区別がつかない。
→ [failure-surfacing.md](failure-surfacing.md) F-1

※2 ワークスペースを変えたときに開いている棋譜がどうなるかは
`GamePersistenceGate` / `GameFileTreeBridge` が決めている。**この表でも [game.md](game.md) でも追えていない。**
埋めるには両者を読む必要がある

※3 `startInfiniteAnalysis` が `throw new Error("Engine not ready")` を投げるが、
呼び出し元（`AnalysisPaneHeader:84`）は `console.error` で終わる。**押しても何も起きない**
→ [failure-surfacing.md](failure-surfacing.md) F-6

※4 解析中に前提が崩れたとき、**Rust 側のセッションが残るかどうかがここでは分からない。**
→ [analysis.md](analysis.md) の外部状態の列を見る

## この表が満たすべき不変条件

1. **A2 以上では `config.root_dir` が常に非 null。** `RequireRootDir` がこれを守る。
   破れると file-tree が `rootDir=null` で走る
2. **A4 / A5 では、エンジンプロセスが生きている。** `isReady` は
   `phase === "ready"` だけでなく `desiredRuntime` と `activeRuntime` の一致も見ている
   （`entities/engine/model/provider.tsx:19-24`）。設定だけ変わって古いプロセスが
   生きている状態を A4 と呼ばないため
3. **どの状態からも A1（ワークスペース未設定）に戻れる。** 戻れない状態は行き止まり

## 埋まっていないセル

- **`(A2〜A5, E3)` ワークスペース変更時に、開いている棋譜・解析・インデックスがどうなるか。**
  3スライスにまたがるのに、まとめて検証しているテストが無い
- **`(A5, E8)` 解析中にエンジンが落ちる。** #120 と同じ形の行き止まりが再発しうる箇所
- `(A0, E2)` 設定読み込み失敗。**手で壊さないと踏めない経路で、テストが無い**

いずれも実装上は経路があるが、**テストは無い**。
