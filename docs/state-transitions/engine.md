# 状態遷移表: engine（L1）

対象: `src/entities/engine/model/provider.tsx` と `src/entities/engine/api/initializer.ts`、
および対応する Rust 側 `src-tauri/src/engine/bridge.rs`。

上位は [app.md](app.md)。局面の送信は [engine-position-sync.md](engine-position-sync.md)、
解析セッションは [analysis.md](analysis.md) が持つ。

## 状態（フロントエンド）

| 記号   | 状態     | 判定                                                            |
| ------ | -------- | --------------------------------------------------------------- |
| **S0** | 未起動   | `phase === "idle"`、`activeRuntime === null`                    |
| **S1** | 起動中   | `phase === "initializing"`、`initializer.inFlight !== null`     |
| **S2** | 起動済み | `phase === "ready"`、`engineInfo !== null`                      |
| **S3** | 失敗     | `phase === "error"`、`error !== null`、`activeRuntime === null` |

`isReady` は S2 と同義ではない。`desiredRuntime` と `activeRuntime` の一致まで見る
（`provider.tsx`）。**設定を変えた直後は S2 のまま `isReady === false`。**

## 外部の状態（Rust プロセス）

**この列を忘れたことが issue #120 の BLOCK だった。** 必ず並べる。

| 記号   | 状態                             | 判定                                                      |
| ------ | -------------------------------- | --------------------------------------------------------- |
| **P0** | プロセス無し                     | `analyzer` が未初期化                                     |
| **P1** | 起動処理中                       | `initialize_engine` が in-flight                          |
| **P2** | 生きている                       | `analyzer` が初期化済み                                   |
| **P3** | 生きているが解析セッションを保持 | `active_sessions` に項目あり → [analysis.md](analysis.md) |

## イベント

| 記号   | イベント                                        | 発生源                                      |
| ------ | ----------------------------------------------- | ------------------------------------------- |
| **E1** | `desiredRuntime` が付く                         | プリセット選択（`EngineRuntimeBridge`）     |
| **E2** | `desiredRuntime` が外れる                       | プリセット未選択に戻す                      |
| **E3** | `desiredRuntime` が**別の値に変わる**           | プリセット切替・プリセットの編集            |
| **E4** | `desiredRuntime` が**同じ値のまま再設定される** | `selectedPresetVersion` の更新              |
| **E5** | 初期化が成功する                                | `setupYaneuraOuEngine` の resolve           |
| **E6** | 初期化が**失敗する**                            | 同 reject（パスが無い、評価関数が無い、等） |
| **E7** | 停止が成功する                                  | `shutdownEngine` の resolve                 |
| **E8** | 停止が**失敗する**                              | 同 reject                                   |

## 表

|           | E1 runtime が付く   | E2 runtime が外れる            | E3 別の runtime                  | E4 同じ runtime      | E5 初期化成功 | E6 初期化失敗 | E7 停止成功          | E8 停止失敗               |
| --------- | ------------------- | ------------------------------ | -------------------------------- | -------------------- | ------------- | ------------- | -------------------- | ------------------------- |
| **S0/P0** | → S1 `initialize()` | —                              | → S1                             | —                    | —             | —             | —                    | —                         |
| **S1/P1** | 何もしない※1        | → S0 `shutdown()`              | **何もしない**※2                 | —                    | → S2/P2       | → S3/P0       | → S0                 | → S0 だが **P が不明**※3  |
| **S2/P2** | —                   | → S0 `shutdown()`              | → `restart()` = 停止してから起動 | **再起動しない**※4   | —             | —             | → S0/P0              | → S0 だが **P2 のまま**※3 |
| **S3/P0** | —                   | → S0 `shutdown()`              | → S1 再トライ※5                  | **再トライしない**※5 | —             | —             | → S0                 | → S0                      |
| **S2/P3** | —                   | 停止 → [analysis](analysis.md) | 再起動 → [analysis](analysis.md) | —                    | —             | —             | セッションも止まる※6 | **セッションが残る**※3    |

### 注

※1 `initialize()` は `state.phase === "initializing"` で早期 return する（`provider.tsx`）

※2 **`YaneuraOuInitializer.initialize` は `inFlight` があれば引数を無視して前の promise を返す**
（`initializer.ts`）。起動中に別のプリセットへ切り替えると、
**前の runtime の起動結果を新しい runtime のものとして `activeRuntime` に書く**
（`provider.tsx` の `snap` は新しい方）。
→ **未検証。テストが無い。** 実機で踏めるかは未確認

※3 **停止が失敗しても `dispatch({ type: "shutdown" })` は `finally` で必ず走る**
（`provider.tsx`）。フロントは S0（未起動）になるが、Rust のプロセスは残りうる。
呼び出し元は `shutdown().catch(() => {})`（`provider.tsx`）なので**誰にも届かない**。
issue #120 と同型の行き止まり
→ [failure-surfacing.md](failure-surfacing.md) F-8

※4 `equalRuntime` が同値と判定すれば再起動しない（`provider.tsx`）。
ただし `engineKey` は `selectedPresetVersion` を含むので、
**プリセットを編集すると engineKey だけ変わってエンジンは再起動しない**組み合わせがある。
そのための「同じ engineKey での再起動」の扱いが
[engine-position-sync.md](engine-position-sync.md) の E3

※5 S3 では**同じ runtime なら再トライしない**（`provider.tsx`）。
無限リトライを避けるため。**再トライの導線は `clearError()` だが、UI からの呼び出し元が0。**
利用者は別のプリセットを選ぶ以外に復帰できない
→ [failure-surfacing.md](failure-surfacing.md) F-9

※6 `shutdown_engine_impl` は `stop_all_sessions()` を先に呼ぶ（`bridge.rs`）

## この表が満たすべき不変条件

1. **S2（起動済み）なら `activeRuntime` は実際に起動したプロセスの設定と一致する。**
   ※2 はこれを破りうる
2. **フロントが S0 なら Rust 側も P0。** ※3 はこれを破る
3. **S3（失敗）から抜ける道が常にある。** いまは「別のプリセットを選ぶ」だけ。※5

## 埋まっていないセル

- `(S1, E3)` 起動中の runtime 切替（※2）。**`initializer.ts` にテストが無い**
- `(S2, E8)` / `(S1, E8)` 停止の失敗（※3）。**Rust 側を落とす手段が無く踏めていない**
- `(S3, E4)` 同じ runtime での再設定。再トライしないことを固定するテストが無い
- **`entities/engine` に `__tests__` が1つも無い**
