# 状態遷移表: engine（L1）

対象: `src/entities/engine/model/provider.tsx` と `src/entities/engine/api/initializer.ts`、
および対応する Rust 側 `src-tauri/src/engine/analyzer.rs`（`start_engine` / `shutdown`）と
`src-tauri/src/engine/bridge.rs`。

上位は [app.md](app.md)。局面の送信は [engine-position-sync.md](engine-position-sync.md)、
解析セッションは [analysis.md](analysis.md) が持つ。

## 状態（フロントエンド）

| 記号   | 状態     | 判定                                                            |
| ------ | -------- | --------------------------------------------------------------- |
| **S0** | 未起動   | `phase === "idle"`、`activeRuntime === null`                    |
| **S1** | 起動中   | `phase === "initializing"`                                      |
| **S2** | 起動済み | `phase === "ready"`、`engineInfo !== null`                      |
| **S3** | 失敗     | `phase === "error"`、`error !== null`、`activeRuntime === null` |

`isReady` は S2 と同義ではない。`desiredRuntime` と `activeRuntime` の一致まで見る
（`provider.tsx`）。**設定を変えた直後は S2 のまま `isReady === false`。**

どの起動の結果を state に書くかは世代（`provider.tsx` の `seqRef`）で決める。
`initialize` / `shutdown` を撃つたびに上がり、古い世代の結果は捨てる。

## 外部の状態（Rust プロセス）

**この列を忘れたことが issue #120 の BLOCK だった。** 必ず並べる。

| 記号   | 状態                             | 判定                                                                                   |
| ------ | -------------------------------- | -------------------------------------------------------------------------------------- |
| **P0** | プロセス無し                     | `analyzer.engine_id === None`、`startup.cancel === None`                               |
| **P1** | 起動処理中                       | `startup.cancel === Some(_)`（`start_engine` が起動・`setoption`・`readyok` を待つ間） |
| **P2** | 生きている                       | `analyzer.engine_id === Some(_)`                                                       |
| **P3** | 生きているが解析セッションを保持 | `active_sessions` に席あり → [analysis.md](analysis.md)                                |

**P1 は Rust の側で取り消せる。** 起動中に `shutdown_engine`（`EngineAnalyzer::shutdown`）か
次の `start_analysis_engine` が来たら、起動中のプロセスも落として前の呼び出しを `cancelled` で
断る。`engine_id` に載せるのは世代が最新のときだけ（`analyzer.rs` の `Startup` と `publish`）。
踏んでいるテストは `analyzer.rs` の `tests::starting`。

## イベント

| 記号   | イベント                                        | 発生源                                                   |
| ------ | ----------------------------------------------- | -------------------------------------------------------- |
| **E1** | `desiredRuntime` が付く                         | プリセット選択（`EngineRuntimeBridge`）                  |
| **E2** | `desiredRuntime` が外れる                       | プリセット未選択に戻す                                   |
| **E3** | `desiredRuntime` が**別の値に変わる**           | プリセット切替・プリセットの編集                         |
| **E4** | `desiredRuntime` が**同じ値のまま再設定される** | `selectedPresetVersion` の更新                           |
| **E5** | 起動が成功する                                  | `startAnalysisEngine` の resolve（`readyok` まで通った） |
| **E6** | 起動が**失敗する**                              | 同 reject。種類つき（`StartFailure`。`asEngineFailure`） |
| **E7** | 停止が成功する                                  | `shutdownEngine` の resolve                              |
| **E8** | 停止が**失敗する**                              | 同 reject                                                |
| **E9** | 「もう一度起動」を押す                          | 帯（`EngineFailureBridge`）。**一部の種類にだけ出る**※7  |

## 表

|           | E1 runtime が付く   | E2 runtime が外れる            | E3 別の runtime                         | E4 同じ runtime      | E5 起動成功 | E6 起動失敗     | E7 停止成功          | E8 停止失敗                                                                                    | E9 もう一度起動 |
| --------- | ------------------- | ------------------------------ | --------------------------------------- | -------------------- | ----------- | --------------- | -------------------- | ---------------------------------------------------------------------------------------------- | --------------- |
| **S0/P0** | → S1 `initialize()` | —                              | → S1                                    | —                    | —           | —               | —                    | —                                                                                              | —               |
| **S1/P1** | 何もしない          | → S0 `shutdown()`※1            | **待たずにその設定で `initialize()`**※2 | **起こし直さない**   | → S2/P2     | → S3/P0（種類） | → S0                 | → S0 だが **P が不明**※3                                                                       | —               |
| **S2/P2** | —                   | → S0 `shutdown()`              | → `restart()` = 停止してから起動        | **再起動しない**※4   | —           | —               | → S0/P0              | → S0 だが **P2 のまま**※3                                                                      | —               |
| **S3/P0** | —                   | → S0 `shutdown()`              | → S1 再トライ※5                         | **再トライしない**※5 | —           | —               | → S0                 | → S0                                                                                           | → S1※7          |
| **S2/P3** | —                   | 停止 → [analysis](analysis.md) | 再起動 → [analysis](analysis.md)        | —                    | —           | —               | セッションも止まる※6 | **席は空く**（`shutdown_engine_impl` が先に `stop_all_sessions` を通す）。プロセスは残りうる※3 | —               |

### 注

※1 **停止は進行中の起動を待たない。** Rust が起動中のプロセスを落とし、その起動は `cancelled` で
断られる。断りは世代が古いので捨てる（`provider.tsx` の `seqRef`）。待つ形だと、`readyok` を
返さないエンジンを選んだ回に停止ごと固まる。

※2 起動中に別の設定になったら、前の起動の結果を待たずにその設定で起動し直す
（`provider.tsx` の effect の `initializing` の枝）。前の起動は Rust が落とし、前の呼び出しの
断り（`cancelled`）は世代が古いので捨てる。**進行中の起動を使い回す口は無い**——使い回すと、
前の設定の起動結果を新しい設定のものとして `activeRuntime` に書く。
踏んでいるのは `provider.test.tsx` の「起動中に設定が変わったら、その設定で起動し直す」。

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

※5 S3 では**同じ runtime なら自動では再トライしない**（`provider.tsx`）。
無限リトライを避けるため。**復帰は E3（設定を直す）か E9（もう一度起動）を通る**——失敗すると
`EngineFailureBridge` が種類ごとの帯を出し、「設定を開く」が設定のエンジン管理タブを開く
（そこからプリセットを編集する。行き先の一次記述は
[settings.md](../spec/screens/settings.md)）。直した設定は別の runtime になるので、
その場で起動し直す。

**「同じ runtime」はプリセットの同一性ではない**——見るのは `enginePath` /
`workDir` / `evalDir` / `bookDir` / `bookFile` / `options`（`entities/engine/lib/equalRuntime.ts`。
この判定がここの唯一の出典で、他の doc はここを指す）。だから**選択中のプリセットの
オプションを1つ変えて保存するだけでも起動し直す**——プリセットが1つしか無い利用者に
残っている道はこれだけ
→ [failure-surfacing.md](failure-surfacing.md) F-9

※6 `shutdown_engine_impl` は `stop_all_sessions()` を先に呼ぶ（`bridge.rs`）

※7 「もう一度起動」は、**同じ設定のままで直る見込みがある種類にだけ出す**（`quarantined` /
`timedOut` / `cancelled`。表は `app/providers/bridges/engineFailureNotice.ts` の
`ENGINE_FAILURE_NOTICES`）。原因が設定にある種類（`spawnFailed` / `notUsi` / `exitedEarly` /
`invalidValue`）に出すと、押しても同じ結果になる（ADR-0004 の F-9）。押すと
`useEngine().initialize()` を撃つ

## この表が満たすべき不変条件

1. **S2（起動済み）なら `activeRuntime` は実際に起動したプロセスの設定と一致する。**
   世代の古い起動の結果は書かない（※1 / ※2）
2. **フロントが S0 なら Rust 側も P0。** ※3 はこれを破る
3. **S3（失敗）から抜ける道が常にある。** 帯が設定へ送り、そこで `desiredRuntime` を
   前回試した値から動かせば E3 で起動し直す（※5。プリセットを選び直しても、
   選択中のものを編集してもよい）。同じ設定で直る見込みがある種類には E9 も出る

## 埋まっていないセル

- `(S2, E8)` / `(S1, E8)` 停止の失敗（※3）。**Rust 側を落とす手段が無く踏めていない**
- `(S1, E2)` 起動中の停止。Rust の側（起動中のプロセスが残らない）は `analyzer.rs` の
  `stopping_while_loading_cancels_and_leaves_nothing` が踏むが、フロントの側（前の起動の断りを
  捨てる）は `(S1, E3)` と同じ世代の門を通るだけで、専用のテストは無い

**`entities/engine` のテスト**は `model/__tests__/provider.test.tsx`（`(S3, E4)` / `(S3, E3)` /
`(S1, E3)` / `(S1, E4)`）と `lib/__tests__/`（`asEngineFailure`、`usiOptionsOf` の順序）。
`(S3, E9)` の出し分けは `app/providers/bridges/__tests__/engineFailureBridge.test.tsx`。
